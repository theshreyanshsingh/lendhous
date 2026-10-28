import type { Deal } from "./mockData";
import { evaluate } from "./engine";
/** Blind teaser payload (Spec 6.5 / 6.7): no street address, no borrower or entity name. */
export function teaserOf(d: Deal) {
  const e = evaluate(d.app);
  const ficoBand = `${Math.floor(d.app.fico / 20) * 20}–${Math.floor(d.app.fico / 20) * 20 + 19}`;
  return {
    teaserId: "T-" + d.loanNumber.slice(-4),
    product: d.app.product, county: d.app.county, zip3: d.zip.slice(0, 3) + "xx", propertyType: d.app.propertyType,
    noteAmount: e.noteAmount, rate: e.rate, points: e.pointsPct, ratios: e.ratios, ficoBand, tier: e.tier, grade: e.score.grade, score: e.score.score,
    exit: d.exitStrategy, closingDate: d.closingDate, termMonths: e.termMonths, affiliatedContractor: !!d.contractorIsGtAffiliate,
    lenderYieldOffered: Math.max(0, e.rate - 1), // after a 1% servicing strip (placeholder, Spec 6.6)
  };
}
