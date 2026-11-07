/**
 * LENDHOUS PRICING CONFIG — *** ALL NUMBERS ARE PLACEHOLDER EXAMPLES (Spec v3, Section 5) ***
 * This is the ONE file to edit to change rates, points, leverage limits, adjusters, score weights,
 * routing thresholds and estimate assumptions. Nothing here is a recommendation or an offer.
 * Percentages are decimals (0.85 = 85%). Rates are annual percentages (11 = 11%). Points are % of note amount.
 */
export type Tier = 1 | 2 | 3 | 4;
/** A repeat borrower's cut once they have this many LendHous loans paid as agreed in the last 24 months. */
export interface RepeatTier { loans: number; rateCut: number; pointsCut: number }
export type Range = [number, number];

export interface FlipTier { rate: Range; points: Range; maxLTC: number; maxLTARV: number; maxInitialLTV: number; rehabFinanced: number; minFico: number }
export interface BridgeTier { rate: Range; points: Range; maxLTV: number; minFico: number }
export interface GroundUpTier { rate: Range; points: Range; maxLTC: number; maxLTARV: number; maxLandLTV: number; minFico: number }
export interface DscrCell { maxLTV: number; rateAdd: number }
/**
 * Short-term (Airbnb, VRBO) rentals on a DSCR loan: the share of the income counted as rent, and what it adds to the price.
 * Payout statements for the last 12 months count for more than a projection; a cash-out counts less of either.
 */
export interface ShortTermRules { historyFactor: number; projectionFactor: number; cashOutFactorCut: number; rateAdd: number; leverageCut: number }
/**
 * PLACEHOLDER until GT sets them (research, 2026-11-07: Easy Street counts 75% of an AirDNA projection; Lima One 75% on a
 * purchase and 70% on a cash-out; Ridge Street prices Airbnb DSCR from 6.0%). Also the fallback for pricing published
 * before short-term rentals were priced.
 */
export const SHORT_TERM_DEFAULTS: ShortTermRules = { historyFactor: 0.8, projectionFactor: 0.75, cashOutFactorCut: 0.05, rateAdd: 0.25, leverageCut: 0.05 };

