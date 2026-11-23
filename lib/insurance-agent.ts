// The borrower's insurance agent's link (docs/feature-ideas-2026-11-22.md, rank 9). Insurance is the hardest part of a
// Florida closing, and the binder usually goes agent → borrower → LendHous and comes back wrong. So, like the title
// company's link, the agent opens a page for the one loan, sees the exact mortgagee clause and what cover the loan needs,
// enters what the declarations page says and uploads it. The app checks the named insured, the mortgagee clause, wind and
// flood cover, the coverage and the dates as they type, and again on the server; the team still opens the file and
// accepts it. Pure: the agent's page, the upload route and the reducer all ask the same questions.
import type { Deal, InsuranceRenewal, PolicyKind } from "./mockData";
import { evaluate } from "./engine";
import { coverNeeds, INSURED, kindsFor, policiesOf, POLICY_KINDS, type CoverNeed } from "./insurance";
import { citizensFlood } from "./florida-insurance";
import { maturityOf, SERVICED } from "./servicing";

export const AGENT_LINK_DAYS = 30;
/** PLACEHOLDER until GT and the attorney set them: how long a policy has to run (or to maturity, if sooner), and NFIP's building limit. */
export const AGENT_RULES = { minMonths: 12, nfipBuildingLimit: 250_000 };
/** PLACEHOLDER until GT and the attorney give the exact wording: the lending entity's legal name and its mailing address. */
export const MORTGAGEE_CLAUSE = { name: "LendHous", tail: "ISAOA/ATIMA", address: "[Mailing address to be confirmed]" };

export const clauseFor = (loanNumber: string) => `${MORTGAGEE_CLAUSE.name}, ${MORTGAGEE_CLAUSE.tail}\n${MORTGAGEE_CLAUSE.address}\nLoan ${loanNumber}`;

export type PolicyCheck = { key: "insured" | "clause" | "starts" | "ends" | "coverage" | "wind" | "flood"; ok: boolean; soft?: boolean; text: string };

export type AgentPolicyInput = {
  kind: PolicyKind; carrier: string; policy: string; effectiveOn: string; expiresOn: string;
  coverage?: number; windIncluded?: boolean; program?: "nfip" | "private";
  /** As the declarations page prints them. */
  namedInsured: string; clause: string;
};

/** One kind of cover and where it stands: on file with LendHous, sent and waiting for the team, still needed, not needed, or (flood) waiting on the zone. */
export type AgentNeed = { key: CoverNeed["key"]; label: string; note: string; state: "on_file" | "sent" | "needed" | "not_needed" | "checking" };

/** What the agent sees: only what insuring this one property for this loan needs. No borrower's personal details. */
export interface AgentView {
  loanNumber: string; insured: string; address: string; noteAmount: number; closingDate: string; maturity: string; funded: boolean;
  clause: string; kinds: PolicyKind[]; needs: AgentNeed[];
  /** The policies LendHous has, by kind and end, so a renewal can be checked for a gap. */
  onFile: { kind: PolicyKind; expiresOn: string }[];
  sent: { id: string; kind: PolicyKind; carrier: string; policy: string; expiresOn: string; at: string; status: InsuranceRenewal["status"]; note: string; checks: PolicyCheck[] }[];
  sentBy: string;
}

const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const money = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
const addMonths = (day: string, months: number) => { const at = new Date(`${day}T12:00:00Z`); at.setUTCMonth(at.getUTCMonth() + months); return at.toISOString().slice(0, 10); };
/** Letters and digits only, lower case, so "LendHous, ISAOA / ATIMA" and "lendhous isaoa atima" read the same. */
const plain = (text: string) => text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const COMPANY_WORDS = /\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|the)\b/g;
const company = (name: string) => plain(name).replace(COMPANY_WORDS, " ").replace(/\s+/g, " ").trim();
const insuresBuilding = (kind: PolicyKind) => kind === "hazard" || kind === "builders_risk";

/** Whether the link can be used today: like the title company's, it ends with the loan. */
export function agentLinkState(deal: Pick<Deal, "insuranceLink" | "status"> | undefined, now = new Date()): "open" | "expired" | "off" | "closed" {
  if (!deal?.insuranceLink) return "off";
  if (!INSURED.includes(deal.status)) return "closed";
  if (deal.insuranceLink.status === "off") return "off";
  return Date.parse(deal.insuranceLink.expiresAt) < now.getTime() ? "expired" : "open";
}

