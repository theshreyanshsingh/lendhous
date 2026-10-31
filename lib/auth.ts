// Sessions on top of lib/session.ts, ported from UPB Capital's lib/auth.ts, plus what Spec v3 10.1 adds for Lendhous:
// several roles per user, a 30-minute idle timeout for staff, and required two-factor for staff, partners and brokers.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { RoleCode } from "@prisma/client";
import { secureCookies } from "@/lib/deploy";
import { can, homeFor, isStaff, needsMfa, viewFor, type Permission, type View } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requestMeta } from "@/lib/request-meta";
import { PENDING_COOKIE, SESSION_COOKIE, SESSION_DAYS, signPending, signSession, verifyPending, verifySession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export async function setSession(user: { id: string; email: string; name: string; roles: { role: RoleCode }[] }) {
  const sid = crypto.randomUUID();
  const meta = await requestMeta();
  await prisma.serverSession.create({
    data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000), ipAddress: meta.ipAddress, userAgent: meta.userAgent },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = await signSession({ sub: user.id, email: user.email, name: user.name, roles: user.roles.map((role) => role.role), sid });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_DAYS * 86_400 });
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await verifySession(token);
    if (session?.sid) await prisma.serverSession.deleteMany({ where: { id: session.sid } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function setPending(sub: string) {
  const token = await signPending(sub);
  const jar = await cookies();
  jar.set(PENDING_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 60 * 10 });
}

export async function clearPending() {
  const jar = await cookies();
  jar.delete(PENDING_COOKIE);
}

export async function pendingUserId() {
  const jar = await cookies();
  const token = jar.get(PENDING_COOKIE)?.value;
  if (!token) return null;
  return verifyPending(token);
}

/** Pure idle check so it can be tested: staff sessions end after the idle window; others only at expiry. */
export function sessionExpired(session: { expiresAt: Date; lastSeenAt: Date }, staff: boolean, idleMinutes: number, now = Date.now()) {
  if (session.expiresAt.getTime() < now) return true;
  return staff && now - session.lastSeenAt.getTime() > idleMinutes * 60_000;
}

/** The signed-in user with their role codes, or null. One lookup per request. */
export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session?.sid) return null;
  try {
    const row = await prisma.serverSession.findUnique({ where: { id: session.sid }, include: { user: { include: { roles: true } } } });
    if (!row || row.userId !== session.sub || row.user.deletedAt) return null;
    const roles = row.user.roles.map((role) => role.role);
    const settings = await getSettings();
    if (sessionExpired(row, isStaff(roles), settings.staffIdleMinutes)) {
      await prisma.serverSession.deleteMany({ where: { id: row.id } });
      return null;
    }
    // Throttled so a page with many requests doesn't write on every one.
    if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await prisma.serverSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
    }
    return { ...row.user, roleCodes: roles };
  } catch (error) {
    console.error("[lendhous-auth] session lookup failed:", error);
    return null;
  }
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser(options: { allowWithoutMfa?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.accountStatus !== "APPROVED") redirect("/login?error=" + encodeURIComponent("This account is not active yet."));
  if (!options.allowWithoutMfa && needsMfa(user.roleCodes) && !user.totpEnabled && (await getSettings()).requireStaffMfa) {
    redirect("/admin/account/security?notice=mfa_required");
  }
  return user;
}

/** The signed-in user, sent to their own workspace when this one belongs to another role. */
export async function requireView(view: View) {
  const user = await requireUser();
  if (viewFor(user.roleCodes) !== view) redirect(homeFor(user.roleCodes));
  return user;
}

export async function requirePermission(permission: Permission, options: { amountCents?: number } = {}) {
  const user = await requireUser();
  const overrides = await prisma.rolePermission.findMany({ where: { role: { in: user.roleCodes }, permission } });
  if (!can(user.roleCodes, permission, { amountCents: options.amountCents, overrides })) redirect("/?denied=" + permission);
  return user;
}
