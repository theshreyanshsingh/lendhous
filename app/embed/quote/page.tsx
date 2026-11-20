import { referralByCode } from "@/lib/broker-store";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { siteSlug } from "@/lib/quote-funnel";
import { getSettings } from "@/lib/settings";
import { QuoteRequest } from "../../(site)/start/quote-request";

// Terms come from the pricing the owner last published, so the widget is built per visit, like /start.
export const dynamic = "force-dynamic";

/**
 * The quote, for a partner's or one of GT's own sites to frame (`?ref=` a broker's or borrower's referral code, `?site=` which site it
 * sits on). Everything else about it is the /start quote: terms first, contact details only to save them.
 */
export default async function EmbeddedQuote({ searchParams }: { searchParams: Promise<{ ref?: string; site?: string; brand?: string }> }) {
  await loadPricing();
  const { ref, site, brand } = await searchParams;
  const referral = await referralByCode(ref).catch(() => null);
  // A broker's widget can wear its brand (lib/broker-kit.ts); LendHous is still named as the lender.
  const branded = brand === "1" && referral?.kind === "broker" ? referral.brand : undefined;
  return (
    <main className="embed-quote" data-testid="embed-quote">
      <h1 className="sr-only">{branded ? `${branded.name}: loan quote` : "LendHous loan quote"}</h1>
      {branded ? (
        <div className="embed-head" data-testid="embed-broker-brand"><span className="embed-brand">{branded.name}</span><span className="quote-small">{[branded.phone, branded.email].filter(Boolean).join(" · ")}{branded.phone || branded.email ? " · " : ""}loans made by LendHous</span></div>
      ) : <div className="embed-head"><span className="embed-brand">LendHous<i>.</i></span><span className="quote-small">Investor loans in Florida · indicative terms in a minute</span></div>}
      <QuoteRequest pricing={currentPricing()} signupOpen={(await getSettings()).allowSignup !== false} referral={referral ? { code: ref!, name: referral.name, kind: referral.kind } : undefined} embed={{ site: siteSlug(site) }} />
    </main>
  );
}
