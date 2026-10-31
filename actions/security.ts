"use server";

// The second factor: a six-digit code emailed at sign-in (lib/login-code.ts). Staff, partners and brokers always get one;
// anyone else can turn it on from the security page.
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { clearPending, pendingUserId, requireUser, setSession } from "@/lib/auth";
import { issueLoginCode, LOGIN_CODE_PAGE, takeLoginCode } from "@/lib/login-code";
import { homeFor, loginCodeRequired } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const tooManyCodes = (userId: string) => consumeRateLimit(`login-code:${userId}`, 5, 15 * 60 * 1000).then((allowed) => !allowed);

export async function setEmailCodes(formData: FormData) {
  const user = await requireUser();
  if (loginCodeRequired(user.roleCodes, await getSettings())) redirect("/admin/account/security");
  const enabled = formData.get("enabled") === "yes";
  // Turning codes off takes the password, so an unattended session can't remove them.
  if (!enabled) {
    if (await tooManyCodes(user.id)) fail("/admin/account/security", "Too many attempts. Wait fifteen minutes and try again.");
    if (!(await bcrypt.compare(String(formData.get("password") || ""), user.passwordHash))) fail("/admin/account/security", "That password doesn't match this account.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { emailCodeEnabled: enabled } });
  await audit({ actorId: user.id, action: enabled ? "security.login_code_on" : "security.login_code_off", entityType: "User", entityId: user.id });
  redirect(`/admin/account/security?notice=${enabled ? "codes_on" : "codes_off"}`);
}

async function pendingUser() {
  const userId = await pendingUserId();
  if (!userId) fail("/login", "Sign in again, then enter the code.");
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || user.deletedAt || user.accountStatus !== "APPROVED") redirect("/login");
  return user;
}

export async function verifyLoginCode(formData: FormData) {
  const user = await pendingUser();
  if (await tooManyCodes(user.id)) fail("/login/verify", "Too many codes. Wait fifteen minutes and try again.");
  if (!(await takeLoginCode(user.id, String(formData.get("code") || "")))) {
    await audit({ actorId: null, action: "auth.second_factor_failed", entityType: "User", entityId: user.id });
    fail("/login/verify", "That code is wrong or has expired.");
  }
  await clearPending();
  await setSession(user, { secondFactor: true });
  await audit({ actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, after: { secondFactor: true } });
  redirect(homeFor(user.roles.map((role) => role.role)));
}

export async function resendLoginCode() {
  const user = await pendingUser();
  redirect(LOGIN_CODE_PAGE[await issueLoginCode(user)]);
}
