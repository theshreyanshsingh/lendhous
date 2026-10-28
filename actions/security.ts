"use server";

// Two-factor sign-in, ported from UPB Capital's actions/security.ts. Differences: the authenticator secret and the
// one-time recovery-code reveal are stored encrypted, and turning two-factor on or off is audited.
import { createHash, randomInt } from "crypto";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { clearPending, pendingUserId, requireUser, setSession } from "@/lib/auth";
import { encryptField } from "@/lib/crypto";
import { notify } from "@/lib/email";
import { homeFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { newRecoveryCodes, packHashes, takeRecoveryCode } from "@/lib/recovery";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";
import { revealContext, secretContext, totpSecretOf } from "@/lib/two-factor";

const fail = (path: string, message: string) => redirect(`${path}?error=${encodeURIComponent(message)}`);

export async function beginTotp() {
  const user = await requireUser({ allowWithoutMfa: true });
  if (user.totpEnabled) redirect("/account/security");
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: encryptField(secret, secretContext(user.id)), totpEnabled: false } });
  redirect("/account/security?notice=totp");
}

export async function confirmTotp(formData: FormData) {
  const user = await requireUser({ allowWithoutMfa: true });
  const code = String(formData.get("code") || "");
  if (!user.totpSecretEnc || !verifyTotp(totpSecretOf(user), code)) fail("/account/security", "That code does not match the secret on this account.");
  const codes = newRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: true, recoveryHashes: packHashes(codes), recoveryRevealEnc: encryptField(codes.join("\n"), revealContext(user.id)) },
  });
  await audit({ actorId: user.id, action: "security.totp_on", entityType: "User", entityId: user.id });
  redirect("/account/security?notice=codes");
}

export async function acknowledgeRecovery() {
  const user = await requireUser({ allowWithoutMfa: true });
  await prisma.user.update({ where: { id: user.id }, data: { recoveryRevealEnc: "" } });
  redirect("/account/security?notice=totp_on");
}

export async function disableTotp(formData: FormData) {
  const user = await requireUser({ allowWithoutMfa: true });
  if (!(await consumeRateLimit(`totp:${user.id}`, 5, 15 * 60 * 1000))) fail("/account/security", "Too many codes. Wait fifteen minutes and try again.");
  const code = String(formData.get("code") || "");
  const recovery = takeRecoveryCode(user.recoveryHashes, code);
  const ok = (user.totpSecretEnc && verifyTotp(totpSecretOf(user), code)) || recovery != null;
  if (!user.totpEnabled || !ok) fail("/account/security", "Enter a current code or a recovery code to turn this off.");
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecretEnc: "", recoveryHashes: "", recoveryRevealEnc: "", emailOtpFallback: false },
  });
  await audit({ actorId: user.id, action: "security.totp_off", entityType: "User", entityId: user.id });
  redirect("/account/security?notice=totp_off");
}

export async function setEmailFallback(formData: FormData) {
  const user = await requireUser({ allowWithoutMfa: true });
  if (!user.totpEnabled) redirect("/account/security");
  await prisma.user.update({ where: { id: user.id }, data: { emailOtpFallback: formData.get("enabled") === "yes" } });
  redirect("/account/security?notice=email_otp");
}

async function acceptSecondFactor(user: { id: string; totpSecretEnc: string; recoveryHashes: string }, code: string) {
  if (user.totpSecretEnc && verifyTotp(totpSecretOf(user), code)) return true;
  const remaining = takeRecoveryCode(user.recoveryHashes, code);
  if (remaining != null) {
    await prisma.user.update({ where: { id: user.id }, data: { recoveryHashes: remaining } });
    return true;
  }
  const hash = createHash("sha256").update(code.replace(/\s/g, "")).digest("hex");
  const row = await prisma.loginCode.findFirst({
    where: { userId: user.id, codeHash: hash, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return false;
  await prisma.loginCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}

export async function verifyLoginTotp(formData: FormData) {
  const userId = await pendingUserId();
  if (!userId) fail("/login", "Sign in again, then enter the code.");
  const user = await prisma.user.findUnique({ where: { id: userId! }, include: { roles: true } });
  if (!user || !user.totpEnabled) redirect("/login");
  if (!(await consumeRateLimit(`totp:${user.id}`, 5, 15 * 60 * 1000))) fail("/login/verify", "Too many codes. Wait fifteen minutes and try again.");
  const code = String(formData.get("code") || "");
  if (!(await acceptSecondFactor(user, code))) {
    await audit({ actorId: null, action: "auth.second_factor_failed", entityType: "User", entityId: user.id });
    fail("/login/verify", "That code is not current.");
  }
  await clearPending();
  await setSession(user);
  await audit({ actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, after: { secondFactor: true } });
  redirect(homeFor(user.roles.map((role) => role.role)));
}

export async function sendEmailCode() {
  const userId = await pendingUserId();
  if (!userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpEnabled || !user.emailOtpFallback) fail("/login/verify", "Email codes are off for this account.");
  if (!(await consumeRateLimit(`email-otp:${user!.id}`, 3, 10 * 60 * 1000))) fail("/login/verify", "Wait a few minutes before another email code.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = createHash("sha256").update(code).digest("hex");
  await prisma.loginCode.create({ data: { userId: user!.id, codeHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  await notify(user!.email, "Your Lendhous sign-in code", `Your code is ${code}. It expires in ten minutes.`, { legal: true, eventCode: "security.login_code" });
  redirect("/login/verify?notice=email_sent");
}
