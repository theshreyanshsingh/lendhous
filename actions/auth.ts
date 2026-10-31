"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { clearSession, getCurrentUser, setSession } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

// Browsers read a backslash as a slash and drop tabs and newlines, so any of these can turn a path into another site.
function safeNext(value: string, fallback: string) {
  if (value.startsWith("/") && !value.startsWith("//") && !/[\\\s]/.test(value)) return value;
  return fallback;
}

export async function login(_prev: { error: string }, formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const meta = await requestMeta();
  if (!(await consumeRateLimit(`login:${meta.ipAddress}:${email}`, 8, 10 * 60 * 1000))) {
    return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
  }
  const user = await prisma.user.findUnique({ where: { email }, include: { roles: true } });
  if (!user || user.deletedAt || !(await bcrypt.compare(password, user.passwordHash))) {
    await audit({ actorId: null, action: "auth.login_failed", entityType: "User", entityId: user?.id ?? email });
    return { error: "That email and password don't match an account." };
  }
  if (user.accountStatus === "PENDING") return { error: "This account is waiting for approval." };
  if (user.accountStatus !== "APPROVED") return { error: "This account is not active. Contact the Lendhous team." };
  await setSession(user);
  await audit({ actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
  redirect(safeNext(String(formData.get("next") || ""), homeFor(user.roles.map((role) => role.role))));
}

export async function logout() {
  const user = await getCurrentUser();
  await clearSession();
  if (user) await audit({ actorId: user.id, action: "auth.logout", entityType: "User", entityId: user.id });
  redirect("/login?notice=signed_out");
}
