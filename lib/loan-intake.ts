// Server steps shared by the ways a loan starts (the portal application, staff starting one, the signed application
// link): finding or inviting the borrower's portal account, and screening new names against the sanctions list. These are
// plain functions, not server actions, so no browser can call them directly.
import type { Viewer } from "./book-access";
import { sendAlerts } from "./book-alerts";
import { readBook, runAction } from "./book-store";
import { accessFor } from "./member-rules";
import { inviteMember } from "./members";
import { prisma } from "./prisma";
import { screenDeal } from "./sanctions-store";

export type IntakeActor = Viewer & { organizationId: string | null };

/** The borrower's portal account: an existing one by email, or a new one invited now. None without an email. */
export async function borrowerFor(actor: IntakeActor, name: string, email: string, invite: boolean): Promise<{ id?: string; error?: string }> {
  const address = email.trim().toLowerCase();
  if (!address) return { id: undefined };
  const found = await prisma.user.findUnique({ where: { email: address } });
  if (found && !found.deletedAt) return { id: found.id };
  if (!invite) return { id: undefined };
  const result = await inviteMember(actor, { name, email: address, title: "", roles: ["BORROWER"], permissions: accessFor(["BORROWER"]) });
  if ("error" in result) return { error: result.error };
  return { id: (await prisma.user.findUniqueOrThrow({ where: { email: address } })).id };
}

/** A team member as the loan book sees them, loaded by id: for steps taken on their behalf after they've left the page. */
export async function staffActor(userId: string): Promise<IntakeActor | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || user.deletedAt) return null;
  return { id: user.id, name: user.name, roleCodes: user.roles.map((role) => role.role), organizationId: user.organizationId, extraPermissions: user.extraPermissions, deniedPermissions: user.deniedPermissions };
}

const SCREENER: Viewer = { id: "system", name: "LendHous sanctions check", roleCodes: [] };

/** Screens a loan's names and records it. Quietly does nothing if the list isn't downloaded yet: the loan just shows as not screened. */
export async function screenAutomatically(dealId: string) {
  const deal = (await readBook()).book.deals.find((item) => item.id === dealId);
  if (!deal) return null;
  const screening = await screenDeal(deal, SCREENER.name);
  if ("error" in screening) return null;
  const result = await runAction(SCREENER, { t: "recordScreening", dealId, screening }, { trusted: true });
  if ("error" in result) return null;
  await sendAlerts(result.before, result.after, result.action);
  return result.after;
}
