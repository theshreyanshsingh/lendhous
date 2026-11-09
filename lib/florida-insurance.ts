// Florida's insurance calendar (docs/competitor-gaps-2026-11-09.md, rank 1). Three dated rules a Florida lender has to
// follow on its own book, since no vendor does it for it:
// - the federal flood program (NFIP) is authorized only through a date Congress sets, and in a lapse FEMA can't sell or
//   renew a policy (FEMA's reauthorization page), so a closing or renewal that relies on one needs a private flood policy
//   (Fla. Stat. 627.715) instead;
// - Citizens makes flood insurance a condition of its personal policies with wind cover, phased in by the dwelling's
//   coverage and reaching every such policy on January 1, 2027, in any flood zone (Fla. Stat. 627.351(6)(aa)); a condo
//   unit owner's form and a policy without wind are exempt;
// - Citizens may raise a non-primary home's premium up to 50% a year (its 2026 rate bulletin), which a rental's coverage
//   has to survive; and condo associations lose new Citizens cover from 2027 when a surplus-lines insurer offers comparable
//   cover for no more than 15% more (ch. 2026-150).
// Pure, given the NFIP date an owner keeps in Settings. insurance.ts asks these for what a loan needs; the screens show the rest.
import { dscr, evaluate, qualifyingRent } from "./engine";
import type { Deal, InsurancePolicy } from "./mockData";
import { pricingFor } from "./pricing-versions";
import { addMonths, daysBetween } from "./servicing";

/** PLACEHOLDER until Congress acts: the last day the NFIP is authorized through. An owner updates it in Settings. */
let nfip = { through: "2026-12-11" };
export const nfipThrough = () => nfip.through;
export const setNfipThrough = (day: string) => { if (/^\d{4}-\d{2}-\d{2}$/.test(day)) nfip = { through: day }; };

export const FLORIDA_INSURANCE = {
  /** Citizens' flood requirement, by the day a policy's term starts: dwellings covered for at least this much (627.351(6)(aa)). */
  citizensFlood: [{ from: "2024-01-01", min: 600_000 }, { from: "2025-01-01", min: 500_000 }, { from: "2026-01-01", min: 400_000 }, { from: "2027-01-01", min: 0 }],
  /** The most Citizens may raise a non-primary home's premium in a year (2026 rate bulletin). */
  nonPrimaryRise: 0.5,
  /** From when condo associations and apartments can be moved from Citizens to surplus lines (ch. 2026-150). */
  surplusLinesFrom: "2027-01-01",
  /** How long before the NFIP's date the team is warned. */
  nfipNoticeDays: 30,
};

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/** Written by Citizens Property Insurance: as marked, or by the carrier's name. */
export const isCitizens = (policy: Pick<InsurancePolicy, "carrier" | "citizens">) => policy.citizens ?? /citizens property insurance|^\s*citizens\b/i.test(policy.carrier);

/** The day a policy's term began. Florida property policies run a year. */
const termStart = (policy: Pick<InsurancePolicy, "expiresOn">) => addMonths(policy.expiresOn, -12);

/** The smallest dwelling coverage Citizens requires flood on, for a term starting that day; null before it applied. */
export function citizensFloodMin(day: string) {
  let min: number | null = null;
  for (const step of FLORIDA_INSURANCE.citizensFlood) if (day >= step.from) min = step.min;
  return min;
}

type Insured = Pick<Deal, "app">;

/**
 * The Citizens policy on the loan that carries wind for the home, which is what the flood requirement follows: a property
 * policy that includes wind, or a Citizens wind policy. A condo unit's own policy (an HO-6 form) is exempt.
 */
export function citizensWindPolicy(deal: Insured, policies: InsurancePolicy[]) {
  if (deal.app.propertyType === "condo") return undefined;
  return policies.find((item) => isCitizens(item) && (item.kind === "windstorm" || (item.kind === "hazard" && item.windIncluded)));
}

/**
 * Whether Citizens requires flood with this loan's policy for the term it's in, and whether it will at renewal. Coverage
 * that wasn't entered can't be told apart until every policy needs it (2027).
 */
export function citizensFlood(deal: Insured, policies: InsurancePolicy[]) {
  const policy = citizensWindPolicy(deal, policies);
  if (!policy) return null;
  const needs = (min: number | null) => min !== null && (min === 0 || (policy.coverage ?? 0) >= min);
  return { policy, now: needs(citizensFloodMin(termStart(policy))), atRenewal: needs(citizensFloodMin(policy.expiresOn)), unknownCoverage: policy.coverage === undefined };
}

/** Whether the NFIP has lapsed as of a day, and whether a lapse is near. */
export function nfipStatus(today: string) {
  const through = nfipThrough();
  return { through, lapsed: today > through, soon: today <= through && daysBetween(today, through) <= FLORIDA_INSURANCE.nfipNoticeDays };
}

/** A flood policy from the federal program, or not said: either way it can't be bought or renewed in a lapse. */
const reliesOnNfip = (policy: InsurancePolicy) => policy.kind === "flood" && policy.program !== "private";

/**
 * A flood policy that can't be in force because it would have started while the NFIP was lapsed: FEMA doesn't sell or
 * renew policies then. It's held until a private policy takes its place.
 */
export function nfipPolicyProblem(policies: InsurancePolicy[], today: string) {
  const { through, lapsed } = nfipStatus(today);
  if (!lapsed) return null;
  const policy = policies.find((item) => reliesOnNfip(item) && item.program === "nfip" && termStart(item) > through);
  return policy ? `The NFIP's authorization ended ${longDay(through)}, so FEMA can't have issued or renewed a flood policy starting ${longDay(termStart(policy))}. Get a private flood policy (Fla. Stat. 627.715).` : null;
}

