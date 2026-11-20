"use client";
import { purchaseTaxes, type Application } from "@/lib/engine";

const money = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/**
 * On a rental purchase: the county's millage, and the taxes it puts on the price beside the seller's bill (rank 22). The
 * DSCR uses whichever is higher, since a seller's homestead-capped bill understates what a buyer will pay.
 */
export function PurchaseTaxes({ app, onMillage }: { app: Application; onMillage: (millage: number) => void }) {
  const estimate = purchaseTaxes(app);
  const bill = app.taxesAnnual ?? 0;
  return (
    <div className="space-y-1" data-testid="purchase-taxes">
      <label className="block"><span className="label">Millage (mills, from the county tax collector)</span>
        <input className="desk-input" inputMode="decimal" data-testid="uw-millage" defaultValue={app.millage ?? ""} placeholder="e.g. 18.5" onBlur={(event) => { const value = Number(event.target.value.replace(/[^0-9.]/g, "")); if (event.target.value.trim() && Number.isFinite(value) && value >= 0 && value <= 60) onMillage(Math.round(value * 1000) / 1000); }} />
      </label>
      <p className="text-[11px] text-faint" data-testid="purchase-taxes-line">
        {estimate === null ? "Enter the millage to estimate the buyer's taxes on the price: a seller's homestead-capped bill can be far lower."
          : estimate > bill ? `On the ${money(app.purchasePrice)} price: ${money(estimate)} a year, above the ${money(bill)} bill. The DSCR uses ${money(estimate)}.`
          : `On the price: ${money(estimate)} a year. The ${money(bill)} bill is higher, so the DSCR uses it.`}
      </p>
    </div>
  );
}
