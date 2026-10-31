import Link from "next/link";
import { redirect } from "next/navigation";
import { resendLoginCode, verifyLoginCode } from "@/actions/security";
import { Logo } from "@/components/logo";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { pendingUserId } from "@/lib/auth";
import { q } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Verify" };

export default async function VerifyLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pending = await pendingUserId();
  if (!pending) redirect("/login");
  const account = await prisma.user.findUnique({ where: { id: pending }, select: { email: true } });
  if (!account) redirect("/login");
  const params = await searchParams;
  return (
    <main id="desk" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Logo />
      <p className="eyebrow mt-12">Second factor</p>
      <h1 className="mt-3 text-[28px] font-normal tracking-tight text-foreground">Enter the code.</h1>
      <p className="mt-4 text-sm text-muted-foreground">Sign-in codes go to <span className="text-foreground" data-testid="code-email">{account.email}</span> and expire after ten minutes. Check your spam folder if one doesn't arrive.</p>
      <div className="mt-8"><Notice notice={q(params, "notice")} error={q(params, "error")} /></div>
      <form action={verifyLoginCode} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-[13px] text-muted-foreground">Code</span>
          <input data-testid="login-code" name="code" inputMode="numeric" autoComplete="one-time-code" aria-label="Sign-in code" className="desk-input mt-2" autoFocus required />
        </label>
        <SubmitButton className="h-11 w-full text-[13px] font-medium">Continue</SubmitButton>
      </form>
      <form action={resendLoginCode} className="mt-4">
        <SubmitButton variant="outline" className="h-11 w-full text-[13px] font-medium">Send a new code</SubmitButton>
      </form>
      <Link href="/login" className="mt-4 text-sm text-muted-foreground underline underline-offset-2">Back to sign in</Link>
    </main>
  );
}
