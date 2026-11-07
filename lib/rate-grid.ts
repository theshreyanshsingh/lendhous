// The public rate grid (docs/competitor-gaps.md, 1.7): leverage and starting rates by experience and credit, from the
// pricing the owner last published, so the site can never advertise numbers the quotes and loans don't use. Pure.
import { ratePerPointOf } from "./buy-down";
import { repeatTiersOf, shortTermOf } from "./engine";
import type { PricingConfig, Range, Tier } from "./pricing-config";

const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
const rate = (value: number) => `${value.toFixed(2)}%`;
const span = ([low, high]: Range, unit = "%") => (low === high ? `${low}${unit}` : `${low}–${high}${unit}`);

export type GridRow = { label: string; cells: string[] };
export type GridTable = { key: string; title: string; note: string; columns: string[]; rows: GridRow[]; href: string };

/** "0–1 deals", "2–4 deals", … from the experience tiers' lower bounds. */
export function experienceLabels(config: PricingConfig): Record<Tier, string> {
  const tiers = [...config.experienceTiers].sort((a, b) => a.min - b.min);
  return Object.fromEntries(tiers.map((tier, at) => {
    const next = tiers[at + 1];
    return [tier.tier, next ? `${tier.min}–${next.min - 1} deals` : `${tier.min}+ deals`];
  })) as Record<Tier, string>;
}

export function rateGrid(config: PricingConfig): GridTable[] {
  const deals = experienceLabels(config);
  const tiers: Tier[] = [1, 2, 3, 4];
  const flip = config.fixFlip.tiers;
  const bridge = config.bridge.tiers;
  const build = config.groundUp.tiers;
  const dscr = config.dscr;
  const lowestRate = dscr.baseRate[0];
  return [
    {
      key: "fix_flip", title: "Fix & flip", href: "/programs/fix-flip",
      note: `By completed flips or rentals in the last 3 years. ${config.fixFlip.termMonths} months, interest only; the renovation is paid in draws.`,
      columns: ["Rate", "Points", "Of cost", "Of ARV", "At purchase", "Credit from"],
      rows: tiers.map((tier) => ({ label: deals[tier], cells: [span(flip[tier].rate), span(flip[tier].points, ""), pct(flip[tier].maxLTC), pct(flip[tier].maxLTARV), pct(flip[tier].maxInitialLTV), String(flip[tier].minFico)] })),
    },
    {
      key: "bridge", title: "Bridge", href: "/programs/bridge",
      note: `By experience, as above. ${config.bridge.termMonths} months, interest only.`,
      columns: ["Rate", "Points", "Of value", "Credit from"],
      rows: tiers.map((tier) => ({ label: deals[tier], cells: [span(bridge[tier].rate), span(bridge[tier].points, ""), pct(bridge[tier].maxLTV), String(bridge[tier].minFico)] })),
    },
    {
      key: "ground_up", title: "New construction", href: "/programs/construction",
      note: `By ground-up builds completed; a first build needs ${config.groundUp.minFlipsIfNoBuilds} or more flips. ${config.groundUp.termMonths} months, interest only.`,
      columns: ["Rate", "Points", "Of total cost", "Of land", "Credit from"],
      rows: ([["none", "First build"], ["1to3", "1–3 builds"], ["4plus", "4+ builds"]] as const).map(([key, label]) => ({ label, cells: [span(build[key].rate), span(build[key].points, ""), pct(build[key].maxLTC), pct(build[key].maxLandLTV), String(build[key].minFico)] })),
    },
    {
      key: "dscr", title: "DSCR rental", href: "/programs/dscr",
      note: `Most of the value and the starting rate, by credit score and how far the rent covers the payment, taxes and insurance (DSCR). 30 years. Points ${span(dscr.points, "")}.`,
      columns: dscr.dscrBands.map((band) => `DSCR ${band.toFixed(2)}+`),
      rows: dscr.ficoBands.map((fico, row) => ({ label: `Credit ${fico}+`, cells: dscr.dscrBands.map((_band, col) => { const cell = dscr.grid[row]?.[col]; return cell ? `${pct(cell.maxLTV)} at ${rate(lowestRate + cell.rateAdd)}` : "Not offered"; }) })),
    },
  ];
}

/** What moves the numbers in the grid, each from the same pricing. */
export function gridAdjustments(config: PricingConfig): string[] {
  const a = config.adjusters;
  const shortTerm = shortTermOf(config);
  const best = [...repeatTiersOf(config)].sort((x, y) => y.rateCut - x.rateCut)[0];
  return [
    `Condos: ${pct(a.condoLeverageCut)} less leverage and ${a.condoRateAdd}% more. 2–4 units: ${pct(a.twoToFourUnitsLeverageCut)} less leverage.`,
    `Florida counties outside Miami-Dade, Broward and Palm Beach: ${pct(a.expansionCountyLeverageCut)} less leverage.`,
    `Foreign nationals: ${pct(a.foreignNationalLeverageCut)} less leverage and ${a.foreignNationalRateAdd}% more.`,
    `Loans under $${a.smallLoanThreshold.toLocaleString("en-US")}: ${a.smallLoanRateAdd}% more.`,
    `Short-term rentals (Airbnb, VRBO): ${pct(shortTerm.historyFactor)} of the last 12 months' payouts counted as rent (${pct(shortTerm.projectionFactor)} of a projection), ${pct(shortTerm.leverageCut)} less leverage and ${shortTerm.rateAdd}% more.`,
    `Each point you pay at closing takes ${ratePerPointOf(config, "fix_flip")}% off the rate on a flip, bridge or construction loan and ${ratePerPointOf(config, "dscr")}% on a rental, inside the ranges above.`,
    ...(best ? [`Repeat borrowers: up to ${best.rateCut}% off the rate${best.pointsCut ? ` and ${best.pointsCut} points off the fee` : ""}.`] : []),
  ];
}
