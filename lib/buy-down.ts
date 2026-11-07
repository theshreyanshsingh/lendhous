// Buying the rate down (docs/competitor-gaps.md, 1.7): more points at closing for a lower rate, or fewer for a higher one.
// Every choice stays inside the loan's matrix and Florida's usury caps (points count as interest), so none needs an owner's
// exception. The quote shows the choices as indicative; a term sheet fixes them when it's sent, and the borrower accepts one.
// Pure, so the quote, the term sheet and the tests agree.
import { evaluate, round2, type Application } from "./engine";
import type { BuyDownChoice } from "./mockData";
import type { PricingConfig, Range } from "./pricing-config";
import { currentPricing, pricingFor } from "./pricing-versions";
import { usuryCheck } from "./usury";

/** Points move in quarter-point steps, at most this many either way. */
export const BUY_DOWN_STEP = 0.25;
export const BUY_DOWN_STEPS = 8;
/**
 * PLACEHOLDER until GT sets them: what a point buys off the rate. A point is worth more rate on a loan of a year or so than
 * on a 30-year rental, which is outstanding for years. Also the fallback for pricing published before them.
 */
export const RATE_PER_POINT = { rental: 0.25, shortTerm: 0.5 };

export const ratePerPointOf = (config: PricingConfig, product: Application["product"]) =>
  product === "dscr" ? config.adjusters.buyDownRatePerPoint ?? RATE_PER_POINT.rental : config.adjusters.buyDownShortRatePerPoint ?? RATE_PER_POINT.shortTerm;

export type BuyDownOption = BuyDownChoice;

/**
 * The rate and points a borrower can choose from, around a starting pair, in quarter-point steps: each step up in points takes
 * the rate down by the pricing's rate-per-point. Kept to the matrix's ranges, eligible, under the all-in ceiling and under the
 * usury cap counted with the points spread over the term. Sorted from the fewest points. The starting pair is always in it
 * when it qualifies.
 */
export function buyDownOptions(app: Application, start: { rate: number; points: number }, limits: { rate: Range; points: Range }, config: PricingConfig = pricingFor(app.pricingVersion)): BuyDownOption[] {
  const perPoint = ratePerPointOf(config, app.product);
  const options: BuyDownOption[] = [];
  for (let step = -BUY_DOWN_STEPS; step <= BUY_DOWN_STEPS; step++) {
    const points = round2(start.points + step * BUY_DOWN_STEP);
    // Kept to four decimals, so a rate-per-point the owner sets that isn't in eighths still prices exactly.
    const rate = Math.round((start.rate - step * BUY_DOWN_STEP * perPoint) * 10_000) / 10_000;
    if (points < limits.points[0] - 1e-9 || points > limits.points[1] + 1e-9 || rate < limits.rate[0] - 1e-9 || rate > limits.rate[1] + 1e-9 || points < 0) continue;
    const e = evaluate({ ...app, termRate: rate, termPoints: points }, config);
    if (!e.eligible) continue;
    if (app.product !== "dscr" && e.allIn >= config.allInCostFlagCeiling) continue;
    if (usuryCheck({ amount: e.noteAmount, rate, points, termMonths: e.termMonths }).overLender) continue;
    options.push({ points, rate, noteAmount: e.noteAmount, monthlyPayment: e.monthlyPayment, pointsDollars: e.points, cashToClose: e.cashToClose });
  }
  return options;
}

/** The choices on an indicative quote: around the estimate's own rate and points, inside its matrix. */
export function quoteBuyDowns(app: Application, config: PricingConfig = currentPricing()) {
  const e = evaluate(app, config);
  if (!e.eligible) return [];
  return buyDownOptions(app, { rate: e.rate, points: e.pointsPct }, { rate: e.rateLimits, points: e.pointsRange }, config);
}

/** The option for a number of points, if there is one. */
export const optionAt = (options: BuyDownOption[] | undefined, points: number) => options?.find((option) => Math.abs(option.points - points) < 1e-9);
