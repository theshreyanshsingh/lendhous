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
    <main id="desk" className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className={demo ? "w-full max-w-[760px]" : "w-full max-w-[380px]"}>
        <Logo />
        <p className="eyebrow mt-6">Sign in</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">Welcome back to Lendhous.</h1>
        <div className="mt-4"><Notice notice={q(params, "notice")} error={q(params, "error")} /></div>
        <div className="mt-5"><LoginPanel next={q(params, "next")} demo={demo} /></div>
        <p className="mt-4 text-sm text-muted-foreground">Borrower sign-up arrives with the application flow (milestone B1).</p>
      </div>
    </main>
  );
}
