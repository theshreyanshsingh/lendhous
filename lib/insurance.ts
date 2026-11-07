// The property's insurance on every loan, from the accepted term sheet until it's paid off. Florida's risks are wind and
// water, so each loan needs a hazard policy (or builder's risk on a rehab or build), windstorm cover, and flood cover
// when the property is in a special flood hazard area (FEMA zones A and V), each naming LendHous as mortgagee. A loan
// can't fund without them; a lapsed policy holds draws; and the nightly check warns before any policy ends. Pure, so the
// reducer, the access rules and the screens all ask the same questions.
import { evaluate } from "./engine";
import type { Deal, InsuranceFile, InsurancePolicy, InsuranceRenewal, LienFile, PolicyKind } from "./mockData";
import { daysBetween, SERVICED } from "./servicing";

export const POLICY_KINDS: Record<PolicyKind, string> = { hazard: "Hazard (property)", windstorm: "Windstorm", flood: "Flood", builders_risk: "Builder's risk" };
/** PLACEHOLDER until GT and the attorney set them: how long before a policy ends people hear, and whether wind cover is required. */
export const INSURANCE_RULES = { noticeDays: 30, windRequired: true };
/** From the accepted term sheet, while the loan is open: when the team keeps the insurance file. */
export const INSURED: string[] = ["term_sheet_accepted", "conditions", "clear_to_close", "closing", ...SERVICED];

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);
export const policyWord = (kind: PolicyKind) => POLICY_KINDS[kind].toLowerCase();

type Insured = Pick<Deal, "insurance" | "lienFile">;

/** The policies on file: the loan's own, or the one policy the lien file kept before every loan had an insurance file. */
export function policiesOf(deal: Insured): InsurancePolicy[] {
  if (deal.insurance) return deal.insurance.policies;
  const legacy = deal.lienFile?.insurance;
  return legacy ? [{ ...legacy }] : [];
}
/** The loan's insurance file as it stands, with a lien file's old policy moved in. */
export const insuranceFileOf = (deal: Insured): InsuranceFile => deal.insurance ?? { policies: policiesOf(deal) };
/** The loan with this insurance file, and the lien file's old copy of the policy dropped. */
export function withInsurance<T extends Insured>(deal: T, file: InsuranceFile): T {
  if (!deal.lienFile?.insurance) return { ...deal, insurance: file };
  const { insurance: _moved, ...lienFile } = deal.lienFile;
  return { ...deal, insurance: file, lienFile: lienFile as LienFile };
}
/** The file with this policy as the one of its kind. */
export const putPolicy = (file: InsuranceFile, policy: InsurancePolicy): InsuranceFile => ({ ...file, policies: [...file.policies.filter((item) => item.kind !== policy.kind), policy] });

const rehab = (deal: Pick<Deal, "app">) => deal.app.product === "fix_flip" || deal.app.product === "ground_up";
/** The kinds a borrower or the team can put on file for this loan: builder's risk only on a rehab or build. */
export const kindsFor = (deal: Pick<Deal, "app">): PolicyKind[] => (rehab(deal) ? ["hazard", "builders_risk", "windstorm", "flood"] : ["hazard", "windstorm", "flood"]);
/** The policies that insure the building itself. */
const propertyCover = (deal: Insured & Pick<Deal, "app">) => policiesOf(deal).filter((item) => item.kind === "hazard" || (item.kind === "builders_risk" && rehab(deal)));

export type CoverNeed = { key: "property" | "wind" | "flood"; label: string; met: boolean; note: string };

/** What this loan needs covered, and whether it is. */
export function coverNeeds(deal: Insured & Pick<Deal, "app">): CoverNeed[] {
  const policies = policiesOf(deal);
  const property = propertyCover(deal);
  const needs: CoverNeed[] = [{ key: "property", label: rehab(deal) ? "Hazard or builder's risk" : "Hazard (property)", met: property.length > 0, note: "The building, for at least the loan amount or its replacement cost." }];
  if (INSURANCE_RULES.windRequired) {
    const separate = policies.some((item) => item.kind === "windstorm");
    needs.push({ key: "wind", label: "Windstorm", met: separate || property.some((item) => item.windIncluded), note: separate ? "A separate windstorm policy." : property.some((item) => item.windIncluded) ? "Included in the property policy." : "Included in the property policy, or a separate wind policy (often Citizens in coastal counties)." });
  }
  const flood = deal.insurance?.flood;
  const floodPolicy = policies.some((item) => item.kind === "flood");
  needs.push({ key: "flood", label: "Flood", met: flood ? !flood.sfha || floodPolicy : false, note: !flood ? "Record whether the property is in a special flood hazard area first." : flood.sfha ? `${flood.zone ? `Zone ${flood.zone} is` : "It's in"} a special flood hazard area, so flood insurance is required.` : `${flood.zone ? `Zone ${flood.zone}: n` : "N"}ot in a special flood hazard area, so it isn't required.` });
  return needs;
}

