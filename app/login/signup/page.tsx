import Link from "next/link";
import { Logo } from "@/components/logo";
import { SignupForm } from "@/components/signup-form";
import { q } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

// Anyone can create a borrower account here, to apply for a loan and send its documents and property photos themselves.
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sent = q(await searchParams, "sent") === "1";
  const open = (await getSettings()).allowSignup !== false;
  return (
    <main id="desk" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Logo />
      <p className="eyebrow mt-12">Borrowers and contractors</p>
      <h1 className="mt-3 text-[28px] font-normal tracking-tight text-foreground">Create your LendHous account</h1>
      {sent ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground" data-testid="signup-sent">Check your email. We sent a link to confirm the address and choose a password. It works once and expires in seven days. If you already have an account, the email has a link to set a new password instead. Check your spam folder if it doesn&apos;t arrive.</p>
      ) : open ? (
        <>
          <p className="mt-4 text-sm text-muted-foreground">Apply for a loan, upload photos of the property, send documents and follow the loan from your phone or computer.</p>
          <SignupForm />
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="signup-closed">LendHous isn&apos;t taking new sign-ups right now. Ask your loan officer for an invitation, or <Link href="/start" className="underline underline-offset-2">request a quote</Link> and we&apos;ll be in touch.</p>
      )}
      <Link href="/login" className="mt-4 text-sm text-muted-foreground underline underline-offset-2 max-sm:inline-block max-sm:py-2.5">Already have an account? Sign in</Link>
    </main>
  );
}
