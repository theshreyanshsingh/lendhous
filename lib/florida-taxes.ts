// Florida's taxes on a loan's closing (docs/competitor-gaps-2026-11-09.md, rank 2), worked out to the dollar instead of
// sitting inside the estimate's flat closing-cost percentage:
// - documentary stamp tax on the note and mortgage: $0.35 for each $100 or part of $100 secured, with no cap on a mortgage
//   (Fla. Stat. 201.08; Florida DOR). It's paid once, when the mortgage is recorded, and every party to it is liable;
// - nonrecurring intangible tax: 2 mills (0.2%) of the debt a Florida mortgage secures (199.133, 199.135);
// - documentary stamp tax on a purchase's deed: $0.70 for each $100 or part of $100 of the price, or in Miami-Dade $0.60
//   plus a $0.45 surtax unless the deed is of a single-family home (201.02, 201.031). By custom the seller's, and the
//   contract decides, so it's shown to the buyer but not added to what they bring.
// Pure. The estimate's total closing costs stay what the pricing assumes (Spec 5.1); these are the part of them that's
// fixed by law, and the rest is title, recording and settlement.
import type { Application } from "./engine";

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const per100 = (amount: number) => Math.ceil(Math.max(0, amount) / 100);

export const FLORIDA_TAX = { stampsPer100: 0.35, intangible: 0.002, deedPer100: 0.7, miamiDadeDeedPer100: 0.6, miamiDadeSurtaxPer100: 0.45 };

/** Stamps on a note and its mortgage: $0.35 for every $100 or part of $100. */
export const mortgageStamps = (amount: number) => round2(per100(amount) * FLORIDA_TAX.stampsPer100);
/** Intangible tax on the debt secured by Florida property: 0.2%, on the Florida share when other collateral secures it too. */
export const intangibleTax = (amount: number, floridaShare = 1) => round2(Math.max(0, amount) * FLORIDA_TAX.intangible * Math.min(1, Math.max(0, floridaShare)));

/**
 * Stamps on a purchase's deed. In Miami-Dade a single-family home's deed pays no surtax; a condo or townhome is treated as
 * one, a 2–4 unit building isn't (check unusual cases with the closing agent).
 */
export function deedStamps(price: number, county: string, propertyType: Application["propertyType"]) {
  if (/miami-?dade/i.test(county)) return round2(per100(price) * (FLORIDA_TAX.miamiDadeDeedPer100 + (propertyType === "2_4" ? FLORIDA_TAX.miamiDadeSurtaxPer100 : 0)));
  return round2(per100(price) * FLORIDA_TAX.deedPer100);
}

export type ClosingTaxes = { stamps: number; intangible: number; total: number; deed?: number };

/** A Florida loan's taxes at closing on the amount it secures; none outside Florida. The deed's stamps only on a purchase. */
export function closingTaxes(app: Pick<Application, "state" | "county" | "purpose" | "propertyType" | "purchasePrice">, loanAmount: number): ClosingTaxes | null {
  if (app.state !== "FL" || !(loanAmount > 0)) return null;
  const stamps = mortgageStamps(loanAmount);
  const intangible = intangibleTax(loanAmount);
  return { stamps, intangible, total: round2(stamps + intangible), ...(app.purpose === "purchase" ? { deed: deedStamps(app.purchasePrice, app.county, app.propertyType) } : {}) };
}

/**
 * The estimate's closing costs split into what Florida law sets and the rest (title, recording and settlement), adding up
 * to the same total. Outside Florida it's one line, as before.
 */
export function closingCostLines(app: Pick<Application, "state" | "county" | "purpose" | "propertyType" | "purchasePrice">, loanAmount: number, estimate: number, pct: number) {
  const taxes = closingTaxes(app, loanAmount);
  const about = `about ${Math.round(pct * 1000) / 10}%`;
  if (!taxes || taxes.total > estimate) return [{ label: `Closing costs, ${about} (title, recording, taxes)`, amount: estimate }];
  return [
    { label: "Florida doc stamps on the mortgage ($0.35 per $100)", amount: taxes.stamps },
    { label: "Florida intangible tax (0.2%)", amount: taxes.intangible },
    { label: `Title, recording and settlement (the rest of ${about})`, amount: round2(estimate - taxes.total) },
  ];
}

/**
 * Taxes that may be due when a modification adds to what a mortgage secures: stamps and intangible tax on the increase.
 * Whether the change is a taxable renewal turns on 201.09(1), so it's for the closing attorney to confirm.
 */
export const increaseTaxes = (added: number) => (added > 0 ? { stamps: mortgageStamps(added), intangible: intangibleTax(added) } : null);