/** The agent's copy of the loan. */
export function agentView(deal: Deal): AgentView {
  const policies = policiesOf(deal);
  const renewals = deal.insurance?.renewals ?? [];
  const waiting = renewals.filter((item) => item.status === "submitted");
  const sentKinds = new Set(waiting.map((item) => item.kind));
  const covers = (key: CoverNeed["key"], kind: PolicyKind) => (key === "property" ? insuresBuilding(kind) : key === "wind" ? kind === "windstorm" || (insuresBuilding(kind) && Boolean(waiting.find((item) => item.kind === kind)?.windIncluded)) : kind === "flood");
  const needs = coverNeeds(deal).map((need): AgentNeed => {
    const unknownZone = need.key === "flood" && !deal.insurance?.flood;
    const required = need.key !== "flood" || Boolean(deal.insurance?.flood?.sfha) || Boolean(citizensFlood(deal, policies)?.now);
    const state = need.met ? (need.key === "flood" && !policies.some((item) => item.kind === "flood") ? "not_needed" : "on_file") : [...sentKinds].some((kind) => covers(need.key, kind)) ? "sent" : unknownZone ? "checking" : required ? "needed" : "not_needed";
    return { key: need.key, label: need.label, note: need.key === "flood" && !deal.insurance?.flood ? "LendHous is confirming the flood zone. Send a flood policy if you've quoted one." : need.note, state };
  });
  return {
    loanNumber: deal.loanNumber, insured: deal.entityName, address: `${deal.address}, ${deal.city} ${deal.zip}`, noteAmount: evaluate(deal.app).noteAmount,
    closingDate: deal.closingDate, maturity: maturityOf(deal), funded: SERVICED.includes(deal.status), clause: clauseFor(deal.loanNumber), kinds: kindsFor(deal), needs,
    onFile: policies.map((item) => ({ kind: item.kind, expiresOn: item.expiresOn })),
    sent: renewals.filter((item) => item.via === "agent").map((item) => ({ id: item.id, kind: item.kind, carrier: item.carrier, policy: item.policy, expiresOn: item.expiresOn, at: item.at, status: item.status, note: item.status === "returned" ? item.decided?.note ?? "" : "", checks: item.checks ?? [] })).reverse(),
    sentBy: deal.insuranceLink?.sentBy ?? "LendHous",
  };
}

/** Why the policy can't be sent as entered, or null: what the form needs before the checks mean anything. */
export function agentPolicyProblem(view: Pick<AgentView, "kinds">, input: AgentPolicyInput): string | null {
  if (!view.kinds.includes(input.kind)) return "Choose which policy it is.";
  if (!input.carrier.trim()) return "Add the insurance company.";
  if (!input.policy.trim()) return "Add the policy or binder number.";
  if ([input.carrier, input.policy, input.namedInsured].some((value) => value.length > 160)) return "Keep each detail under 160 characters.";
  if (!isDay(input.effectiveOn)) return "Enter the day the policy starts.";
  if (!isDay(input.expiresOn) || input.expiresOn <= input.effectiveOn) return "Enter the day it ends, after it starts.";
  if (input.coverage === undefined || !Number.isFinite(input.coverage) || input.coverage <= 0 || input.coverage > 100_000_000) return insuresBuilding(input.kind) ? "Enter the dwelling (building) coverage." : "Enter the coverage.";
  if (input.kind === "flood" && !input.program) return "Say whether it's an NFIP or a private flood policy.";
  if (!input.namedInsured.trim()) return "Enter the named insured as the policy shows it.";
  if (!input.clause.trim()) return "Copy the mortgagee clause as the policy prints it.";
  if (input.clause.length > 600) return "Keep the mortgagee clause under 600 characters.";
  return null;
}

/**
 * How the policy checks against the loan. Each line passes or says what's wrong; a soft one is worth a look but may be
 * right (coverage below the loan on a building that costs less to rebuild). The agent sees them before sending.
 */
