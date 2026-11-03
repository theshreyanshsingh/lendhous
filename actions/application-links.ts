"use server";

import { revalidatePath } from "next/cache";
import { createApplicationLink, digestOf, linkSummaries, markSigned, openApplicationLink, saveDraft, signedApplication } from "@/lib/application-links";
import { audit } from "@/lib/audit";
import { hasPermission, requirePermission } from "@/lib/auth";
import type { Viewer } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { readBook, runAction } from "@/lib/book-store";
import { completeDraft, CONSENT_VERSION, CONSENTS, draftFromBrief, draftFromDeal, draftFromQuote, LINK_DAYS, signProblems, STEPS, toLoan, withoutSsn, type AppDraft, type ConsentKey } from "@/lib/borrower-application";
import { isDemoEmail } from "@/lib/deploy";
import { notify, notifyTeam } from "@/lib/email";
import { openLead, openQuote } from "@/lib/lead-store";
import { borrowerFor, screenAutomatically, staffActor } from "@/lib/loan-intake";
import { notDeleted, prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { servicingDate } from "@/lib/servicing";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DRAFT = 200_000;

/**
 * Sends a borrower the application link, for a website lead or a loan already started. Prefilled with what's known, so
 * they only add what's missing. The address comes back once, for the loan officer to copy.
 */
export async function sendApplicationLink(input: { leadId?: string; dealId?: string; name: string; email: string }): Promise<{ url?: string; error?: string }> {
  const actor = await requirePermission("view_pipeline");
  if (isDemoEmail(actor.email)) return { error: "Demo accounts keep their records in the browser. Send links from a real account." };
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || !EMAIL.test(email)) return { error: "Add the borrower's name and email address." };
  let draft: AppDraft;
  if (input.dealId) {
    const deal = (await readBook()).book.deals.find((item) => item.id === input.dealId);
    if (!deal) return { error: "That loan no longer exists." };
    if (!["submitted", "initial_review", "underwriting"].includes(deal.status) || deal.creditReview) return { error: "This loan is past review; update it on the loan page instead." };
    draft = draftFromDeal(deal, email);
  } else if (input.leadId) {
    const row = await prisma.lead.findFirst({ where: { id: input.leadId, ...notDeleted } });
    if (!row) return { error: "That lead no longer exists." };
    if (row.loanId) return { error: "This lead already has a loan. Send the link from the loan instead." };
    const quote = openQuote(row);
    draft = quote ? draftFromQuote(quote) : draftFromBrief(openLead(row));
  } else return { error: "Choose a lead or a loan." };
  const { id, url } = await createApplicationLink({ dealId: input.dealId, leadId: input.leadId, recipient: { name, email }, officer: actor.name, sentById: actor.id, draft });
  await notify(email, "Your LendHous loan application", `Hi ${name.split(" ")[0]},\n\n${actor.name} at LendHous has asked for a few details to finish your loan application. It takes about 15 minutes and saves as you go, so you can come back to it any time in the next ${LINK_DAYS} days:\n\n${url}\n\nThis link is just for you; please don't forward it. LendHous will never ask you to send wire instructions or your Social Security number by email.`, { eventCode: "application.link" });
  await audit({ actorId: actor.id, action: "application.link_sent", entityType: "ApplicationLink", entityId: id, after: { leadId: input.leadId, dealId: input.dealId } });
  if (input.leadId) await prisma.lead.update({ where: { id: input.leadId }, data: { contactedAt: new Date() } });
  revalidatePath("/admin/leads");
  return { url };
}

/** Saves the form as the borrower goes. Only while the link is open; capped so a link can't be used as storage. */
export async function saveApplicationDraft(token: string, raw: unknown, step: number): Promise<{ savedAt?: string; error?: string }> {
  const link = await openApplicationLink(token);
  if (!link || link.state !== "open") return { error: "This link no longer works. Ask your loan officer for a new one." };
  if (!(await consumeRateLimit(`applink:${link.row.id}`, 900, 60 * 60 * 1000))) return { error: "Saving too often. Wait a minute." };
  const draft = completeDraft(raw);
  if (JSON.stringify(draft).length > MAX_DRAFT) return { error: "That's more than the form holds." };
  const now = new Date();
  await saveDraft(link.row.id, draft, Math.max(0, Math.min(STEPS.length - 1, Math.round(step) || 0)), now);
  return { savedAt: now.toISOString() };
}

/**
 * Signs the application: checks it's complete, records the signature with the consents and where it came from, and
 * puts the loan in the book (a new one for a lead, or the details on the loan it was sent for).
 */
