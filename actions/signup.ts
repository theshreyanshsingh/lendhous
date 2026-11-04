"use server";

import { redirect } from "next/navigation";
import { signupProblem, startSignup } from "@/lib/members";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { getSettings } from "@/lib/settings";

export type SignupState = { error: string };

// Like "forgot password": the reply is the same, and takes as long, whether or not the address already has an account.
const SIGNUP_REPLY_MS = 1_500;

/** The public sign-up page. Open to anyone, so it's rate limited and has a honeypot like the quote form. */
export async function requestSignup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  if ((await getSettings()).allowSignup === false) return { error: "LendHous isn't taking new sign-ups right now. Ask your loan officer for an invitation." };
  if (String(formData.get("website") || "")) redirect("/login/signup?sent=1");
  const input = {
    name: String(formData.get("name") || "").replace(/\s+/g, " ").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    phone: String(formData.get("phone") || "").trim(),
  };
  const problem = signupProblem(input);
  if (problem) return { error: problem };
  const meta = await requestMeta();
  if (!(await consumeRateLimit(`signup-ip:${meta.ipAddress}`, 10, 60 * 60 * 1000))) return { error: "Too many sign-ups from this connection. Wait an hour and try again." };
  const allowed = await consumeRateLimit(`signup:${input.email}`, 3, 60 * 60 * 1000);
  await Promise.all([allowed ? startSignup(input) : null, new Promise((resolve) => setTimeout(resolve, SIGNUP_REPLY_MS))]);
  redirect("/login/signup?sent=1");
}