export function agentChecks(view: AgentView, input: AgentPolicyInput, today: string): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  const insured = company(input.namedInsured);
  const entity = company(view.insured);
  checks.push(insured && entity && (insured.includes(entity) || entity.includes(insured)) ? { key: "insured", ok: true, text: `Names ${view.insured} as the insured.` } : { key: "insured", ok: false, text: `The named insured should be ${view.insured}, the company borrowing.` });

  const clause = plain(input.clause);
  const missing = [
    !clause.includes(plain(MORTGAGEE_CLAUSE.name)) && MORTGAGEE_CLAUSE.name,
    !(clause.includes("isaoa") || clause.includes("its successors and or assigns") || clause.includes("its successors and assigns")) && "ISAOA (its successors and/or assigns)",
    !(clause.includes("atima") || clause.includes("as their interests may appear")) && "ATIMA (as their interests may appear)",
    !clause.includes(plain(view.loanNumber)) && `the loan number, ${view.loanNumber}`,
  ].filter((part): part is string => Boolean(part));
  checks.push(missing.length ? { key: "clause", ok: false, text: `The mortgagee clause is missing ${missing.join(", ")}.` } : { key: "clause", ok: true, text: "The mortgagee clause names LendHous, ISAOA/ATIMA, with the loan number." });

  // Before closing it has to be in force at closing; on a funded loan it has to start by the day the current one ends.
  const current = view.onFile.find((item) => item.kind === input.kind);
  const startBy = view.funded ? (current && current.expiresOn >= today ? current.expiresOn : today) : view.closingDate;
  if (isDay(input.effectiveOn)) checks.push(input.effectiveOn <= startBy ? { key: "starts", ok: true, text: `Starts ${longDay(input.effectiveOn)}, ${view.funded ? "with no gap in cover" : "by closing"}.` } : { key: "starts", ok: false, text: view.funded ? `It starts ${longDay(input.effectiveOn)}, after ${current && current.expiresOn >= today ? `the current policy ends on ${longDay(startBy)}` : "today"}: the property would be uninsured in between.` : `It starts ${longDay(input.effectiveOn)}, after closing on ${longDay(view.closingDate)}. It has to be in force at closing.` });
  if (isDay(input.effectiveOn) && isDay(input.expiresOn)) {
    const needed = [addMonths(input.effectiveOn, AGENT_RULES.minMonths), view.maturity].sort()[0];
    checks.push(input.expiresOn >= needed ? { key: "ends", ok: true, text: `Runs to ${longDay(input.expiresOn)}.` } : { key: "ends", ok: false, text: `It ends ${longDay(input.expiresOn)}. It needs to run to at least ${longDay(needed)}: ${AGENT_RULES.minMonths} months, or to the loan's maturity if that's sooner.` });
  }

  if (input.coverage !== undefined && Number.isFinite(input.coverage) && input.coverage > 0) {
    if (insuresBuilding(input.kind)) checks.push(input.coverage >= view.noteAmount ? { key: "coverage", ok: true, text: `Dwelling coverage of ${money(input.coverage)} covers the ${money(view.noteAmount)} loan.` } : { key: "coverage", ok: false, soft: true, text: `Dwelling coverage of ${money(input.coverage)} is less than the ${money(view.noteAmount)} loan. That's fine only if it's the full cost to rebuild.` });
    if (input.kind === "flood") {
      const floor = input.program === "nfip" ? Math.min(view.noteAmount, AGENT_RULES.nfipBuildingLimit) : view.noteAmount;
      checks.push(input.coverage >= floor ? { key: "coverage", ok: true, text: `Flood coverage of ${money(input.coverage)}${input.program === "nfip" && floor < view.noteAmount ? `, the NFIP's building limit` : ""}.` } : { key: "coverage", ok: false, soft: true, text: `Flood coverage of ${money(input.coverage)} is less than ${input.program === "nfip" ? `the lower of the loan and the NFIP's ${money(AGENT_RULES.nfipBuildingLimit)} limit` : "the loan"} (${money(floor)}). Fine only if it's the full cost to rebuild.` });
    }
  }

  // Florida's risks are wind and water. A property policy that leaves out wind needs a windstorm policy beside it.
  if (insuresBuilding(input.kind)) {
    const separate = view.onFile.some((item) => item.kind === "windstorm") || view.sent.some((item) => item.kind === "windstorm" && item.status === "submitted");
    checks.push(input.windIncluded ? { key: "wind", ok: true, text: "Covers windstorm and hurricane." } : separate ? { key: "wind", ok: true, text: "Leaves out wind; the separate windstorm policy covers it." } : { key: "wind", ok: false, text: "Leaves out wind. Send the windstorm policy too (often Citizens on the coast)." });
  }
  const flood = view.needs.find((need) => need.key === "flood");
  if (input.kind !== "flood" && flood?.state === "needed") checks.push({ key: "flood", ok: false, soft: true, text: `Flood cover is needed too: ${flood.note.charAt(0).toLowerCase()}${flood.note.slice(1)}` });
  return checks;
}

/** The checks that failed outright: what the team will most likely send back. */
export const failedChecks = (checks: PolicyCheck[]) => checks.filter((check) => !check.ok && !check.soft);
export const kindName = (kind: PolicyKind) => POLICY_KINDS[kind];
