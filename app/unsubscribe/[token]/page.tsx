import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { unsubscribe, unsubscribeState } from "@/lib/unsubscribe-store";

export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Stops LendHous's marketing emails for the account the link was sent to (lib/campaigns.ts). Loan notices keep coming. */
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const state = await unsubscribeState(token);
  async function stop() {
    "use server";
    await unsubscribe(token);
    redirect(`/unsubscribe/${encodeURIComponent(token)}?done=1`);
  }
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule"><div className="mx-auto max-w-xl px-4 py-5"><Logo /></div></header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-12" data-testid="unsubscribe">
        <p className="eyebrow">LendHous emails</p>
        {!state ? <h1 className="text-3xl font-normal" data-testid="unsubscribe-bad">That link isn&apos;t valid.</h1>
          : state.stopped || done ? <><h1 className="text-3xl font-normal" data-testid="unsubscribe-done">You won&apos;t get LendHous&apos;s marketing emails any more.</h1><p className="text-sm text-muted-foreground">Notices about a loan you have with LendHous still come, since they&apos;re about your loan.</p></>
          : (
            <form action={stop} className="space-y-4">
              <h1 className="text-3xl font-normal">Stop LendHous&apos;s marketing emails?</h1>
              <p className="text-sm text-muted-foreground">Rate updates and news stop. Notices about a loan you have with LendHous still come.</p>
              <button type="submit" className="btn-primary" data-testid="unsubscribe-confirm">Unsubscribe</button>
            </form>
          )}
      </main>
    </div>
  );
}