export const pricingConfig = {
  version: "PLACEHOLDER-v3-2026-10-18",
  /** Which point in each rate/points range the estimate uses for its calculations ("low" | "mid" | "high"). */
  estimatePricePoint: "mid" as "low" | "mid" | "high",

  fixFlip: {
    termMonths: 12,
    tiers: {
      1: { rate: [12.0, 13.0], points: [2.5, 3.0], maxLTC: 0.8, maxLTARV: 0.65, maxInitialLTV: 0.8, rehabFinanced: 1, minFico: 660 },
      2: { rate: [11.0, 12.0], points: [2.0, 2.5], maxLTC: 0.85, maxLTARV: 0.7, maxInitialLTV: 0.85, rehabFinanced: 1, minFico: 640 },
      3: { rate: [10.5, 11.5], points: [1.5, 2.0], maxLTC: 0.9, maxLTARV: 0.725, maxInitialLTV: 0.9, rehabFinanced: 1, minFico: 640 },
      4: { rate: [10.0, 11.0], points: [1.0, 2.0], maxLTC: 0.9, maxLTARV: 0.75, maxInitialLTV: 0.9, rehabFinanced: 1, minFico: 620 },
    } as Record<Tier, FlipTier>,
  },
  bridge: {
    termMonths: 12,
    tiers: {
      1: { rate: [11.0, 12.5], points: [2.0, 3.0], maxLTV: 0.7, minFico: 660 },
      2: { rate: [11.0, 12.5], points: [2.0, 3.0], maxLTV: 0.7, minFico: 660 },
      3: { rate: [10.0, 11.5], points: [1.5, 2.5], maxLTV: 0.75, minFico: 640 },
      4: { rate: [10.0, 11.5], points: [1.5, 2.5], maxLTV: 0.75, minFico: 640 },
    } as Record<Tier, BridgeTier>,
  },
  groundUp: {
    termMonths: 18,
    /** keyed by number of completed ground-up builds; "none" requires >= 3 flips */
    tiers: {
      none: { rate: [12.5, 14.0], points: [2.5, 3.5], maxLTC: 0.75, maxLTARV: 0.65, maxLandLTV: 0.5, minFico: 680 },
      "1to3": { rate: [11.5, 13.0], points: [2.0, 3.0], maxLTC: 0.8, maxLTARV: 0.7, maxLandLTV: 0.6, minFico: 660 },
      "4plus": { rate: [11.0, 12.5], points: [1.5, 2.5], maxLTC: 0.85, maxLTARV: 0.7, maxLandLTV: 0.65, minFico: 660 },
    } as Record<"none" | "1to3" | "4plus", GroundUpTier>,
    minFlipsIfNoBuilds: 3,
  },
  dscr: {
    baseRate: [7.0, 8.5] as Range,
    points: [1.0, 2.0] as Range,
    amortizationMonths: 360,
    /** "amortizing" = qualify on 30-yr P&I; "io" = qualify on interest-only payment (Spec 5.1, example E) */
    qualifyOn: "amortizing" as "amortizing" | "io",
    cashOutLtvReduction: 0.05,
    /** DSCR column lower bounds (lower-bound inclusive). Last column = sub-1.0 */
    dscrBands: [1.25, 1.1, 1.0, 0.75],
    /** FICO row lower bounds */
    ficoBands: [760, 720, 680, 660],
    /** grid[ficoRow][dscrCol]; null = not eligible */
    grid: [
      [{ maxLTV: 0.8, rateAdd: 0 }, { maxLTV: 0.8, rateAdd: 0.125 }, { maxLTV: 0.75, rateAdd: 0.375 }, { maxLTV: 0.65, rateAdd: 1.0 }],
      [{ maxLTV: 0.8, rateAdd: 0.25 }, { maxLTV: 0.75, rateAdd: 0.375 }, { maxLTV: 0.75, rateAdd: 0.5 }, { maxLTV: 0.65, rateAdd: 1.25 }],
      [{ maxLTV: 0.75, rateAdd: 0.5 }, { maxLTV: 0.75, rateAdd: 0.625 }, { maxLTV: 0.7, rateAdd: 0.875 }, { maxLTV: 0.6, rateAdd: 1.5 }],
      [{ maxLTV: 0.7, rateAdd: 0.875 }, { maxLTV: 0.7, rateAdd: 1.0 }, { maxLTV: 0.65, rateAdd: 1.25 }, null],
    ] as (DscrCell | null)[][],
    shortTerm: { ...SHORT_TERM_DEFAULTS } as ShortTermRules | undefined,
  },

  experienceTiers: [ { tier: 1 as Tier, min: 0 }, { tier: 2 as Tier, min: 2 }, { tier: 3 as Tier, min: 5 }, { tier: 4 as Tier, min: 10 } ],

  adjusters: {
    smallLoanThreshold: 100_000, smallLoanRateAdd: 0.5,
    largeLoanManualReview: 1_500_000,
    twoToFourUnitsLeverageCut: 0.05,
    condoLeverageCut: 0.05, condoRateAdd: 0.25,
    expansionCountyLeverageCut: 0.05,
    heavyRehabRatio: 1.0, heavyRehabLtcCut: 0.05,
    foreignNationalLeverageCut: 0.1, foreignNationalRateAdd: 1.0,
    /** Pricing published before the tiers existed: one flat cut for any repeat borrower. */
    repeatBorrowerRateCut: 0.25 as number | undefined,
    // PLACEHOLDER tiers until GT sets them (research: New Silver cuts 0.50/0.75/1.00% rate and 0.25/0.50/0.75 points at
    // 3/6/10 loans). By loans paid as agreed in the last 24 months; a late payment pauses it (lib/repeat-borrower.ts).
    repeatTiers: [
      { loans: 1, rateCut: 0.25, pointsCut: 0 },
      { loans: 3, rateCut: 0.5, pointsCut: 0.25 },
      { loans: 6, rateCut: 0.75, pointsCut: 0.5 },
      { loans: 10, rateCut: 1.0, pointsCut: 0.75 },
    ] as RepeatTier[] | undefined,
    /**
     * PLACEHOLDER until GT sets it: what a point buys off the rate when a borrower buys it down, or gives back when they buy
     * it up (lib/buy-down.ts): on a DSCR rental, and on the loans of a year or so. Kiavi's rental "Compare Mode" offers the
     * same choice.
     */
    buyDownRatePerPoint: 0.25 as number | undefined,
    buyDownShortRatePerPoint: 0.5 as number | undefined,
  },

  geography: {
    core: ["Miami-Dade", "Broward", "Palm Beach"],
    expansion: ["Monroe", "Martin", "St. Lucie", "Collier", "Lee", "Hillsborough", "Orange", "Duval", "Other FL"],
    // anything else (outside FL) = partner only
  },

  loanSize: { min: 75_000, maxInHouse: 1_500_000, maxOverall: 3_000_000 },
  liquidity: { monthsOfPaymentsRequired: 3, rehabPctRequired: 0.1 },
  minProfitMargin: 0.1,
  minDscr: 1.0,

  /** Estimate assumptions shown to the borrower (editable) */
  assumptions: {
    buyClosingCostPct: 0.02,
    lenderFees: 1_500, // processing + underwriting (placeholder)
    sellingCostPct: 0.07,
    holdingCostMonthly: 1_000, // taxes, insurance, utilities while rehabbing
    holdMonths: 9,
  },

  /** All-in annualized cost flag (Spec 5.1 ex. I). Ceiling is a placeholder until the attorney sets it (flag 10.8 #17). */
  allInCostFlagCeiling: 0.18,

  score: {
    weights: { leverage: 25, credit: 15, experience: 15, economics: 20, liquidity: 10, location: 10, dataQuality: 5 },
    grades: [ { grade: "A", min: 85 }, { grade: "B", min: 70 }, { grade: "C", min: 55 }, { grade: "D", min: 40 }, { grade: "E", min: 0 } ],
  },
  colorBands: { yellowWithin: 0.025, dscrYellowWithin: 0.1 },

  // PLACEHOLDER, like the rest of this file. 10% matches the Spec's worked draw example.
  draws: { retainagePct: 0.1, secondApproverAbove: 50_000 },

  /**
   * Servicing (Spec 8). PLACEHOLDER until the attorney sets them against the note: a payment is late once the grace days
   * after its due date have passed, and then owes a late fee of lateFeePct of that payment. A loan is delinquent once its
   * oldest unpaid payment is delinquentDays past due. After maturity, interest runs at the note rate plus defaultRateAdd,
   * never above defaultRateMax (Florida's usury cap is 18% a year on loans up to $500,000). Borrowers hear about maturity
   * maturityNoticeDays before it.
   */
  servicing: { graceDays: 10, lateFeePct: 0.05, delinquentDays: 30, defaultNoticeDays: 90, defaultRateAdd: 6, defaultRateMax: 18, maturityNoticeDays: [60, 30] },
  /**
   * Extensions (Spec 8.4). PLACEHOLDER: a loan can be extended at most maxCount times, by up to monthsEach months each
   * time, for feePoints points of the note amount per monthsEach months. Borrowers can ask from requestWindowDays before
   * maturity; the team can file a request at any time.
   */
  extensions: { maxCount: 2, monthsEach: 3, feePoints: 1, requestWindowDays: 60 },
  /** Days after payoff to get the satisfaction of mortgage out. Florida's is 60 (Fla. Stat. 701.04); the attorney confirms. */
  lienReleaseDays: 60,
  routing: { dualApprovalFundingAlways: true, splitEnabled: true /* prototype demo; Spec: off until M8 */ },
};
export type PricingConfig = typeof pricingConfig;
