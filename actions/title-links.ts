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
import { drawAmount, searchFrom } from "@/lib/title-updates";
import { ID_METHODS } from "@/lib/seller-checks";
import type { SellerIdMethod } from "@/lib/mockData";

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

/**
 * The title company confirms how it checked the seller's identity, on a sale of land or by an owner who lives elsewhere
 * (lib/seller-checks.ts). Funding waits for it.
 */
export async function titleVerifySeller(token: string, raw: unknown): Promise<TitleReply> {
  const { link, error } = await titleLink(token);
  if (!link) return { error };
  const parsed = z.object({ method: z.string(), note: z.string().trim().max(500) }).safeParse(raw);
  if (!parsed.success || !(parsed.data.method in ID_METHODS)) return { error: "Choose how you checked the seller's identity." };
  const result = await runAction(titleActor(link.deal), { t: "verifySeller", dealId: link.deal.id, method: parsed.data.method as SellerIdMethod, note: parsed.data.note, by: titleActor(link.deal).name }, { trusted: true });
  if ("error" in result) return { error: result.error };
  await sendAlerts(result.before, result.after, result.action);
  await audit({ actorId: null, action: "closing.seller_verified", entityType: "LoanBook", entityId: link.deal.id });
  return { view: viewOf(result.after, link.deal.id) };
}

/**
 * Asks the title company to search the records since the mortgage was recorded, before a draw goes out (lib/title-updates.ts).
 * The closing link has usually run out by the first draw, so a new one goes with the request and replaces any older one.
 */
export async function askTitleForUpdate(drawId: string): Promise<StaffReply> {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  const allowed = await permissionCheck(viewer);
  if (!(allowed("approve_draw") || allowed("assign_inspection") || allowed("manage_conditions"))) return { error: "Your account can't ask for title searches." };
  if (!(await consumeRateLimit(`title-send:${viewer.id}`, 30, 60 * 60 * 1000))) return { error: "Too many requests for now. Wait a while and try again." };
  const { book } = await readBook();
  const draw = book.draws.find((item) => item.id === drawId);
  if (!draw || draw.status === "funded" || draw.status === "rejected") return { error: "That draw has already been decided." };
  const deal = book.deals.find((item) => item.id === draw.dealId);
  if (!deal || !SENDABLE.includes(deal.status)) return { error: "That loan is no longer open." };
  const email = (deal.closing?.email ?? "").trim().toLowerCase();
  if (!deal.closing?.company || !EMAIL.test(email)) return { error: "Save the title company and its closer's email on the loan's Closing tab first." };
  const name = deal.closing.contact.trim() || deal.closing.company;
  const expiresAt = new Date(Date.now() + TITLE_LINK_DAYS * 86_400_000).toISOString();
  const sentBy = `${viewer.name} at LendHous`;
  const opened = await runAction(viewer, { t: "openTitleLink", dealId: deal.id, sentTo: name, email, sentBy, expiresAt }, { trusted: true });
  if ("error" in opened) return { error: opened.error };
  const link = await createTitleLink(deal.id, expiresAt);
  const asked = await runAction(viewer, { t: "askTitleUpdate", drawId, to: email, by: viewer.name }, { trusted: true });
  if ("error" in asked) return { error: asked.error };
  const since = searchFrom(deal);
  const amount = `$${drawAmount(draw).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const body = [
    `Hi ${name.split(" ")[0]},`,
    `Before we release a construction draw of ${amount} on ${deal.entityName}'s loan on ${deal.address}, ${deal.city} (your file ${deal.closing.fileNumber || "number not given"}), please search the official records for anything recorded against the property since ${since ? `the mortgage was recorded on ${longDate(`${since}T12:00:00Z`)}` : "our mortgage was recorded"}: liens, judgments, lis pendens, a new notice of commencement or a deed.`,
    "Tell us what you find, and upload your search or date-down if you have one, through this secure link:",
    link,
    `It works until ${longDate(expiresAt)} and replaces any link we sent before. Please don't forward it.`,
  ].join("\n\n");
  await notify(email, `Title search before a draw: ${deal.address}, ${deal.city}`, body, { eventCode: "closing.title_update" });
  await audit({ actorId: viewer.id, action: "closing.title_update_asked", entityType: "LoanBook", entityId: deal.id });
  return { book: scopeBook(asked.after, viewer), link };
}

const viewOf = (book: Book, dealId: string) => { const deal = book.deals.find((item) => item.id === dealId)!; return titleView(deal, evaluate(deal.app).noteAmount, book.draws); };
