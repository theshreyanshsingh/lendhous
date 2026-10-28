import { LoginPanel } from "@/components/auth-forms";
import { Logo } from "@/components/logo";
import { Notice } from "@/components/notice";
import { DEMO_EMAILS, DEMO_LOGINS, DEV_DEMO_PASSWORD, showDemoDesk } from "@/lib/deploy";
import { q } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const demoAccounts = await prisma.user.count({ where: { email: { in: DEMO_EMAILS } } }).catch(() => 0);
  const demo = showDemoDesk(process.env, demoAccounts) ? { password: DEV_DEMO_PASSWORD, accounts: DEMO_LOGINS } : undefined;
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5 md:px-8"><Logo /><span className="text-sm text-nav">Portal login</span></div>
      </header>
      <main id="desk" className="px-4 py-12 md:px-8 md:py-16">
        <div className={demo ? "mx-auto w-full max-w-[1080px]" : "mx-auto w-full max-w-[400px]"}>
          <p className="eyebrow">Sign in</p>
          <h1 className="mt-3 text-[36px] leading-[1.04] font-semibold text-foreground sm:text-[48px]">Welcome back to LendHous.</h1>
          <div className="mt-5"><Notice notice={q(params, "notice")} error={q(params, "error")} /></div>
          <div className="mt-8"><LoginPanel next={q(params, "next")} demo={demo} /></div>
          <p className="mt-6 text-sm text-muted-foreground">Borrower sign-up arrives with the application flow (milestone B1).</p>
        </div>
      </main>
    </div>
  );
}