export async function signApplication(token: string, raw: unknown, consents: Record<ConsentKey, boolean>, signatureName: string): Promise<{ done?: boolean; error?: string }> {
  const link = await openApplicationLink(token);
  if (!link || link.state !== "open") return { error: "This link no longer works. Ask your loan officer for a new one." };
  const draft = completeDraft(raw);
  const today = servicingDate(new Date());
  const problems = signProblems(draft, today);
  if (problems.length) return { error: problems[0] };
  if (!CONSENTS.every((item) => consents[item.key] === true)) return { error: "Check each of the four boxes to agree." };
  const signer = signatureName.replace(/\s+/g, " ").trim();
  const names = [draft.contact, ...draft.guarantors].map((person) => `${person.firstName} ${person.lastName}`.replace(/\s+/g, " ").trim().toLowerCase());
  if (!names.includes(signer.toLowerCase())) return { error: "Type your full legal name exactly as you entered it in the application." };
  const sender = await staffActor(link.row.sentById);
  if (!sender) return { error: "Your loan officer's account has changed. Ask them for a new link." };
  const loan = toLoan(draft);
  const actor: Viewer = { id: `application-link:${link.row.id}`, name: signer, roleCodes: [] };
  let dealId = link.row.dealId ?? "";
  if (dealId) {
    const result = await runAction(actor, { t: "applyBorrowerInfo", dealId, app: loan.app, address: loan.address, city: loan.city, zip: loan.zip, entityName: loan.entityName, exitStrategy: loan.exitStrategy, sponsor: loan.sponsor, signedBy: signer }, { trusted: true });
    if (!("error" in result)) await sendAlerts(result.before, result.after, result.action);
  } else {
    // A new loan, started by the loan officer who sent the link, for the borrower's portal account.
    const account = await borrowerFor(sender, loan.borrowerName, loan.email, true);
    if (account.error) return { error: "We couldn't set up your portal account. Your loan officer will be in touch." };
    const result = await runAction(sender, { t: "submitApp", app: loan.app, address: loan.address, city: loan.city, zip: loan.zip, entityName: loan.entityName, exitStrategy: loan.exitStrategy, client: { name: loan.borrowerName, borrowerId: account.id }, source: "website_lead", sponsor: loan.sponsor });
    if ("error" in result) return { error: result.error };
    dealId = result.after.deals.find((item) => !result.before.deals.some((old) => old.id === item.id))!.id;
    await sendAlerts(result.before, result.after, result.action);
    if (link.row.leadId) await prisma.lead.update({ where: { id: link.row.leadId }, data: { loanId: dealId } });
  }
  const meta = await requestMeta();
  await markSigned(link.row.id, draft, { name: signer, at: new Date().toISOString(), ip: meta.ipAddress, userAgent: meta.userAgent ?? "", consents, version: CONSENT_VERSION, digest: digestOf(draft) }, dealId);
  await audit({ actorId: null, action: "application.signed", entityType: "ApplicationLink", entityId: link.row.id, after: { dealId, consentVersion: CONSENT_VERSION } });
  await screenAutomatically(dealId);
  await notifyTeam(`Application signed: ${loan.borrowerName}`, `${signer} signed the loan application for ${loan.address}, ${loan.city}. Open it in the pipeline.`, "application.signed").catch(() => {});
  return { done: true };
}

export async function turnOffApplicationLink(id: string) {
  const actor = await requirePermission("view_pipeline");
  await prisma.applicationLink.updateMany({ where: { id, status: "open" }, data: { status: "off" } });
  await audit({ actorId: actor.id, action: "application.link_off", entityType: "ApplicationLink", entityId: id });
  revalidatePath("/admin/leads");
}

/** The signed application on a loan, for the team, with Social Security numbers masked. */
export async function applicationOnFile(dealId: string) {
  const actor = await requirePermission("view_pipeline");
  const signed = await signedApplication(dealId);
  const links = await linkSummaries({ dealIds: [dealId] });
  const open = links.find((item) => item.state === "open");
  if (!signed) return { signed: null, open: open ?? null };
  await audit({ actorId: actor.id, action: "application.viewed", entityType: "ApplicationLink", entityId: signed.id });
  return { signed: { draft: withoutSsn(signed.draft), signature: signed.signature, officer: signed.officer }, open: open ?? null };
}

/** One guarantor's full Social Security number, for someone allowed to see it. Every reveal is logged. */
export async function revealSsn(dealId: string, index: number): Promise<{ ssn?: string; error?: string }> {
  const actor = await requirePermission("view_pipeline");
  if (!(await hasPermission(actor, "reveal_sensitive"))) return { error: "Your account can't see full Social Security numbers." };
  const signed = await signedApplication(dealId);
  const guarantor = signed?.draft.guarantors[index];
  if (!signed || !guarantor) return { error: "That isn't on file." };
  await audit({ actorId: actor.id, action: "pii.revealed", entityType: "ApplicationLink", entityId: signed.id, after: { field: "ssn", guarantor: index } });
  return { ssn: guarantor.ssn };
}

