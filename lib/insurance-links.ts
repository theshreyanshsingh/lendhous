// The borrower's insurance agent's link (lib/insurance-agent.ts). A random secret shown once; only its hash is kept, one
// per loan. What it may do is checked against the loan as it is now, because a loan can close out or a link be turned off
// while the agent has the page open.
import { createHash, randomBytes } from "node:crypto";
import type { Viewer } from "./book-access";
import { readBook } from "./book-store";
import { agentLinkState, agentView } from "./insurance-agent";
import type { Deal } from "./mockData";
import { prisma } from "./prisma";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/** Makes the loan's link, replacing any earlier one. The address comes back once and is never stored. */
export async function createInsuranceLink(dealId: string, expiresAt: string) {
  const token = randomBytes(32).toString("base64url");
  const data = { tokenHash: hashOf(token), expiresAt: new Date(expiresAt) };
  await prisma.insuranceLink.upsert({ where: { dealId }, create: { dealId, ...data }, update: data });
  return `${origin()}/insurance/${token}`;
}

export const deleteInsuranceLink = (dealId: string) => prisma.insuranceLink.deleteMany({ where: { dealId } });

/** What a link opens, or null if it's unknown or past its date. The caller still checks the state before acting. */
export async function openInsuranceLink(token: string) {
  if (!token || token.length > 100) return null;
  const row = await prisma.insuranceLink.findUnique({ where: { tokenHash: hashOf(token) } });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === row.dealId);
  if (!deal) return null;
  return { deal, state: agentLinkState(deal), view: agentView(deal) };
}

/** Who the server acts as for the agent. No roles, so it can do only what a trusted step does for it. */
export const agentActor = (deal: Deal): Viewer => ({ id: `insurance-link:${deal.id}`, name: `${deal.insuranceLink?.sentTo || deal.agents?.insurance?.name || "Insurance agent"} (insurance agent)`, roleCodes: [] });
