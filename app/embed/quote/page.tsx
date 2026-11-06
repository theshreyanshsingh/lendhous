import { brokerByReferral } from "@/lib/broker-store";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { siteSlug } from "@/lib/quote-funnel";
import { getSettings } from "@/lib/settings";
import { QuoteRequest } from "../../(site)/start/quote-request";

// Terms come from the pricing the owner last published, so the widget is built per visit, like /start.
export const dynamic = "force-dynamic";

/**
 * The quote, for a partner's or one of GT's own sites to frame (`?ref=` a broker's referral code, `?site=` which site it
 * sits on). Everything else about it is the /start quote: terms first, contact details only to save them.
 */
export default async function EmbeddedQuote({ searchParams }: { searchParams: Promise<{ ref?: string; site?: string }> }) {
  await loadPricing();
  const { ref, site } = await searchParams;
  const referral = await brokerByReferral(ref).catch(() => null);
  return (
    <main className="embed-quote" data-testid="embed-quote">
      <h1 className="sr-only">LendHous loan quote</h1>
      <div className="embed-head"><span className="embed-brand">LendHous<i>.</i></span><span className="quote-small">Investor loans in Florida · indicative terms in a minute</span></div>
      <QuoteRequest pricing={currentPricing()} signupOpen={(await getSettings()).allowSignup !== false} referral={referral ? { code: ref!, name: referral.name } : undefined} embed={{ site: siteSlug(site) }} />
    </main>
  );
}
