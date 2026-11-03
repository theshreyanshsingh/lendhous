// The link that comes with each payoff letter. A random secret in the email; only its hash is kept. Every link opens the
// request's newest letter, so someone holding an older email sees the correction rather than out-of-date figures.
import { createHash, randomBytes } from "node:crypto";
import { readBook } from "./book-store";
import { latestLetter } from "./payoffs";
import { prisma } from "./prisma";
import { addDays } from "./servicing";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
/** How long after its good-through date a letter's link still opens it: long enough to close and record. */
export const LINK_DAYS_AFTER = 30;

/** Makes a link for a letter just sent. The address comes back once and is never stored. */
export async function createPayoffLink(payoffId: string, number: number, goodThrough: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(`${addDays(goodThrough, LINK_DAYS_AFTER)}T23:59:59-05:00`);
  await prisma.payoffLink.create({ data: { payoffId, number, tokenHash: hashOf(token), expiresAt } });
  return { link: `${origin()}/payoff-letter/${token}`, expiresAt };
}

/** What a link opens, or null if it's unknown or past its date. */
export async function openPayoffLink(token: string) {
  if (!token || token.length > 100) return null;
  const row = await prisma.payoffLink.findUnique({ where: { tokenHash: hashOf(token) } });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const book = (await readBook()).book;
  const request = book.payoffs.find((item) => item.id === row.payoffId);
  const deal = request && book.deals.find((item) => item.id === request.dealId);
  const letter = request && latestLetter(request);
  if (!request || !deal || !letter) return null;
  return { request, deal, letter, sent: row.number, expiresAt: row.expiresAt };
}
