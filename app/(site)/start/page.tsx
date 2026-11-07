import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";
import { referralByCode } from "@/lib/broker-store";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { getSettings } from "@/lib/settings";
import { QuoteRequest } from "./quote-request";

export const metadata: Metadata = {
  title: "Get a Loan Quote",
  description: "See indicative terms on your deal in a minute, before you give any contact details. Fix and flip, bridge, DSCR rental and new construction loans for real estate investors.",
};
// Indicative terms come from the pricing the owner last published, so the page is built per visit.
export const dynamic = "force-dynamic";

export default async function Start({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  await loadPricing();
  // A referral link: the request, and the loan it becomes, are attributed to the brokerage or the borrower who sent it.
  const referral = await referralByCode((await searchParams).ref).catch(() => null);
  return (
    <>
      <PageHead eyebrow="LOAN QUOTE" title="Tell us about the deal." description="See indicative terms from today's pricing as soon as the numbers are in, with no name or email needed. Save them, and a loan officer follows up the same business day." />
      <main className="content quote-layout">
        <QuoteRequest pricing={currentPricing()} signupOpen={(await getSettings()).allowSignup !== false} referral={referral ? { code: (await searchParams).ref!, name: referral.name, kind: referral.kind } : undefined} />
        <aside className="panel" style={{ position: "sticky", top: 24 }}>
          <div className="eyebrow">WHAT HAPPENS NEXT</div>
          <ol className="quote-next">
            <li><b>Indicative terms now.</b> Worked out from today&apos;s pricing and your numbers, before you give any contact details.</li>
            <li><b>Save them.</b> A loan officer calls, usually the same business day, to go over the deal and the exit.</li>
            <li><b>A secure application link.</b> Five short steps you can finish over a few sittings; it saves as you go.</li>
            <li><b>Term sheet.</b> Once underwriting has the documents.</li>
          </ol>
          <p className="quote-small">Business-purpose loans to investors and their LLCs only. No credit is pulled for a quote.</p>
          <Link href="/programs" className="text-link">Compare loan programs</Link>
        </aside>
      </main>
    </>
  );
}
