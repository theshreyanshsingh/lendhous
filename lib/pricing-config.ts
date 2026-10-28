/**
 * LENDHOUS PRICING CONFIG — *** ALL NUMBERS ARE PLACEHOLDER EXAMPLES (Spec v3, Section 5) ***
 * This is the ONE file to edit to change rates, points, leverage limits, adjusters, score weights,
 * routing thresholds and estimate assumptions. Nothing here is a recommendation or an offer.
 * Percentages are decimals (0.85 = 85%). Rates are annual percentages (11 = 11%). Points are % of note amount.
 */
export type Tier = 1 | 2 | 3 | 4;
export type Range = [number, number];

export interface FlipTier { rate: Range; points: Range; maxLTC: number; maxLTARV: number; maxInitialLTV: number; rehabFinanced: number; minFico: number }
export interface BridgeTier { rate: Range; points: Range; maxLTV: number; minFico: number }
export interface GroundUpTier { rate: Range; points: Range; maxLTC: number; maxLTARV: number; maxLandLTV: number; minFico: number }
export interface DscrCell { maxLTV: number; rateAdd: number }

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
    repeatBorrowerRateCut: 0.25,
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

  routing: { dualApprovalFundingAlways: true, splitEnabled: true /* prototype demo; Spec: off until M8 */ },
};
export type PricingConfig = typeof pricingConfig;
