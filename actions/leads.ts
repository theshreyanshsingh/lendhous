"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { notifyTeam } from "@/lib/email";
import { sealLead, sealQuote } from "@/lib/lead-store";
import { prisma } from "@/lib/prisma";
import { issuePhotoKey } from "@/lib/property-photos";
import { EXPERIENCE_LABEL, LOAN_TYPES, quoteProblem, quoteSummary } from "@/lib/quote";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

/** photoKey lets this browser send photos of the property for the next couple of hours. */
export type QuoteReply = { sent: boolean; error: string; photoKey?: string };

/**
 * The public quote request. Open to anyone, so it's rate limited and has the same honeypot. The visitor's indicative terms
 * are worked out in their browser from the pricing the page was sent; this keeps the request for the team.
 */
export async function sendQuote(raw: unknown, honeypot = ""): Promise<QuoteReply> {
  if (honeypot) return { sent: true, error: "" };
  const checked = quoteProblem(raw);
  if ("error" in checked) return { sent: false, error: checked.error };
  const { quote } = checked;
  const meta = await requestMeta();
  const shared = /^(unknown|127\.|::1$|::ffff:127\.)/.test(meta.ipAddress);
  if (!(await consumeRateLimit(`lead:${meta.ipAddress}`, shared ? 60 : 5, 60 * 60 * 1000))) return { sent: false, error: "Too many requests from this connection. Try again in an hour." };
  // The person to reply to: the broker who sent it, or the borrower.
  const contact = quote.submitter === "broker" && quote.broker ? { name: `${quote.broker.name} (broker for ${quote.borrower.firstName} ${quote.borrower.lastName})`, email: quote.broker.email, phone: quote.broker.phone } : { name: `${quote.borrower.firstName} ${quote.borrower.lastName}`, email: quote.borrower.email, phone: quote.borrower.phone };
  const details = { ...contact, strategy: LOAN_TYPES[quote.loanType], experience: EXPERIENCE_LABEL[quote.experience], city: quote.address.city, state: quote.address.state, propertyValueCents: Math.round(quote.purchasePrice * 100), renovationCents: Math.round(quote.rehab * 100), requestedLoanCents: Math.round((quote.requestedAmount ?? 0) * 100), targetClosing: quote.fundingDate, notes: quote.notes || "(no notes)" };
  let leadId: string;
  try {
    const sealed = sealLead(details);
    leadId = (await prisma.lead.create({ data: { ...sealed, submitter: quote.submitter, arvCents: quote.arv ? Math.round(quote.arv * 100) : null, quote: sealQuote(quote, sealed.id) } })).id;
  } catch (error) {
    console.error("[lendhous-leads] could not save a quote request:", error);
    return { sent: false, error: "We couldn't send this just now. Please try again in a few minutes." };
  }
  try {
    await audit({ actorId: null, action: "lead.created", entityType: "Lead", entityId: leadId, after: { kind: "quote", submitter: quote.submitter } });
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    await notifyTeam(`New quote request: ${LOAN_TYPES[quote.loanType]}, ${quote.address.city}, ${quote.address.state}`, `${quoteSummary(quote)}\n\nOpen the leads inbox: ${origin}/admin/leads`, "lead.new", contact.email);
  } catch (error) {
    console.error("[lendhous-leads] could not alert the team:", error);
  }
  return { sent: true, error: "", photoKey: await issuePhotoKey(leadId).catch(() => undefined) };
}

export async function markLeadContacted(formData: FormData) {
  const user = await requirePermission("view_pipeline");
  const id = String(formData.get("id") || "");
  await prisma.lead.update({ where: { id }, data: { contactedAt: new Date() } });
  await audit({ actorId: user.id, action: "lead.contacted", entityType: "Lead", entityId: id });
  revalidatePath("/admin/leads");
}