/** The dwelling coverage is less than the loan: worth a look, not a hold (land can be most of the value). */
export function coverageShort(deal: Insured & Pick<Deal, "app">) {
  const loan = evaluate(deal.app).noteAmount;
  return propertyCover(deal).filter((item) => item.coverage !== undefined && item.coverage < loan).map((item) => `The ${policyWord(item.kind)} policy covers $${item.coverage!.toLocaleString("en-US")}, less than the $${Math.round(loan).toLocaleString("en-US")} loan. Check it covers the replacement cost.`);
}

/** Everything about the insurance that stops a loan funding today. Empty when it can fund. */
export function insuranceGaps(deal: Insured & Pick<Deal, "app">, today: string) {
  const gaps: string[] = [];
  for (const need of coverNeeds(deal)) {
    if (need.met) continue;
    gaps.push(need.key === "flood" && !deal.insurance?.flood ? "The flood zone isn't recorded (Closing tab)" : `No ${need.label.toLowerCase()} policy on file (Closing tab)`);
  }
  for (const policy of policiesOf(deal)) {
    if (policy.expiresOn < today) gaps.push(`The ${policyWord(policy.kind)} policy lapsed on ${longDay(policy.expiresOn)}`);
    else if (policy.mortgagee !== true) gaps.push(`The ${policyWord(policy.kind)} policy isn't confirmed to name LendHous as mortgagee`);
  }
  return gaps;
}

/** Why the insurance stops draws today, or null: no policy on the building, or any policy lapsed. */
export function insuranceHold(deal: Insured & Pick<Deal, "app">, today: string) {
  if (!propertyCover(deal).length) return "No builder's risk or hazard policy is on file.";
  const lapsed = lapsedPolicies(deal, today)[0];
  return lapsed ? `The ${policyWord(lapsed.kind)} policy lapsed on ${longDay(lapsed.expiresOn)}.` : null;
}

export const lapsedPolicies = (deal: Insured, today: string) => policiesOf(deal).filter((item) => item.expiresOn < today).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
/** The policy that ends first, and in how many days. */
export function nextToEnd(deal: Insured, today: string) {
  const first = [...policiesOf(deal)].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
  return first ? { policy: first, days: daysBetween(today, first.expiresOn) } : null;
}

/** A funded loan whose insurance has lapsed: the team chases it at once. */
export const insuranceLapsed = (deal: Insured & Pick<Deal, "status">, today: string) => SERVICED.includes(deal.status) && lapsedPolicies(deal, today).length > 0;
export const openRenewals = (deal: Pick<Deal, "insurance">): InsuranceRenewal[] => (deal.insurance?.renewals ?? []).filter((item) => item.status === "submitted");

export type PolicyInput = { kind: PolicyKind; carrier: string; policy: string; expiresOn: string; coverage?: number; windIncluded?: boolean; mortgagee?: boolean };

/** Why a policy can't be saved as entered, or null. */
export function policyProblem(deal: Pick<Deal, "app">, input: PolicyInput): string | null {
  if (!kindsFor(deal).includes(input.kind)) return "Choose which policy it is.";
  if (!input.carrier.trim()) return "Add the insurance company.";
  if (!isDay(input.expiresOn)) return "Enter the day the policy ends.";
  if (input.coverage !== undefined && (!Number.isFinite(input.coverage) || input.coverage < 0)) return "Enter the coverage in dollars, or leave it blank.";
  return null;
}

/** Why a renewal can't be sent, or null. It has to be a policy this loan carries, ending after today. */
export function renewalProblem(deal: Pick<Deal, "app" | "status">, input: { kind: PolicyKind; carrier: string; expiresOn: string }, today: string): string | null {
  if (!SERVICED.includes(deal.status)) return "Before the loan funds, the insurance goes in with its conditions.";
  if (!kindsFor(deal).includes(input.kind)) return "Choose which policy it is.";
  if (!input.carrier.trim()) return "Add the insurance company.";
  if (!isDay(input.expiresOn) || input.expiresOn <= today) return "Enter the day the new policy ends, after today.";
  return null;
}

/** Policies to warn about tonight, on funded loans: ending within the notice period and not warned yet, or lapsed and not told yet. */
export function insuranceChecks(deals: Deal[], today: string) {
  const remind: { dealId: string; kind: PolicyKind }[] = [];
  const lapsed: { dealId: string; kind: PolicyKind }[] = [];
  for (const deal of deals) {
    if (!SERVICED.includes(deal.status)) continue;
    for (const policy of policiesOf(deal)) {
      if (policy.expiresOn < today) { if (!policy.lapseNoticeOn) lapsed.push({ dealId: deal.id, kind: policy.kind }); }
      else if (!policy.remindedOn && daysBetween(today, policy.expiresOn) <= INSURANCE_RULES.noticeDays) remind.push({ dealId: deal.id, kind: policy.kind });
    }
  }
  return { remind, lapsed };
}
