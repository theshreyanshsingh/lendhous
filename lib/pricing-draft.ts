// The numbers the owner can change in the app (Spec A22): each product's rates, points, leverage and minimum score, the
// loan terms, and the servicing and extension terms that go into the note. Everything else in the config (score weights,
// geography, adjusters, the DSCR grid) carries over unchanged. Pure, so the editor and the server check it the same way.
import { z } from "zod";
import { ratePerPointOf } from "./buy-down";
import { repeatTiersOf, shortTermOf } from "./engine";
import type { PricingConfig, Range, Tier } from "./pricing-config";

const TIERS = [1, 2, 3, 4] as const;
const BUILDS = ["none", "1to3", "4plus"] as const;

const rate = z.number().finite().min(0).max(30);
const points = z.number().finite().min(0).max(10);
const share = z.number().finite().min(0).max(1);
const fico = z.number().int().min(300).max(850);
const months = z.number().int().min(1).max(60);
const range = (part: z.ZodNumber) => z.tuple([part, part]);

const flipTier = z.object({ rate: range(rate), points: range(points), maxLTC: share, maxLTARV: share, maxInitialLTV: share, minFico: fico });
const bridgeTier = z.object({ rate: range(rate), points: range(points), maxLTV: share, minFico: fico });
const buildTier = z.object({ rate: range(rate), points: range(points), maxLTC: share, maxLTARV: share, maxLandLTV: share, minFico: fico });

export const draftSchema = z.object({
  estimatePricePoint: z.enum(["low", "mid", "high"]),
  fixFlip: z.object({ termMonths: months, tiers: z.object({ 1: flipTier, 2: flipTier, 3: flipTier, 4: flipTier }) }),
  bridge: z.object({ termMonths: months, tiers: z.object({ 1: bridgeTier, 2: bridgeTier, 3: bridgeTier, 4: bridgeTier }) }),
  groundUp: z.object({ termMonths: months, tiers: z.object({ none: buildTier, "1to3": buildTier, "4plus": buildTier }) }),
  dscr: z.object({ baseRate: range(rate), points: range(points), shortTerm: z.object({ historyFactor: share, projectionFactor: share, cashOutFactorCut: share, rateAdd: z.number().finite().min(0).max(5), leverageCut: share }) }),
  loanSize: z.object({ min: z.number().int().min(0).max(100_000_000), maxInHouse: z.number().int().min(0).max(100_000_000), maxOverall: z.number().int().min(0).max(100_000_000) }),
  lenderFees: z.number().finite().min(0).max(100_000),
  servicing: z.object({ graceDays: z.number().int().min(0).max(30), lateFeePct: z.number().finite().min(0).max(0.2), delinquentDays: z.number().int().min(1).max(120), defaultRateAdd: z.number().finite().min(0).max(25), defaultRateMax: z.number().finite().min(0).max(36) }),
  buyDownRatePerPoint: z.number().finite().min(0).max(2),
  buyDownShortRatePerPoint: z.number().finite().min(0).max(2),
  repeatTiers: z.array(z.object({ loans: z.number().int().min(1).max(100), rateCut: z.number().finite().min(0).max(3), pointsCut: points })).min(1).max(6),
  extensions: z.object({ maxCount: z.number().int().min(0).max(6), monthsEach: z.number().int().min(1).max(12), feePoints: points, requestWindowDays: z.number().int().min(0).max(180) }),
});
export type PricingDraft = z.infer<typeof draftSchema>;

