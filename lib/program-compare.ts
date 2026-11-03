// The site's "compare loan programs" table, worked out from the pricing the owner last published, so the advertised
// numbers can't drift from what quotes and loans actually use. "From" means the best tier: the most experienced borrower.
import type { PricingConfig } from "./pricing-config";

export type ProgramRow = { key: string; name: string; bestFor: string; rateFrom: number; pointsFrom: number; financing: string; term: string; minFico: number; href: string };

const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
const low = (ranges: [number, number][]) => Math.min(...ranges.map((range) => range[0]));

export function comparePrograms(config: PricingConfig): ProgramRow[] {
  const flip = Object.values(config.fixFlip.tiers);
  const bridge = Object.values(config.bridge.tiers);
  const build = Object.values(config.groundUp.tiers);
  const dscrMax = Math.max(...config.dscr.grid.flat().map((cell) => cell?.maxLTV ?? 0));
  return [
    { key: "fix_flip", name: "Fix & flip", bestFor: "Buy, renovate and sell", rateFrom: low(flip.map((t) => t.rate)), pointsFrom: low(flip.map((t) => t.points)), financing: `Up to ${pct(Math.max(...flip.map((t) => t.maxLTC)))} of cost and ${pct(Math.max(...flip.map((t) => t.maxLTARV)))} of ARV; rehab paid in draws`, term: `${config.fixFlip.termMonths} months, interest-only`, minFico: Math.min(...flip.map((t) => t.minFico)), href: "/programs/fix-flip" },
    { key: "bridge", name: "Bridge", bestFor: "Buy or refinance with light or no work", rateFrom: low(bridge.map((t) => t.rate)), pointsFrom: low(bridge.map((t) => t.points)), financing: `Up to ${pct(Math.max(...bridge.map((t) => t.maxLTV)))} of value`, term: `${config.bridge.termMonths} months, interest-only`, minFico: Math.min(...bridge.map((t) => t.minFico)), href: "/programs/bridge" },
    { key: "ground_up", name: "New construction", bestFor: "Land plus a ground-up build", rateFrom: low(build.map((t) => t.rate)), pointsFrom: low(build.map((t) => t.points)), financing: `Up to ${pct(Math.max(...build.map((t) => t.maxLTC)))} of total cost and ${pct(Math.max(...build.map((t) => t.maxLandLTV)))} of land value`, term: `${config.groundUp.termMonths} months, interest-only`, minFico: Math.min(...build.map((t) => t.minFico)), href: "/programs/construction" },
    { key: "dscr", name: "DSCR rental", bestFor: "Long-term rentals, qualified on the rent", rateFrom: config.dscr.baseRate[0], pointsFrom: config.dscr.points[0], financing: `Up to ${pct(dscrMax)} of value`, term: "30 years", minFico: config.dscr.ficoBands[config.dscr.ficoBands.length - 1], href: "/programs/dscr" },
  ];
}
