// Inviting, changing and removing accounts, and the one-time password link. actions/members.ts checks who is asking.
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { RoleCode } from "@prisma/client";
import { audit } from "@/lib/audit";
import { isDemoEmail } from "@/lib/deploy";
import { sendPasswordLink } from "@/lib/email";
import { accessChanges, accessError, isRole, removeError, type Actor } from "@/lib/member-rules";
import { isStaff, ROLE_LABEL } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const PASSWORD_MIN = 12;
const LINK_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MemberInput = { name: string; email: string; title: string; roles: RoleCode[]; permissions: string[] };

export function parseMember(formData: FormData): MemberInput {
  return {
    name: String(formData.get("name") || "").trim().slice(0, 120),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    title: String(formData.get("title") || "").trim().slice(0, 120),
    roles: formData.getAll("roles").map(String).filter(isRole),
    permissions: formData.getAll("permissions").map(String),
  };
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const roleWords = (roles: readonly RoleCode[]) => roles.map((role) => ROLE_LABEL[role]).join(", ");

/** A new link replaces any earlier one. The token itself is only ever in the email and on the admin's screen. */
async function newLink(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordLink.deleteMany({ where: { userId } });
  await prisma.passwordLink.create({ data: { userId, tokenHash: hashOf(token), expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000) } });
  return `${origin()}/login/set-password?token=${token}`;
}

export type Issued = { name: string; email: string; link: string; mail: "sent" | "logged" | "failed"; invited: boolean };

export async function inviteMember(actor: Actor & { name: string; organizationId: string | null }, input: MemberInput): Promise<{ error: string } | { issued: Issued }> {
  if (!input.name) return { error: "Enter their name." };
  if (!EMAIL.test(input.email)) return { error: "Enter a valid email address." };
  // The release build refuses a database that holds demo addresses, so one here would stop the next deploy.
  if (isDemoEmail(input.email)) return { error: "That address is reserved for demo accounts." };
  const changes = accessChanges(input.roles, input.permissions);
  const refused = accessError(actor, null, { roles: input.roles, ...changes });
  if (refused) return { error: refused };
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing && !existing.deletedAt) return { error: "That email already belongs to a member." };
  // Nobody knows this password. The member replaces it through their link.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const details = { name: input.name, title: input.title || null, accountStatus: "APPROVED" as const, organizationId: isStaff(input.roles) ? actor.organizationId : null, passwordHash, ...changes };
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { ...details, deletedAt: null, lastLoginAt: null, roles: { deleteMany: {}, create: input.roles.map((role) => ({ role, createdById: actor.id })) } } })
    : await prisma.user.create({ data: { ...details, email: input.email, roles: { create: input.roles.map((role) => ({ role, createdById: actor.id })) } } });
  await audit({ actorId: actor.id, action: "member.invited", entityType: "User", entityId: user.id, after: { email: user.email, roles: input.roles, ...changes } });
  const link = await newLink(user.id);
  const mail = await sendPasswordLink(user.email, link, { invitedBy: actor.name, roles: roleWords(input.roles) });
  return { issued: { name: user.name, email: user.email, link, mail, invited: true } };
}

export async function updateMember(actor: Actor & { organizationId: string | null }, id: string, input: MemberInput): Promise<{ error: string } | { ok: true }> {
  const target = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!target || target.deletedAt) return { error: "That member no longer exists." };
  const before = { roles: target.roles.map((row) => row.role), title: target.title, extraPermissions: target.extraPermissions, deniedPermissions: target.deniedPermissions };
  const changes = accessChanges(input.roles, input.permissions);
  const refused = accessError(actor, { id, roles: before.roles, extraPermissions: target.extraPermissions, deniedPermissions: target.deniedPermissions }, { roles: input.roles, ...changes });
  if (refused) return { error: refused };
  // Someone who joins the team joins the lender's organization. Anyone else keeps the one they have.
  const organizationId = isStaff(input.roles) ? target.organizationId ?? actor.organizationId : target.organizationId;
  await prisma.user.update({ where: { id }, data: { title: input.title || null, organizationId, ...changes, roles: { deleteMany: {}, create: input.roles.map((role) => ({ role, createdById: actor.id })) } } });
  await audit({ actorId: actor.id, action: "member.updated", entityType: "User", entityId: id, before, after: { roles: input.roles, title: input.title || null, ...changes } });
  return { ok: true };
}

export async function removeMember(actor: Actor, id: string): Promise<{ error: string } | { ok: true }> {
  const target = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!target || target.deletedAt) return { ok: true };
  const roles = target.roles.map((row) => row.role);
  const refused = removeError(actor, { id, roles });
  if (refused) return { error: refused };
  await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  await Promise.all([
    prisma.serverSession.deleteMany({ where: { userId: id } }),
    prisma.loginCode.deleteMany({ where: { userId: id } }),
    prisma.passwordLink.deleteMany({ where: { userId: id } }),
  ]);
  await audit({ actorId: actor.id, action: "member.removed", entityType: "User", entityId: id, before: { email: target.email, roles } });
  return { ok: true };
}

export async function reissueLink(actor: Actor, id: string): Promise<{ error: string } | { issued: Issued }> {
  const target = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!target || target.deletedAt) return { error: "That member no longer exists." };
  const access = { roles: target.roles.map((row) => row.role), extraPermissions: target.extraPermissions, deniedPermissions: target.deniedPermissions };
  // Whoever holds this link can sign in as the member, so it needs the same standing as giving them that access.
  if (accessError(actor, { id, ...access }, access)) return { error: "You can't reset the password of someone with more access than you." };
  const link = await newLink(id);
  const mail = await sendPasswordLink(target.email, link, "admin");
  await audit({ actorId: actor.id, action: "member.password_link_sent", entityType: "User", entityId: id });
  return { issued: { name: target.name, email: target.email, link, mail, invited: false } };
}

/** "Forgot password", or a signed-in person changing theirs. Quietly does nothing for an address with no active account. */
export async function sendSelfServiceLink(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.accountStatus !== "APPROVED") return;
  await sendPasswordLink(user.email, await newLink(user.id), "self");
  await audit({ actorId: null, action: "auth.password_link_requested", entityType: "User", entityId: user.id });
}

/** Who a link belongs to, for the set-password page. Null when it is unknown or expired. */
export async function peekPasswordLink(token: string) {
  const row = await prisma.passwordLink.findUnique({ where: { tokenHash: hashOf(token) }, include: { user: { select: { email: true, deletedAt: true } } } });
  if (!row || row.expiresAt < new Date() || row.user.deletedAt) return null;
  return { email: row.user.email };
}

/** Uses the link. deleteMany is atomic, so the same link can't set a password twice. Other sessions end, as after any reset. */
export async function usePasswordLink(token: string, password: string): Promise<{ error: string } | { userId: string }> {
  if (password.length < PASSWORD_MIN) return { error: `Use at least ${PASSWORD_MIN} characters.` };
  const tokenHash = hashOf(token);
  const row = await prisma.passwordLink.findUnique({ where: { tokenHash }, include: { user: { select: { deletedAt: true } } } });
  if (!row || row.expiresAt < new Date() || row.user.deletedAt) return { error: "This link has expired or was already used. Ask your administrator for a new one." };
  const { count } = await prisma.passwordLink.deleteMany({ where: { tokenHash } });
  if (!count) return { error: "This link has expired or was already used. Ask your administrator for a new one." };
  await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  await prisma.serverSession.deleteMany({ where: { userId: row.userId } });
  await audit({ actorId: row.userId, action: "auth.password_set", entityType: "User", entityId: row.userId });
  return { userId: row.userId };
}
