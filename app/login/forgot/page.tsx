import Link from "next/link";
import { requestPasswordLink } from "@/actions/members";
import { Logo } from "@/components/logo";
import { SubmitButton } from "@/components/submit-button";
import { q } from "@/lib/format";

export const metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sent = q(await searchParams, "sent") === "1";
  return (
    <main id="desk" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Logo />
      <p className="eyebrow mt-12">Your account</p>
      <h1 className="mt-3 text-[28px] font-normal tracking-tight text-foreground">Forgot your password?</h1>
      {sent ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground" data-testid="forgot-sent">If that address has an account, a link to set a new password is on its way. It works once and expires in seven days. Check your spam folder if it doesn&apos;t arrive.</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">Enter your email and we&apos;ll send you a link to set a new one.</p>
          <form action={requestPasswordLink} className="mt-6 space-y-4">
            <label className="block"><span className="text-[13px] text-muted-foreground">Email</span><input data-testid="forgot-email" name="email" type="email" autoComplete="username" className="desk-input mt-2" required /></label>
            <SubmitButton className="h-11 w-full text-[13px] font-medium" pendingLabel="Sending…">Send the link</SubmitButton>
          </form>
        </>
      )}
      <Link href="/login" className="mt-4 text-sm text-muted-foreground underline underline-offset-2">Back to sign in</Link>
    </main>
  );
}