/** The dwelling's rent coverage with the insurance at a different premium: the same sum the engine sizes the loan on. */
export function coverageWithInsurance(deal: Insured, insuranceAnnual: number) {
  const e = evaluate(deal.app);
  return dscr({ monthlyRent: qualifyingRent(deal.app, pricingFor(deal.app.pricingVersion)), payment: e.monthlyPayment, taxesAnnual: deal.app.taxesAnnual ?? 0, insuranceAnnual, hoaMonthly: deal.app.hoaMonthly, floodAnnual: deal.app.floodAnnual }).dscr;
}

export type InsuranceWarning = { key: string; text: string; tone: "warn" | "info" };

/**
 * What's coming for this loan's insurance, short of what it needs today (insurance.ts holds those): Citizens' flood
 * requirement at the next renewal, the NFIP's date, a rental's coverage after the biggest Citizens increase, and a condo
 * association moving to surplus lines.
 */
export function insuranceWarnings(deal: Insured & Pick<Deal, "insurance">, policies: InsurancePolicy[], today: string, minDscr: number): InsuranceWarning[] {
  const warnings: InsuranceWarning[] = [];
  const hasFlood = policies.some((item) => item.kind === "flood");
  const citizens = citizensFlood(deal, policies);
  if (citizens && !hasFlood && !citizens.now) {
    if (citizens.atRenewal) warnings.push({ key: "citizens-renewal", tone: "warn", text: `Citizens will require flood insurance, in any flood zone, when this policy renews on ${longDay(citizens.policy.expiresOn)} (Fla. Stat. 627.351(6)(aa)). Ask the borrower for a flood quote now.` });
    else if (citizens.unknownCoverage) warnings.push({ key: "citizens-coverage", tone: "warn", text: `Enter the dwelling coverage on the Citizens policy: Citizens requires flood insurance on dwellings covered for ${dollars(citizensFloodMin(termStart(citizens.policy)) ?? 0)} or more, and on every policy from January 1, 2027.` });
  }
  const { through, lapsed, soon } = nfipStatus(today);
  const nfipFlood = policies.filter((item) => reliesOnNfip(item));
  if (lapsed && nfipFlood.some((item) => item.expiresOn >= through)) warnings.push({ key: "nfip-lapsed", tone: "warn", text: `The NFIP's authorization ended ${longDay(through)}: FEMA can't renew a flood policy until Congress acts. Line up a private flood policy before the NFIP one ends.` });
  else if (soon && (nfipFlood.length || (deal.insurance?.flood?.sfha && !hasFlood))) warnings.push({ key: "nfip-soon", tone: "warn", text: `The NFIP is authorized only through ${longDay(through)}. A flood policy from it has to be bought or renewed by then; after that, until Congress acts, only a private one can be.` });
  if (nfipFlood.some((item) => item.program === undefined)) warnings.push({ key: "nfip-unknown", tone: "info", text: "Say whether the flood policy is from the NFIP or a private insurer: only a private one can be bought or renewed if the NFIP lapses." });
  if (deal.app.product === "dscr" && policies.some(isCitizens) && (deal.app.insuranceAnnual ?? 0) > 0) {
    const now = coverageWithInsurance(deal, deal.app.insuranceAnnual!);
    const stressed = coverageWithInsurance(deal, deal.app.insuranceAnnual! * (1 + FLORIDA_INSURANCE.nonPrimaryRise));
    warnings.push({ key: "citizens-rise", tone: stressed < minDscr ? "warn" : "info", text: `A rental is a non-primary home, so Citizens may raise its premium up to ${FLORIDA_INSURANCE.nonPrimaryRise * 100}% at renewal. If the ${dollars(deal.app.insuranceAnnual!)} a year of insurance rose that much, rent coverage would go from ${now.toFixed(2)} to ${stressed.toFixed(2)} (at least ${minDscr.toFixed(2)} needed).` });
  }
  const association = deal.insurance?.association;
  if (deal.app.propertyType === "condo") {
    if (!association) warnings.push({ key: "association", tone: "info", text: "Record who insures the condo association's building: its premium is in the dues." });
    else if (association.citizens) warnings.push({ key: "surplus-lines", tone: "warn", text: `The association's building is insured by Citizens. From ${longDay(FLORIDA_INSURANCE.surplusLinesFrom)}, Citizens can't take a condo association on new cover when a surplus-lines insurer offers comparable cover for no more than 15% more (ch. 2026-150), so the association's premium, and the dues, may rise.` });
  }
  return warnings;
}

/** A line for the staff banner while the NFIP's date is near or past, with how many loans rely on it. */
export function nfipBanner(book: Pick<Deal, "insurance" | "status">[], today: string) {
  const { through, lapsed, soon } = nfipStatus(today);
  if (!lapsed && !soon) return null;
  const deals = book.filter((deal) => !["paid_off", "reo", "declined", "withdrawn"].includes(deal.status));
  const relying = deals.filter((deal) => (deal.insurance?.policies ?? []).some(reliesOnNfip)).length;
  const zones = deals.filter((deal) => deal.insurance?.flood?.sfha).length;
  return lapsed
    ? `The NFIP's authorization ended ${longDay(through)}: FEMA can't sell or renew flood policies until Congress acts. ${relying} loan${relying === 1 ? "" : "s"} carry an NFIP policy, and ${zones} ${zones === 1 ? "is" : "are"} in a special flood hazard area; closings there need a private flood policy.`
    : `The NFIP is authorized only through ${longDay(through)}, ${daysBetween(today, through)} day${daysBetween(today, through) === 1 ? "" : "s"} away. Bind or renew NFIP flood policies before then; after it, until Congress acts, only private flood can be bought.`;
}