/** The editable part of a config. */
export function draftOf(config: PricingConfig): PricingDraft {
  const flip = (tier: Tier) => { const t = config.fixFlip.tiers[tier]; return { rate: [...t.rate] as Range, points: [...t.points] as Range, maxLTC: t.maxLTC, maxLTARV: t.maxLTARV, maxInitialLTV: t.maxInitialLTV, minFico: t.minFico }; };
  const bridge = (tier: Tier) => { const t = config.bridge.tiers[tier]; return { rate: [...t.rate] as Range, points: [...t.points] as Range, maxLTV: t.maxLTV, minFico: t.minFico }; };
  const build = (key: (typeof BUILDS)[number]) => { const t = config.groundUp.tiers[key]; return { rate: [...t.rate] as Range, points: [...t.points] as Range, maxLTC: t.maxLTC, maxLTARV: t.maxLTARV, maxLandLTV: t.maxLandLTV, minFico: t.minFico }; };
  const { graceDays, lateFeePct, delinquentDays, defaultRateAdd, defaultRateMax } = config.servicing;
  return {
    estimatePricePoint: config.estimatePricePoint,
    fixFlip: { termMonths: config.fixFlip.termMonths, tiers: { 1: flip(1), 2: flip(2), 3: flip(3), 4: flip(4) } },
    bridge: { termMonths: config.bridge.termMonths, tiers: { 1: bridge(1), 2: bridge(2), 3: bridge(3), 4: bridge(4) } },
    groundUp: { termMonths: config.groundUp.termMonths, tiers: { none: build("none"), "1to3": build("1to3"), "4plus": build("4plus") } },
    dscr: { baseRate: [...config.dscr.baseRate] as Range, points: [...config.dscr.points] as Range, shortTerm: { ...shortTermOf(config) } },
    loanSize: { ...config.loanSize },
    lenderFees: config.assumptions.lenderFees,
    servicing: { graceDays, lateFeePct, delinquentDays, defaultRateAdd, defaultRateMax },
    extensions: { ...config.extensions },
    buyDownRatePerPoint: ratePerPointOf(config, "dscr"),
    buyDownShortRatePerPoint: ratePerPointOf(config, "fix_flip"),
    repeatTiers: repeatTiersOf(config).map((tier) => ({ ...tier })),
  };
}

/** A full config: the base with the draft's numbers on it, under a new version name. */
export function applyDraft(base: PricingConfig, draft: PricingDraft, version: string): PricingConfig {
  return {
    ...base,
    version,
    estimatePricePoint: draft.estimatePricePoint,
    fixFlip: { ...base.fixFlip, termMonths: draft.fixFlip.termMonths, tiers: Object.fromEntries(TIERS.map((tier) => [tier, { ...base.fixFlip.tiers[tier], ...draft.fixFlip.tiers[tier] }])) as PricingConfig["fixFlip"]["tiers"] },
    bridge: { ...base.bridge, termMonths: draft.bridge.termMonths, tiers: Object.fromEntries(TIERS.map((tier) => [tier, { ...base.bridge.tiers[tier], ...draft.bridge.tiers[tier] }])) as PricingConfig["bridge"]["tiers"] },
    groundUp: { ...base.groundUp, termMonths: draft.groundUp.termMonths, tiers: Object.fromEntries(BUILDS.map((key) => [key, { ...base.groundUp.tiers[key], ...draft.groundUp.tiers[key] }])) as PricingConfig["groundUp"]["tiers"] },
    dscr: { ...base.dscr, baseRate: draft.dscr.baseRate, points: draft.dscr.points, shortTerm: draft.dscr.shortTerm },
    loanSize: draft.loanSize,
    assumptions: { ...base.assumptions, lenderFees: draft.lenderFees },
    servicing: { ...base.servicing, ...draft.servicing },
    extensions: draft.extensions,
    adjusters: { ...base.adjusters, repeatTiers: draft.repeatTiers, buyDownRatePerPoint: draft.buyDownRatePerPoint, buyDownShortRatePerPoint: draft.buyDownShortRatePerPoint },
  };
}

