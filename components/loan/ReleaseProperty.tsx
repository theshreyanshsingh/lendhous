"use client";
import { useState } from "react";
import { Section, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { heldProperties, isPortfolio, limitsOf, releaseQuote } from "@/lib/portfolio";
import { SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

/**
 * Letting one property of a portfolio loan go when it's sold or refinanced (Spec 8.9, lib/portfolio.ts): the release price
 * and why, interest on it to the day, the loan afterwards re-tested against its limits, and recording the money.
 */
export function ReleaseProperty({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const held = heldProperties(deal);
  const [propertyId, setPropertyId] = useState(held[0]?.id ?? "");
  const [on, setOn] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  if (!isPortfolio(deal) || !SERVICED.includes(deal.status)) return null;
  const day = on || today;
  const quote = day && propertyId ? releaseQuote(deal, propertyId, day) : null;
  const limits = limitsOf(deal);
  const paid = amount ? Number(amount.replace(/[^0-9.]/g, "")) : quote && !("problem" in quote) ? quote.total : 0;
  const record = async () => {
    if (!quote || "problem" in quote) return;
    if (await dispatch({ t: "releaseProperty", dealId: deal.id, propertyId, on: day, amount: paid, reference, by: viewerName })) { setAmount(""); setReference(""); setOn(""); setPropertyId(heldProperties(deal).find((item) => item.id !== propertyId)?.id ?? ""); }
  };
  return (
    <Section title="Release a property">
      <div className="space-y-3 text-sm" data-testid="release-property">
        {held.length > 1 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2"><span className="label">Property</span><select className="desk-input" data-testid="release-which" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>{held.map((item) => <option key={item.id} value={item.id}>{item.address}, {item.city}</option>)}</select></label>
              <label className="block"><span className="label">Money arrived on</span><input type="date" className="desk-input" data-testid="release-on" max={today} value={day} onChange={(event) => setOn(event.target.value)} /></label>
            </div>
            {quote && "problem" in quote && <p className="text-xs text-warn" data-testid="release-problem">{quote.problem}</p>}
            {quote && !("problem" in quote) && (
              <div className="space-y-2" data-testid="release-quote">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[2px] border border-border p-3 sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Release price</dt><dd className="font-semibold tabular-nums" data-testid="release-price">{usd(quote.price)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Interest to the day</dt><dd className="tabular-nums">{usd(quote.interest, 2)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">To receive</dt><dd className="font-semibold tabular-nums" data-testid="release-total">{usd(quote.total, 2)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">New payment</dt><dd className="tabular-nums" data-testid="release-payment">{usd(quote.after.payment, 2)}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground" data-testid="release-why">{quote.price > quote.premiumPrice ? `More than its ${usd(quote.premiumPrice)} premium price: the rest of the loan needs at least ${usd(quote.minimum)} paid down to stay within its limits.` : `Its share of the loan, ${usd(quote.allocated)}, times the release premium.`} Afterwards {usd(quote.after.balance)} is owed on {usd(quote.after.value)} of property: {(quote.after.ltv * 100).toFixed(1)}% loan to value (limit {(limits.maxLtv * 100).toFixed(1)}%) and {quote.after.dscr.toFixed(2)} coverage (at least {limits.minDscr.toFixed(2)}).</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block"><span className="label">Amount received</span><input className="desk-input w-40!" inputMode="decimal" data-testid="release-amount" placeholder={quote.total.toFixed(2)} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
                  <label className="block min-w-0 flex-1 basis-40"><span className="label">Reference</span><input className="desk-input" data-testid="release-reference" maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
                  <button type="button" className="btn-primary" data-testid="record-release" disabled={paid + 0.005 < quote.total} onClick={() => void record()}>Record the release</button>
                </div>
                {paid + 0.005 < quote.total && <p className="text-xs text-warn">That&apos;s short of the {usd(quote.total, 2)} the release takes.</p>}
              </div>
            )}
          </>
        )}
        {held.length <= 1 && <p className="text-muted-foreground">One property is left on the loan: it&apos;s released by paying the loan off.</p>}
        {(deal.releases ?? []).length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {deal.releases!.map((release) => <li key={release.id} className="py-2" data-testid="release-row">{deal.properties?.find((item) => item.id === release.propertyId)?.address} released {shortDay(release.on)}: {usd(release.principal, 2)} to principal, {usd(release.interest, 2)} interest{release.reference ? ` (${release.reference})` : ""}. Payment from then: {usd(release.newPayment, 2)}.</li>)}
          </ul>
        )}
      </div>
    </Section>
  );
}
