"use client";

import { useActionState, useEffect, useState } from "react";
import { requestSignup } from "@/actions/signup";
import { SubmitButton } from "@/components/submit-button";

/** Where the quote request leaves the visitor's name and email, so the sign-up form starts filled in without them going in a URL. */
export const SIGNUP_PREFILL = "lendhous-signup";

export function SignupForm() {
  const [state, action] = useActionState(requestSignup, { error: "" });
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SIGNUP_PREFILL) || "null") as Partial<typeof form> | null;
      if (saved) setForm((current) => ({ name: current.name || String(saved.name ?? ""), email: current.email || String(saved.email ?? ""), phone: current.phone || String(saved.phone ?? "") }));
    } catch {}
  }, []);
  const field = (key: keyof typeof form) => ({ name: key, value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }) });
  return (
    <form action={action} className="glass mt-6 space-y-4 p-7 shadow-[var(--shadow)]" data-testid="signup-form">
      <label className="block"><span className="text-[13px] text-muted-foreground">Your full name</span><input data-testid="signup-name" {...field("name")} autoComplete="name" maxLength={120} className="desk-input mt-1.5" required /></label>
      <label className="block"><span className="text-[13px] text-muted-foreground">Email</span><input data-testid="signup-email" {...field("email")} type="email" autoComplete="email" maxLength={200} className="desk-input mt-1.5" required /></label>
      <label className="block"><span className="text-[13px] text-muted-foreground">Mobile phone (optional)</span><input data-testid="signup-phone" {...field("phone")} type="tel" autoComplete="tel" maxLength={40} className="desk-input mt-1.5" /></label>
      {/* Left empty by people. Bots that fill in every field give themselves away. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" style={{ display: "none" }} />
      {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      <SubmitButton className="h-11 w-full text-[13.5px] font-medium" pendingLabel="Sending…">Create my account</SubmitButton>
      <p className="text-xs text-muted-foreground">We&apos;ll email you a link to confirm the address and choose a password. The account works once you&apos;ve used it.</p>
    </form>
  );
}
