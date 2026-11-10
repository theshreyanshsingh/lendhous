"use server";

import { createApplicationLink, linkSummaries } from "@/lib/application-links";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { parseAction } from "@/lib/book-actions";
import { firmOf, scopeBook, type Viewer } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { readBook, runAction } from "@/lib/book-store";
import { draftFromDeal, LINK_DAYS } from "@/lib/borrower-application";
import { isDemoEmail } from "@/lib/deploy";
import { notify } from "@/lib/email";
import { screenAutomatically } from "@/lib/loan-intake";
import { viewFor } from "@/lib/permissions";
import { consumeRateLimit } from "@/lib/rate-limit";
import type { Book } from "@/lib/book";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Before review starts, the client can still fill in their own details; after that the team updates the loan. */
const OPEN = ["submitted", "initial_review", "underwriting"];

/** The broker asking, and one of their deals, or why not. */
async function brokerDeal(dealId: string) {
  const user = await requireUser();
  if (viewFor(user.roleCodes) !== "broker") return { error: "Only a broker can do that." } as const;
  if (isDemoEmail(user.email)) return { error: "Demo accounts keep their records in the browser: no link is sent." } as const;
  const book = (await readBook()).book;
  const deal = book.deals.find((item) => item.id === dealId && item.brokerId === firmOf(user));
  return deal ? ({ user, book, deal } as const) : ({ error: "That deal isn't one of yours." } as const);
}

/**
 * The application link to the broker's client: their guarantors, past deals and credit answers, signed by them, filled in
 * on a secure page instead of by the broker (lib/application-links.ts). A new one turns off the last.
 */
async function sendLink(user: Viewer & { email: string }, book: Book, dealId: string, name: string, email: string) {
  const deal = book.deals.find((item) => item.id === dealId)!;
  const firm = book.brokers.find((item) => item.id === deal.brokerId)?.name ?? "your broker";
  const { id, url } = await createApplicationLink({ dealId, recipient: { name, email }, officer: `${user.name} (${firm})`, sentById: user.id, draft: draftFromDeal(deal, email) });
  await notify(email, "Your LendHous loan application", `Hi ${name.split(" ")[0]},\n\n${user.name} at ${firm} has sent LendHous your loan for ${deal.address}, ${deal.city}. To go ahead, LendHous needs a few details from you: who guarantees the loan, your past deals and some credit questions. It takes about 15 minutes and saves as you go, so you can come back to it any time in the next ${LINK_DAYS} days:\n\n${url}\n\nThis link is just for you; please don't forward it. LendHous will never ask you to send wire instructions or your Social Security number by email.`, { eventCode: "application.link" });
  await audit({ actorId: user.id, action: "application.link_sent", entityType: "ApplicationLink", entityId: id, after: { dealId, by: "broker" } });
}

/** A broker's deal whose client fills in their own details: it goes in, and the client gets the link straight away. */
export async function submitForClient(input: { action: unknown; clientEmail: string }): Promise<{ book?: Book; dealId?: string; error?: string }> {
  const user = await requireUser();
  if (viewFor(user.roleCodes) !== "broker") return { error: "Only a broker can do that." };
  if (isDemoEmail(user.email)) return { error: "Demo accounts keep their records in the browser." };
  const action = parseAction(input.action);
  if (!action || action.t !== "submitApp") return { error: "That request wasn't valid." };
  const email = String(input.clientEmail ?? "").trim().toLowerCase();
  const name = action.client?.name?.trim() ?? "";
  if (!name || !EMAIL.test(email)) return { error: "Add your client's name and email, so we can send them the link." };
  if (!(await consumeRateLimit(`broker-link:${user.id}`, 30, 60 * 60 * 1000))) return { error: "That's a lot of links in an hour. Wait a few minutes." };
  const result = await runAction(user, { ...action, sponsor: undefined, clientFills: true });
  if ("error" in result) return { error: result.error };
  const deal = result.after.deals.find((item) => !result.before.deals.some((old) => old.id === item.id))!;
  await audit({ actorId: user.id, action: "book.submitApp", entityType: "LoanBook", entityId: deal.id, after: { loanNumber: deal.loanNumber, clientFills: true } });
  await sendAlerts(result.before, result.after, result.action);
  await sendLink(user, result.after, deal.id, name, email);
  const screened = await screenAutomatically(deal.id);
  return { book: scopeBook(screened ?? result.after, user), dealId: deal.id };
}

export type ClientLink = { state: "open" | "expired" | "signed" | "off"; to: string; sentAt: string; expiresAt: string; signedAt: string | null };

/** Where the client's link on one of the broker's deals stands, or none sent. */
export async function clientLinkStatus(dealId: string): Promise<{ link?: ClientLink | null; error?: string }> {
  const found = await brokerDeal(dealId);
  if ("error" in found) return { error: found.error };
  const latest = (await linkSummaries({ dealIds: [dealId] }))[0];
  return { link: latest ? { state: latest.state, to: latest.to, sentAt: latest.createdAt, expiresAt: latest.expiresAt, signedAt: latest.signedAt } : null };
}

/** Sends the client a new link (the old one stops working), while the deal is still before review. */
export async function resendClientLink(dealId: string, name: string, email: string): Promise<{ ok?: boolean; error?: string }> {
  const found = await brokerDeal(dealId);
  if ("error" in found) return { error: found.error };
  const to = email.trim().toLowerCase();
  if (!name.trim() || !EMAIL.test(to)) return { error: "Add your client's name and email." };
  if (!OPEN.includes(found.deal.status) || found.deal.creditReview) return { error: "LendHous has started reviewing this loan; message your loan team to change your client's details." };
  if (!(await consumeRateLimit(`broker-link:${found.user.id}`, 30, 60 * 60 * 1000))) return { error: "That's a lot of links in an hour. Wait a few minutes." };
  await sendLink(found.user, found.book, dealId, name.trim(), to);
  return { ok: true };
}
