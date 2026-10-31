import type { Metadata } from "next";
import Link from "next/link";
import { setPassword } from "@/actions/members";
import { Logo } from "@/components/logo";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { q } from "@/lib/format";
import { PASSWORD_MIN, peekPasswordLink } from "@/lib/members";

// The address carries a live token, so it must not leak to anything this page links to.
export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = q(params, "token") ?? "";
  const link = token ? await peekPasswordLink(token) : null;
  return (
    <main id="desk" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Logo />
      <p className="eyebrow mt-12">Your account</p>
      {link ? (
        <>
          <h1 className="mt-3 text-[28px] font-normal tracking-tight text-foreground">Set your password.</h1>
          <p className="mt-4 text-sm text-muted-foreground">For <span className="text-foreground" data-testid="password-email">{link.email}</span>. Use at least {PASSWORD_MIN} characters.</p>
          <div className="mt-6"><Notice error={q(params, "error")} /></div>
          <form action={setPassword} className="mt-4 space-y-4">
            <input type="hidden" name="token" value={token} />
            <input type="text" name="username" value={link.email} autoComplete="username" readOnly hidden />
            <label className="block">
              <span className="text-[13px] text-muted-foreground">New password</span>
              <input data-testid="new-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} className="desk-input mt-2" required />
            </label>
            <label className="block">
              <span className="text-[13px] text-muted-foreground">Type it again</span>
              <input data-testid="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} className="desk-input mt-2" required />
            </label>
            <SubmitButton className="h-11 w-full text-[13px] font-medium">Save password</SubmitButton>
          </form>
        </>
      ) : (
        <>
          <h1 className="mt-3 text-[28px] font-normal tracking-tight text-foreground">This link no longer works.</h1>
          <p className="mt-4 text-sm text-muted-foreground" data-testid="password-link-dead">It has expired or was already used. Ask your LendHous administrator for a new one.</p>
          <Link href="/login" className="mt-6 text-sm text-muted-foreground underline underline-offset-2">Back to sign in</Link>
        </>
      )}
    </main>
  );
}
