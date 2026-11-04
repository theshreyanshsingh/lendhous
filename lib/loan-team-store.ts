// The people a loan can be given to, looked up on the server so the browser never supplies a name or an email.
import { hasPermission } from "@/lib/auth";
import type { TeamMember } from "@/lib/mockData";
import { STAFF_ROLES } from "@/lib/permissions";
import { notDeleted, prisma } from "@/lib/prisma";

export const memberOf = (user: { id: string; name: string; email: string; phone?: string | null; title?: string | null }): TeamMember => ({ id: user.id, name: user.name, email: user.email, phone: user.phone ?? "", title: user.title ?? "" });

/** Active staff who can see the pipeline, by name. */
export async function teamCandidates(): Promise<TeamMember[]> {
  const users = await prisma.user.findMany({ where: { accountStatus: "APPROVED", ...notDeleted, roles: { some: { role: { in: [...STAFF_ROLES] } } } }, include: { roles: true }, orderBy: { name: "asc" } });
  const members: TeamMember[] = [];
  for (const user of users) if (await hasPermission({ ...user, roleCodes: user.roles.map((row) => row.role) }, "view_pipeline")) members.push(memberOf(user));
  return members;
}

/** A staff member's snapshot by id, for a loan they start or a link they send. */
export async function memberById(id: string) {
  const user = await prisma.user.findFirst({ where: { id, ...notDeleted } });
  return user ? memberOf(user) : null;
}
