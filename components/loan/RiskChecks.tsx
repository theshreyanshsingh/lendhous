"use client";
import { FloodMapLine } from "./FloodMapLine";
import Link from "next/link";
import { useState } from "react";
import { Section, statusLabel, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { concentrationWarnings, duplicateMatches, priceJump, PRICE_JUMP } from "@/lib/risk";
import { useStore } from "@/lib/store";

/**
 * The loan's fraud and concentration checks (lib/risk.ts): other loans with the same property, company or person, the
 * purchase price against the last recorded sale, and what funding it would do to the book's limits.
 */
export function RiskChecks({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const today = serviceDay(s);
  const matches = duplicateMatches(s.deals, deal);
  const jump = priceJump(deal, today);
  const warnings = concentrationWarnings(s.deals, deal);
  const [sale, setSale] = useState({ price: deal.lastSale ? String(deal.lastSale.price) : "", on: deal.lastSale?.on ?? "" });
  return (
    <Section title="Fraud and concentration checks">
      <div className="space-y-3 text-sm" data-testid="risk-checks">
        {matches.length ? (
          <div data-testid="risk-matches"><p className="font-medium text-warn">On other loans too</p><ul className="mt-1 space-y-1">{matches.map((match) => <li key={match.dealId} data-testid="risk-match"><Link className="text-link underline underline-offset-2" href={`/admin/deals/${match.dealId}`}>{match.loanNumber}</Link> ({statusLabel(match.status)}): {match.why.join(", ")}</li>)}</ul></div>
        ) : <p className="text-muted-foreground" data-testid="risk-no-matches">No other loan has this property, company or these people.</p>}
        {deal.app.purpose === "purchase" && (
          <div className="border-t border-border pt-3">
            {jump ? <p className={jump.flagged ? "text-bad" : "text-muted-foreground"} data-testid="price-jump">{jump.flagged ? "Possible flip between related parties: " : ""}The {usd(deal.app.purchasePrice)} purchase price is {Math.round(jump.rise * 100)}% {jump.rise >= 0 ? "above" : "below"} the {usd(deal.lastSale!.price)} it last sold for on {shortDay(deal.lastSale!.on)}{jump.flagged ? `, within ${PRICE_JUMP.months} months. Check the seller isn't related to the borrower and the price is supported.` : "."}</p>
              : <p className="text-muted-foreground">Enter the property&apos;s last recorded sale, from the county property appraiser, to check the price for a quick resale at a jump.</p>}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Last sold for</span><input className="desk-input w-36!" inputMode="numeric" data-testid="last-sale-price" placeholder="$0" value={sale.price} onChange={(event) => setSale({ ...sale, price: event.target.value.replace(/[^0-9]/g, "") })} /></label>
              <label className="block"><span className="label">On</span><input className="desk-input w-auto!" type="date" data-testid="last-sale-on" max={today} value={sale.on} onChange={(event) => setSale({ ...sale, on: event.target.value })} /></label>
              <button type="button" className="btn-ghost" data-testid="save-last-sale" disabled={!Number(sale.price) || !sale.on} onClick={() => void dispatch({ t: "saveLastSale", dealId: deal.id, price: Number(sale.price), on: sale.on, by: viewerName })}>Save</button>
            </div>
          </div>
        )}
        {warnings.length > 0 && <ul className="space-y-1 border-t border-border pt-3 text-warn" data-testid="risk-concentration">{warnings.map((item) => <li key={item}>{item}</li>)}</ul>}
        {/* The flood zone is a risk on every Florida loan, long before the insurance is sorted out on the Closing tab. */}
        <div className="border-t border-border pt-3"><p className="font-medium">Flood zone</p><FloodMapLine deal={deal} /></div>
      </div>
    </Section>
  );
}
