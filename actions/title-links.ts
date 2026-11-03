"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import type { Book } from "@/lib/book";
import { scopeBook } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { permissionCheck, readBook, runAction } from "@/lib/book-store";
import { TITLE_LINK_DAYS, titleView, type TitleView } from "@/lib/closing";
import { isDemoEmail } from "@/lib/deploy";
import { notify } from "@/lib/email";
import { evaluate } from "@/lib/engine";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createTitleLink, deleteTitleLink, openTitleLink, titleActor } from "@/lib/title-links";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// From an accepted term sheet until the mortgage is recorded.
const SENDABLE = ["term_sheet_accepted", "conditions", "clear_to_close", "closing", "funded", "servicing_current", "servicing_delinquent", "matured", "default"];
const longDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

type StaffReply = { book?: Book; error?: string; link?: string };

/** Staff who handle closings, on a real account. Demo seats keep their records in the browser. */
async function closer() {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser. Preview the title company's page at /closing/demo." };
  const allowed = await permissionCheck(viewer);
  return allowed("manage_conditions") || allowed("approve_funding") ? { viewer } : { error: "Your account can't send closing links." };
}

/**
 * Sends the title company its secure link to this loan's closing: the checklist to upload to, the form for its own wire
 * instructions, and funding and recording. Emailed to them, and shown here once to copy.
 */
export async function sendTitleLink(dealId: string, to: { name: string; email: string }): Promise<StaffReply> {
  const { viewer, error } = await closer();
  if (!viewer) return { error };
  if (!(await consumeRateLimit(`title-send:${viewer.id}`, 30, 60 * 60 * 1000))) return { error: "Too many links for now. Wait a while and try again." };
  const deal = (await readBook()).book.deals.find((item) => item.id === dealId);
  if (!deal) return { error: "That loan no longer exists." };
  if (!SENDABLE.includes(deal.status)) return { error: "Send the title company a link once the term sheet is accepted." };
  if (!deal.closing?.company) return { error: "Save the closing agent first." };
  const name = to.name.trim();
  const email = to.email.trim().toLowerCase();
  if (!name || !EMAIL.test(email)) return { error: "Add the closer's name and email address." };
  const expiresAt = new Date(Date.now() + TITLE_LINK_DAYS * 86_400_000).toISOString();
  const sentBy = `${viewer.name} at LendHous`;
  const result = await runAction(viewer, { t: "openTitleLink", dealId, sentTo: name, email, sentBy, expiresAt }, { trusted: true });
  if ("error" in result) return { error: result.error };
  const link = await createTitleLink(dealId, expiresAt);
  await notify(email, `Closing file for ${deal.address}, ${deal.city}`, `Hi ${name.split(" ")[0]},\n\n${sentBy} has opened a secure closing file for ${deal.entityName}'s loan on ${deal.address}, ${deal.city} (your file ${deal.closing.fileNumber || "number not given"}).\n\nUse it to upload the title commitment, closing protection letter, settlement statement, signed loan documents and the recorded mortgage, and to give us your escrow account's wire instructions. We will call your office at a number we look up ourselves to confirm them before any money is sent. Please never email wire instructions.\n\n${link}\n\nThe link works until ${longDate(expiresAt)}. Please don't forward it.`, { eventCode: "closing.link" });
  await audit({ actorId: viewer.id, action: "closing.link_sent", entityType: "LoanBook", entityId: dealId });
  return { book: scopeBook(result.after, viewer), link };
}

/** Stops the title company's link at once. What it already sent stays on the loan. */
export async function turnOffTitleLink(dealId: string): Promise<StaffReply> {
  const { viewer, error } = await closer();
  if (!viewer) return { error };
  const result = await runAction(viewer, { t: "turnOffTitleLink", dealId });
  if ("error" in result) return { error: result.error };
  await deleteTitleLink(dealId);
  await audit({ actorId: viewer.id, action: "closing.link_off", entityType: "LoanBook", entityId: dealId });
  return { book: scopeBook(result.after, viewer) };
}

