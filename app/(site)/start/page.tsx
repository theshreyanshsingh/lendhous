import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { getSettings } from "@/lib/settings";
import { QuoteRequest } from "./quote-request";

export const metadata: Metadata = {
  title: "Get a Loan Quote",
  description: "Send LendHous your deal and see indicative terms in a minute. Fix and flip, bridge, DSCR rental and new construction loans for real estate investors.",
};
// Indicative terms come from the pricing the owner last published, so the page is built per visit.
export const dynamic = "force-dynamic";

export default async function Start() {
  await loadPricing();
  return (
    <>
      <PageHead eyebrow="LOAN QUOTE REQUEST" title="Tell us about the deal." description="A borrower or a broker can send it. You'll see indicative terms as soon as it's in, and a loan officer follows up the same business day." />
      <main className="content quote-layout">
        <QuoteRequest pricing={currentPricing()} signupOpen={(await getSettings()).allowSignup !== false} />
        <aside className="panel" style={{ position: "sticky", top: 24 }}>
          <div className="eyebrow">WHAT HAPPENS NEXT</div>
          <ol className="quote-next">
            <li><b>Indicative terms now.</b> Worked out from today&apos;s pricing and the numbers you send.</li>
            <li><b>A loan officer calls.</b> Usually the same business day, to go over the deal and the exit.</li>
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
