"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireUser } from "@/lib/auth";
import { inviteMember, parseMember, reissueLink, removeMember, sendSelfServiceLink, updateMember, usePasswordLink, type Issued } from "@/lib/members";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

export type MemberFormState = { error?: string; saved?: boolean; issued?: Issued };

const PAGE = "/admin/members";

export async function saveMember(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const actor = await requirePermission("manage_users");
  const id = String(formData.get("id") || "");
  const input = parseMember(formData);
  if (!id) {
    const result = await inviteMember(actor, input);
    if ("error" in result) return { error: result.error };
    revalidatePath(PAGE);
    return { issued: result.issued };
  }
  const result = await updateMember(actor, id, input);
  if ("error" in result) return { error: result.error };
  revalidatePath(PAGE);
  return { saved: true };
}

export async function deleteMember(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const actor = await requirePermission("manage_users");
  const result = await removeMember(actor, String(formData.get("id") || ""));
  if ("error" in result) return { error: result.error };
  revalidatePath(PAGE);
  return { saved: true };
}

export async function sendNewLink(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const actor = await requirePermission("manage_users");
  const result = await reissueLink(actor, String(formData.get("id") || ""));
  if ("error" in result) return { error: result.error };
  return { issued: result.issued };
}

// The reply is the same whether or not the address has an account. So is the time it takes: sending mail would
// otherwise give away which addresses are real.
const FORGOT_REPLY_MS = 1_500;

export async function requestPasswordLink(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const meta = await requestMeta();
  const allowed = (await consumeRateLimit(`forgot-ip:${meta.ipAddress}`, 10, 60 * 60 * 1000)) && (await consumeRateLimit(`forgot:${email}`, 3, 60 * 60 * 1000));
  await Promise.all([allowed ? sendSelfServiceLink(email) : null, new Promise((resolve) => setTimeout(resolve, FORGOT_REPLY_MS))]);
  redirect("/login/forgot?sent=1");
}

export async function emailMyPasswordLink() {
  const user = await requireUser();
  if (!(await consumeRateLimit(`forgot:${user.email}`, 3, 60 * 60 * 1000))) redirect(`/admin/account/security?error=${encodeURIComponent("Too many password links. Wait an hour and try again.")}`);
  await sendSelfServiceLink(user.email);
  redirect("/admin/account/security?notice=password_link_sent");
}

/** Open to anyone holding a link, so it is rate limited by connection. */
export async function setPassword(formData: FormData) {
  const token = String(formData.get("token") || "");
  const back = (message: string) => redirect(`/login/set-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);
  const meta = await requestMeta();
  if (!(await consumeRateLimit(`password-link:${meta.ipAddress}`, 10, 15 * 60 * 1000))) back("Too many attempts. Wait a few minutes and try again.");
  const password = String(formData.get("password") || "");
  if (password !== String(formData.get("confirm") || "")) back("Those two passwords don't match.");
  const result = await usePasswordLink(token, password);
  if ("error" in result) back(result.error);
  redirect("/login?notice=password_set");
}