/** What makes a draft unusable: these stop it being published. */
export function draftProblems(draft: PricingDraft): string[] {
  const problems: string[] = [];
  const ranges: [string, Range][] = [
    ...TIERS.flatMap((tier): [string, Range][] => [[`Fix & flip tier ${tier} rate`, draft.fixFlip.tiers[tier].rate], [`Fix & flip tier ${tier} points`, draft.fixFlip.tiers[tier].points], [`Bridge tier ${tier} rate`, draft.bridge.tiers[tier].rate], [`Bridge tier ${tier} points`, draft.bridge.tiers[tier].points]]),
    ...BUILDS.flatMap((key): [string, Range][] => [[`Ground-up (${key}) rate`, draft.groundUp.tiers[key].rate], [`Ground-up (${key}) points`, draft.groundUp.tiers[key].points]]),
    ["DSCR base rate", draft.dscr.baseRate], ["DSCR points", draft.dscr.points],
  ];
  for (const [label, [low, high]] of ranges) if (low > high) problems.push(`${label}: the low end is above the high end.`);
  const { min, maxInHouse, maxOverall } = draft.loanSize;
  if (min > maxInHouse || maxInHouse > maxOverall) problems.push("Loan sizes must go minimum ≤ largest in-house ≤ largest overall.");
  if (draft.servicing.defaultRateMax < draft.servicing.defaultRateAdd) problems.push("The default rate cap is below the default margin.");
  if (draft.repeatTiers.some((tier, at) => at > 0 && tier.loans <= draft.repeatTiers[at - 1].loans)) problems.push("Each repeat-borrower tier needs more loans than the one before it.");
  if (draft.extensions.maxCount > 0 && draft.extensions.monthsEach < 1) problems.push("An extension needs at least one month.");
  const shortTerm = draft.dscr.shortTerm;
  if (shortTerm.historyFactor > 1 || shortTerm.projectionFactor > 1) problems.push("A short-term rental can't count more than all of its income.");
  if (shortTerm.cashOutFactorCut >= Math.min(shortTerm.historyFactor, shortTerm.projectionFactor)) problems.push("The cash-out cut would leave a short-term rental with no income counted.");
  // Above 25% a year is criminal usury in Florida whatever the loan size (Fla. Stat. 687.071), so it can't be published.
  if (highestRate(draft) > 25) problems.push(`No rate can go above 25% a year: that's criminal usury in Florida (Fla. Stat. 687.071). The highest here is ${highestRate(draft)}%.`);
  if (draft.servicing.defaultRateMax > 25) problems.push("The default rate cap can't go above 25% a year (Fla. Stat. 687.071).");
  return problems;
}

const highestRate = (draft: PricingDraft) => Math.max(...TIERS.flatMap((tier) => [draft.fixFlip.tiers[tier].rate[1], draft.bridge.tiers[tier].rate[1]]), ...BUILDS.map((key) => draft.groundUp.tiers[key].rate[1]), draft.dscr.baseRate[1]);

/** Worth a second look before publishing, but allowed. Florida's usury cap is the attorney's call: these only flag it. */
export function draftWarnings(draft: PricingDraft): string[] {
  const warnings: string[] = [];
  const highest = highestRate(draft);
  if (highest > 18) warnings.push(`The highest rate is ${highest}%. Florida caps interest at 18% a year on loans of $500,000 or less (25% above that, Fla. Stat. 687.02–.03); ask the attorney before going above it.`);
  if (draft.servicing.defaultRateMax > 18) warnings.push(`The default rate can reach ${draft.servicing.defaultRateMax}%, above Florida's 18% cap on loans of $500,000 or less.`);
  if (draft.servicing.lateFeePct > 0.05) warnings.push(`A ${draft.servicing.lateFeePct * 100}% late fee is above the usual 5%; check the note and the attorney's advice.`);
  return warnings;
}

/** The labels a change list uses, field by field, so the audit log and the editor say what moved. */
export function draftChanges(before: PricingDraft, after: PricingDraft): string[] {
  const changes: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    // A range compares as one value; a list of tiers is walked tier by tier, after saying if tiers were added or taken out.
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length && [...a, ...b].some((item) => typeof item === "object")) {
      changes.push(`${path}: ${a.length} → ${b.length} tiers`);
      for (let at = 0; at < Math.min(a.length, b.length); at++) walk(a[at], b[at], `${path}.${at}`);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((item) => typeof item !== "object")) { if (a.join() !== b.join()) changes.push(`${path}: ${a.join("–")} → ${b.join("–")}`); return; }
    if (a && b && typeof a === "object" && typeof b === "object") { for (const key of Object.keys(b)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key); return; }
    if (a !== b) changes.push(`${path}: ${String(a)} → ${String(b)}`);
  };
  walk(before, after, "");
  return changes;
}
