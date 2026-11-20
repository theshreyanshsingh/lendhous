// Where the report schedules live (the settings record), who can be sent one, and the nightly sending
// (lib/scheduled-reports.ts for the reports themselves).
import { prisma } from "@/lib/prisma";
import { can, viewFor } from "@/lib/permissions";
import { getSettings, resetSettingsCache } from "@/lib/settings";
import type { ReportSchedule } from "@/lib/scheduled-reports";
import type { RoleCode } from "@prisma/client";

export async function readSchedules(): Promise<ReportSchedule[]> {
  const value = (await getSettings()).reportSchedules;
  return Array.isArray(value) ? (value as unknown as ReportSchedule[]) : [];
}

export async function writeSchedules(schedules: ReportSchedule[]) {
  const value = JSON.parse(JSON.stringify(schedules));
  await prisma.platformSettings.upsert({ where: { id: "default" }, create: { id: "default", reportSchedules: value }, update: { reportSchedules: value } });
  resetSettingsCache();
}

export type Recipient = { id: string; name: string; email: string; sees: "team" | "partner" | "buyer"; organizationId: string | null };

/**
 * The people a report can go to, as their accounts stand now: the team with the reports permission (the whole book), and
 * partners' and buyers' people (their firm's loans). Anyone else, or an account no longer active, gets nothing.
 */
export async function recipients(ids?: string[]): Promise<Recipient[]> {
  const [users, overrides] = await Promise.all([
    prisma.user.findMany({ where: { accountStatus: "APPROVED", ...(ids ? { id: { in: ids } } : {}) }, include: { roles: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.rolePermission.findMany({ where: { permission: "view_reports" } }),
  ]);
  return users.flatMap((user) => {
    const roles = user.roles.map((role) => role.role as RoleCode);
    const view = viewFor(roles);
    const sees = view === "admin" ? (can(roles, "view_reports", { overrides, member: user }) ? "team" : null) : view === "partner" || view === "buyer" ? view : null;
    return sees ? [{ id: user.id, name: user.name, email: user.email, sees, organizationId: user.organizationId }] : [];
  });
}