type TitleReply = { view?: TitleView; error?: string };

/** The link if it can still act, rate limited, or the reply explaining why not. */
async function titleLink(token: string) {
  const link = await openTitleLink(token);
  if (!link) return { error: "This link has expired or isn't valid. Ask LendHous for a new one." };
  if (link.state !== "open") return { error: "This link has been turned off. Ask LendHous for a new one." };
  if (!(await consumeRateLimit(`title-link:${link.deal.id}`, 300, 60 * 60 * 1000))) return { error: "Too many changes at once. Wait a minute and try again." };
  return { link };
}

const wireInput = z.object({ bankName: z.string().trim().min(1).max(120), beneficiary: z.string().trim().min(1).max(160), routing: z.string().trim().max(20), account: z.string().trim().max(30), reference: z.string().trim().max(160) });

/**
 * The title company enters its escrow account's wire instructions itself, so nobody at LendHous types them. They still
 * need LendHous's call-back before funding, and a change clears any approval and alerts the team.
 */
export async function titleEnterWire(token: string, raw: unknown): Promise<TitleReply> {
  const { link, error } = await titleLink(token);
  if (!link) return { error };
  const parsed = wireInput.safeParse(raw);
  if (!parsed.success) return { error: "Add the bank, the account name, the routing number and the account number." };
  const result = await runAction(titleActor(link.deal), { t: "enterWire", dealId: link.deal.id, wireId: `wire${randomUUID()}`, ...parsed.data, source: "Title company's secure portal", by: titleActor(link.deal).name }, { trusted: true });
  if ("error" in result) return { error: result.error };
  await sendAlerts(result.before, result.after, result.action);
  await audit({ actorId: null, action: "closing.wire_entered", entityType: "LoanBook", entityId: link.deal.id });
  return { view: viewOf(result.after, link.deal.id) };
}

export async function titleConfirmFunds(token: string, raw: unknown): Promise<TitleReply> {
  const { link, error } = await titleLink(token);
  if (!link) return { error };
  const parsed = z.object({ amount: z.number().positive().max(100_000_000), on: z.string() }).safeParse(raw);
  if (!parsed.success) return { error: "Enter the amount and the date it arrived." };
  const result = await runAction(titleActor(link.deal), { t: "titleFundsReceived", dealId: link.deal.id, ...parsed.data, by: titleActor(link.deal).name }, { trusted: true });
  if ("error" in result) return { error: result.error === "That can't be done right now." ? "The loan isn't at closing yet, or that date is in the future." : result.error };
  await sendAlerts(result.before, result.after, result.action);
  await audit({ actorId: null, action: "closing.funds_received", entityType: "LoanBook", entityId: link.deal.id });
  return { view: viewOf(result.after, link.deal.id) };
}

export async function titleRecordMortgage(token: string, raw: unknown): Promise<TitleReply> {
  const { link, error } = await titleLink(token);
  if (!link) return { error };
  const parsed = z.object({ on: z.string(), reference: z.string().trim().min(1).max(200) }).safeParse(raw);
  if (!parsed.success) return { error: "Enter the recording date and the book and page, or the instrument number." };
  const result = await runAction(titleActor(link.deal), { t: "titleRecording", dealId: link.deal.id, ...parsed.data, by: titleActor(link.deal).name }, { trusted: true });
  if ("error" in result) return { error: result.error === "That can't be done right now." ? "The mortgage is recorded after the loan funds, on a date today or earlier." : result.error };
  await sendAlerts(result.before, result.after, result.action);
  await audit({ actorId: null, action: "closing.recorded", entityType: "LoanBook", entityId: link.deal.id });
  return { view: viewOf(result.after, link.deal.id) };
}

const viewOf = (book: Book, dealId: string) => { const deal = book.deals.find((item) => item.id === dealId)!; return titleView(deal, evaluate(deal.app).noteAmount); };
