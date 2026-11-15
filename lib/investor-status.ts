// Each partner's and buyer's investor type (docs/competitor-gaps-2026-11-09.md, rank 5). Under Florida law an accredited
// investor counts as an institutional investor, and selling a mortgage loan (or a share of one) to a noninstitutional
// investor is licensed activity (Fla. Stat. 494.001). LendHous's partners and buyers can be individuals, so before a
// teaser goes out, a bid or offer is taken, or a share moves, the firm's status has to be on file and current. The firm
// certifies it from its own account, or the team records it, verified or on the firm's word. Which statuses gate what
// is the attorney's call: the rules below are PLACEHOLDER until then. Pure, so the server and every screen agree.
import type { InvestorBasis, InvestorChecks, InvestorEntity, InvestorStatus } from "./mockData";
import { addDays, addMonths } from "./servicing";

export const BASIS: Record<InvestorBasis, string> = {
  accredited_investor: "An accredited investor (SEC Rule 501(a))",
  licensed_lender: "A mortgage lender licensed under Florida's Chapter 494",
  depository_institution: "A bank, savings association or credit union",
  reit: "A real estate investment trust",
  insurance_company: "An insurance company",
  real_estate_company: "A real estate company",
  none: "None of these",
};
export const ENTITY: Record<InvestorEntity, string> = { individual: "A person", llc: "An LLC", corporation: "A corporation", partnership: "A partnership", trust: "A trust", fund: "A fund", other: "Another kind of entity" };
/** Which of Rule 501(a)'s tests an accredited investor meets. */
export const ACCREDITED_HOW: Record<string, string> = {
  income: "Income over $200,000 ($300,000 with a spouse) in each of the last two years",
  net_worth: "Net worth over $1 million, not counting the main home",
  license: "Holds a Series 7, 65 or 82 license",
  entity_assets: "An entity with over $5 million in assets, not formed for this investment",
  all_owners: "An entity whose owners are all accredited investors",
  institution: "A bank, broker-dealer, registered adviser or other institution the rule names",
};
/**
 * PLACEHOLDER until the attorney sets them: how long a status lasts before the firm certifies again, how early to warn,
 * and whether the firm's own word is enough (verification letters matter for a Rule 506(c) offering, not here).
 */
export const INVESTOR_RULES = { months: 12, warnDays: 30, selfCertifiedCounts: true };

export const defaultExpiry = (on: string) => addMonths(on, INVESTOR_RULES.months);

export type StatusState = "missing" | "current" | "expiring" | "expired" | "noninstitutional" | "unverified";
type Firm = Pick<InvestorChecks, "investorStatus"> & { name: string };

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Where the firm's status stands today. Expiring is still current. */
export function statusState(firm: Pick<InvestorChecks, "investorStatus"> | undefined, today: string): StatusState {
  const status = firm?.investorStatus;
  if (!status) return "missing";
  if (status.basis === "none") return "noninstitutional";
  if (status.expiresOn < today) return "expired";
  if (status.evidence === "self_certified" && !INVESTOR_RULES.selfCertifiedCounts) return "unverified";
  return addDays(today, INVESTOR_RULES.warnDays) >= status.expiresOn ? "expiring" : "current";
}

export const statusCurrent = (firm: Pick<InvestorChecks, "investorStatus"> | undefined, today: string) => ["current", "expiring"].includes(statusState(firm, today));

/** What stops LendHous sending this firm a deal or taking its money for a loan, or null. Said to the team. */
export function investorBlocker(firm: Firm | undefined, today: string) {
  if (!firm) return "That firm is no longer on file";
  const status = firm.investorStatus;
  switch (statusState(firm, today)) {
    case "missing": return `${firm.name} hasn't certified what kind of investor it is (Partners & buyers)`;
    case "noninstitutional": return `${firm.name} says it isn't an institutional investor under Fla. Stat. 494.001, so selling it a loan or a share is licensed activity. Ask the attorney first`;
    case "expired": return `${firm.name}'s investor status ran out on ${longDay(status!.expiresOn)}. Ask it to certify again`;
    case "unverified": return `${firm.name}'s investor status is its own word and has to be verified first`;
    default: return null;
  }
}

/** The same, said to the firm itself. */
export function ownStatusBlocker(firm: Firm | undefined, today: string) {
  const state = statusState(firm, today);
  if (state === "current" || state === "expiring") return null;
  if (state === "noninstitutional") return "Your firm says it isn't an institutional investor, so LendHous can't take its bid or offer until the attorney says it may. Your contact at LendHous can tell you more.";
  if (state === "expired") return "Your firm's investor status has run out. Certify it again at the top of this page first.";
  if (state === "unverified") return "LendHous needs to verify your firm's investor status first. Your contact at LendHous can tell you more.";
  return "Certify what kind of investor your firm is, at the top of this page, first.";
}

export type StatusInput = Omit<InvestorStatus, "by" | "at">;

/** Why this status can't be saved, or null. The firm itself can only give its own word, and signs it. */
export function statusProblem(input: StatusInput, today: string, side: "team" | "firm") {
  if (!(input.entity in ENTITY) || !(input.basis in BASIS)) return "Choose what kind of investor the firm is.";
  if (input.basis === "accredited_investor" && !(input.how && input.how in ACCREDITED_HOW)) return "Choose which test of an accredited investor it meets.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on) || input.on > today) return "Enter the day it was certified, today or earlier.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) || input.expiresOn <= input.on) return "It runs out after the day it was certified.";
  if (input.expiresOn > addMonths(input.on, 24)) return "A status lasts two years at most before it's certified again.";
  if (side === "firm") {
    if (input.evidence !== "self_certified") return "Only LendHous can mark a status verified.";
    if (!input.signedName?.trim()) return "Type your name to sign for your firm.";
  }
  if (input.evidence === "verified" && !input.verifiedBy?.trim()) return "Say who verified it: the CPA, attorney, broker-dealer, adviser or service, and its letter's date.";
  return null;
}
