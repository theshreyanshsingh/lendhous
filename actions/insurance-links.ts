"use server";

import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import type { Book } from "@/lib/book";
import { firmOf, scopeBook } from "@/lib/book-access";
import { permissionCheck, readBook, runAction } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { notify } from "@/lib/email";
import { INSURED } from "@/lib/insurance";
import { AGENT_LINK_DAYS } from "@/lib/insurance-agent";
import { createInsuranceLink, deleteInsuranceLink } from "@/lib/insurance-links";
import type { Deal } from "@/lib/mockData";
import { viewFor } from "@/lib/permissions";
import { consumeRateLimit } from "@/lib/rate-limit";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const longDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

type Reply = { book?: Book; error?: string; link?: string };

/**
 * Who may send or stop the agent's link: the team that keeps the insurance file, or the borrower (or their broker) on
 * their own loan. A borrower sends it only to the agent they named, so the link can't be pointed anywhere else.
 */
async function sender(dealId: string) {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser. Preview the agent's page at /insurance/demo." };
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === dealId);
  if (!deal) return { error: "That loan no longer exists." };
  const view = viewFor(viewer.roleCodes);
  if (view === "admin") {
    const allowed = await permissionCheck(viewer);
    return allowed("manage_conditions") || allowed("service_loans") || allowed("approve_draw") || allowed("assign_inspection") ? { viewer, deal, staff: true } : { error: "Your account can't send insurance links." };
  }
  const own = (view === "borrower" && deal.borrowerId === viewer.id) || (view === "broker" && deal.brokerId === firmOf(viewer));
  return own ? { viewer, deal, staff: false } : { error: "Your account can't send insurance links." };
}

/**
 * Sends the borrower's insurance agent a secure page for this loan: the mortgagee clause, the cover the loan needs, and
 * where to send the binder and declarations page. Emailed to them, and shown here once to copy.
 */
export async function sendInsuranceLink(dealId: string, to?: { name: string; email: string }): Promise<Reply> {
  const who = await sender(dealId);
  if (!("viewer" in who) || !who.viewer || !who.deal) return { error: who.error };
  const { viewer, deal, staff } = who as { viewer: Awaited<ReturnType<typeof requireUser>>; deal: Deal; staff: boolean };
  if (!(await consumeRateLimit(`insurance-send:${viewer.id}`, 20, 60 * 60 * 1000))) return { error: "Too many links for now. Wait a while and try again." };
  if (!INSURED.includes(deal.status)) return { error: "The agent's link opens once the term sheet is accepted, while the loan is open." };
  const named = deal.agents?.insurance;
  const name = (staff ? to?.name ?? named?.name ?? "" : named?.name || named?.company || "").trim();
  const email = (staff ? to?.email ?? named?.email ?? "" : named?.email ?? "").trim().toLowerCase();
  if (!name || !EMAIL.test(email)) return { error: staff ? "Add the agent's name and email address." : "Add your insurance agent's name and email under Your agents first." };
  const expiresAt = new Date(Date.now() + AGENT_LINK_DAYS * 86_400_000).toISOString();
  const sentBy = staff ? `${viewer.name} at LendHous` : `${viewer.name}, the borrower`;
  const result = await runAction(viewer, { t: "openInsuranceLink", dealId, sentTo: name, email, sentBy, expiresAt }, { trusted: true });
  if ("error" in result) return { error: result.error };
  const link = await createInsuranceLink(dealId, expiresAt);
  await notify(email, `Insurance for ${deal.address}, ${deal.city}`, `Hi ${name.split(" ")[0]},\n\n${sentBy} has opened a secure page for ${deal.entityName}'s loan with LendHous on ${deal.address}, ${deal.city}.\n\nIt shows the mortgagee clause to put on the policy and the cover the loan needs. Please use it to send the binder or declarations page for each policy; it checks the dates, the cover and the clause as you go, so anything missing is caught before closing.\n\n${link}\n\nThe link works until ${longDate(expiresAt)}. Please don't forward it.`, { eventCode: "insurance.agent_link" });
  await audit({ actorId: viewer.id, action: "insurance.link_sent", entityType: "LoanBook", entityId: dealId });
  return { book: scopeBook(result.after, viewer), link };
}

/** Stops the agent's link at once. What the agent already sent stays on the loan. */
export async function turnOffInsuranceLink(dealId: string): Promise<Reply> {
  const who = await sender(dealId);
  if (!("viewer" in who) || !who.viewer) return { error: who.error };
  const result = await runAction(who.viewer, { t: "turnOffInsuranceLink", dealId }, { trusted: true });
  if ("error" in result) return { error: result.error };
  await deleteInsuranceLink(dealId);
  await audit({ actorId: who.viewer.id, action: "insurance.link_off", entityType: "LoanBook", entityId: dealId });
  return { book: scopeBook(result.after, who.viewer) };
}
