"use client";

// Ported from UPB Capital's components/auth-forms.tsx (sign-in panel and the demo-seat list).
import { useActionState, useState } from "react";
import { login } from "@/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export type DemoDesk = { password: string; accounts: { role: string; email: string }[] };

export function LoginPanel({ next, demo }: { next?: string; demo?: DemoDesk }) {
  const [state, action] = useActionState(login, { error: "" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className={demo ? "grid gap-6 md:grid-cols-[380px_minmax(0,1fr)]" : ""}>
      <form action={action} className="glass space-y-4 self-start p-7 shadow-[var(--shadow)]">
        <input type="hidden" name="next" value={next ?? ""} />
        <label className="block">
          <span className="text-[13px] text-muted-foreground">Email</span>
          <input data-testid="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="desk-input mt-1.5" required />
        </label>
        <label className="block">
          <span className="text-[13px] text-muted-foreground">Password</span>
          <input data-testid="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="desk-input mt-1.5" required />
        </label>
        {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
        <SubmitButton className="h-10 w-full text-[13px] font-semibold" pendingLabel="Checking…">Sign in</SubmitButton>
      </form>
      {demo && (
        <aside className="space-y-2">
          <p className="eyebrow">Demo seats</p>
          <p className="text-sm text-muted-foreground">Every sample account uses the password {demo.password}. All of them are FAKE.</p>
          {demo.accounts.map((account) => (
            <button key={account.email} type="button" onClick={() => { setEmail(account.email); setPassword(demo.password); }} className="block w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-left transition hover:bg-hover">
              <span className="block text-xs font-medium text-link">{account.role}</span>
              <span className="mt-1 block text-sm text-foreground">{account.email}</span>
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}
