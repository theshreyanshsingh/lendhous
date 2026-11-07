import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { repeatTiersOf } from "@/lib/engine";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { MISC_THRESHOLD, PAY_WITHIN_BUSINESS_DAYS } from "@/lib/referrals";
import { REPEAT_WINDOW_MONTHS } from "@/lib/repeat-borrower";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Borrower Rewards",
  description: "Repeat-borrower pricing, documents that carry over and a referral bonus for LendHous borrowers.",
};
// The tiers come from the pricing the owner last published and the bonus from Settings, so the page can't drift from either.
export const dynamic = "force-dynamic";

const usd = (amount: number) => `$${amount.toLocaleString("en-US")}`;

export default async function Rewards() {
  await loadPricing();
  const tiers = [...repeatTiersOf(currentPricing())].sort((a, b) => a.loans - b.loans);
  const bonus = (await getSettings()).referralBonusCents / 100;
  return (
    <>
      <PageHead eyebrow="BORROWER REWARDS" title="Every loan makes the next one easier." description="Pay as agreed and your next loan costs less, starts with your papers already in, and goes to the front of the line." />
      <main className="content">
        <section className="compare" data-testid="rewards-tiers">
          <div className="eyebrow">REPEAT-BORROWER PRICING</div>
          <h2>Less off the top with every loan you pay as agreed.</h2>
          <div className="compare-grid">
            {tiers.map((tier) => (
              <div key={tier.loans} className="compare-card" data-testid="rewards-tier">
                <h3>{tier.loans}+ loan{tier.loans === 1 ? "" : "s"}</h3>
                <p className="compare-best">paid as agreed in the last {REPEAT_WINDOW_MONTHS} months</p>
                <dl>
                  <div><dt>Off the rate</dt><dd className="compare-rate">{tier.rateCut.toFixed(2)}%</dd></div>
                  <div><dt>Off the origination fee</dt><dd>{tier.pointsCut ? `${tier.pointsCut} point${tier.pointsCut === 1 ? "" : "s"}` : "None"}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          <p className="compare-note">Loans count once they fund and while they&apos;re paid on time; a paid-off loan keeps counting. A late payment or a default in the last {REPEAT_WINDOW_MONTHS} months pauses the cut until it&apos;s {REPEAT_WINDOW_MONTHS} months behind you. From today&apos;s pricing, which LendHous can change; each loan&apos;s term sheet sets its terms. Not an offer to lend.</p>
        </section>

        {bonus > 0 && (
          <section className="compare" data-testid="rewards-referral">
            <div className="eyebrow">REFER AN INVESTOR</div>
            <h2>{usd(bonus)} for each investor you send us.</h2>
            <ul className="rewards-list">
              <li><b>When it pays.</b> Once the investor you referred has their first LendHous loan fund. We aim to send it within {PAY_WITHIN_BUSINESS_DAYS} business days.</li>
              <li><b>Where your link is.</b> Borrowers with a funded LendHous loan find it on their home page when they sign in. Share it any way you like; there&apos;s no limit.</li>
              <li><b>What they see.</b> Your first name and last initial. You see where each bonus stands, never their loan.</li>
              <li><b>Taxes.</b> Bonuses of {usd(MISC_THRESHOLD)} or more in a year may be reported to the IRS, so we may ask for your W-9.</li>
            </ul>
          </section>
        )}

        <section className="compare" data-testid="rewards-perks">
          <div className="eyebrow">BEYOND PRICING</div>
          <h2>Your second loan starts halfway done.</h2>
          <ul className="rewards-list">
            <li><b>Start from your last loan.</b> A new application opens with your entity, guarantors and past deals filled in.</li>
            <li><b>Your papers carry over.</b> The same entity&apos;s formation papers and EIN letter, a certificate of good standing from the last 90 days and an ID from the last year don&apos;t need sending again.</li>
            <li><b>Your track record stays confirmed.</b> Deals we confirmed on one loan count on the next without the settlement statements.</li>
            <li><b>Front of the line.</b> Applications and documents from repeat borrowers are worked first in our team&apos;s queue.</li>
          </ul>
        </section>
        <div className="cta">
          <h2>Ready for the next property?<br /><em>Your terms in a minute.</em></h2>
          <Link className="button" href="/start">Get a loan quote <ArrowRight size={19} aria-hidden="true" /></Link>
        </div>
      </main>
    </>
  );
}
