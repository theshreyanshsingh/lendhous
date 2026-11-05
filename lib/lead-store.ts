// A brief's contact details and notes are encrypted before they reach the database. Briefs saved before that still read.
import { randomUUID } from "node:crypto";
import { encryptField, readField } from "@/lib/crypto";
import type { LeadDetails } from "@/lib/leads";
import { notDeleted, prisma } from "@/lib/prisma";
import type { Quote } from "@/lib/quote";

/** Quote requests no one has answered. On MongoDB `null` only matches a stored null, so check for the field being unset too. */
export const unansweredLeads = () => prisma.lead.count({ where: { ...notDeleted, AND: [{ OR: [{ contactedAt: null }, { contactedAt: { isSet: false } }] }] } });

export const SEALED_LEAD_FIELDS = ["name", "email", "phone", "city", "state", "notes"] as const;
type SealedField = (typeof SEALED_LEAD_FIELDS)[number];

export const leadContext = (field: SealedField, id: string) => `Lead.${field}:${id}`;

export function sealLead(details: LeadDetails) {
  const id = randomUUID();
  const sealed = Object.fromEntries(SEALED_LEAD_FIELDS.map((field) => [field, encryptField(details[field], leadContext(field, id))])) as Record<SealedField, string>;
  return { ...details, ...sealed, id };
}

/** The full quote request, sealed the same way as the brief's own fields. */
export const sealQuote = (quote: Quote, id: string) => encryptField(JSON.stringify(quote), `Lead.quote:${id}`);
export function openQuote(row: { id: string; quote?: string | null }): Quote | null {
  if (!row.quote) return null;
  try { return JSON.parse(readField(row.quote, `Lead.quote:${row.id}`)) as Quote; } catch { return null; }
}

export function openLead<Row extends { id: string } & Record<SealedField, string>>(row: Row): Row {
  const opened = Object.fromEntries(SEALED_LEAD_FIELDS.map((field) => [field, readField(row[field], leadContext(field, row.id))]));
  return { ...row, ...opened };
}

/**
 * The newest quote request in the last 30 days whose borrower is this email, for a new account's first application. The
 * email is sealed, so the recent quotes are opened to compare.
 */
export async function recentQuoteFor(email: string, now = new Date()): Promise<Quote | null> {
  const wanted = email.trim().toLowerCase();
  const rows = await prisma.lead.findMany({ where: { ...notDeleted, quote: { not: null }, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, quote: true } });
  for (const row of rows) {
    const quote = openQuote(row);
    if (quote?.borrower.email.toLowerCase() === wanted) return quote;
  }
  return null;
}
