// A brief's contact details and notes are encrypted before they reach the database. Briefs saved before that still read.
import { randomUUID } from "node:crypto";
import { encryptField, readField } from "@/lib/crypto";
import type { LeadDetails } from "@/lib/leads";

export const SEALED_LEAD_FIELDS = ["name", "email", "phone", "city", "state", "notes"] as const;
type SealedField = (typeof SEALED_LEAD_FIELDS)[number];

export const leadContext = (field: SealedField, id: string) => `Lead.${field}:${id}`;

export function sealLead(details: LeadDetails) {
  const id = randomUUID();
  const sealed = Object.fromEntries(SEALED_LEAD_FIELDS.map((field) => [field, encryptField(details[field], leadContext(field, id))])) as Record<SealedField, string>;
  return { ...details, ...sealed, id };
}

export function openLead<Row extends { id: string } & Record<SealedField, string>>(row: Row): Row {
  const opened = Object.fromEntries(SEALED_LEAD_FIELDS.map((field) => [field, readField(row[field], leadContext(field, row.id))]));
  return { ...row, ...opened };
}
