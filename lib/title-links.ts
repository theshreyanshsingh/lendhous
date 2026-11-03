// The title company's link. A random secret shown once; only its hash is kept, one per loan. What it may do is checked
// against the loan as it is now (lib/closing.ts titleLinkState), because a loan can end or a link be turned off while
// the title company has the page open.
import { createHash, randomBytes } from "node:crypto";
import type { Viewer } from "./book-access";
import { readBook } from "./book-store";
import { titleLinkState, titleView } from "./closing";
import { evaluate } from "./engine";
import type { Deal } from "./mockData";
import { prisma } from "./prisma";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/** Makes the loan's link, replacing any earlier one. The address comes back once and is never stored. */
export async function createTitleLink(dealId: string, expiresAt: string) {
  const token = randomBytes(32).toString("base64url");
  const data = { tokenHash: hashOf(token), expiresAt: new Date(expiresAt) };
  await prisma.closingLink.upsert({ where: { dealId }, create: { dealId, ...data }, update: data });
  return `${origin()}/closing/${token}`;
}

export const deleteTitleLink = (dealId: string) => prisma.closingLink.deleteMany({ where: { dealId } });

/** What a link opens, or null if it's unknown or past its date. The caller still checks the state before acting. */
export async function openTitleLink(token: string) {
  if (!token || token.length > 100) return null;
  const row = await prisma.closingLink.findUnique({ where: { tokenHash: hashOf(token) } });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const deal = (await readBook()).book.deals.find((item) => item.id === row.dealId);
  if (!deal) return null;
  return { deal, state: titleLinkState(deal), view: titleView(deal, evaluate(deal.app).noteAmount) };
}

/** Who the server acts as for the title company. No roles, so it can do only what a trusted step does for it. */
export const titleActor = (deal: Deal): Viewer => ({ id: `title-link:${deal.id}`, name: `${deal.closing?.contact || deal.closing?.company || "Title company"} (title company)`, roleCodes: [] });
