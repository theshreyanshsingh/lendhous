// The broker program (docs/next-features-prompt.md, H). A brokerage signs LendHous's broker agreement and an owner approves
// it before it can send deals; its fee on each loan is tracked until it's paid; and its referral link keeps the borrowers
// it sends as its own. Pure, so the portal, the server and the tests check the same rules.
import { evaluate, round2 } from "./engine";
import type { Broker, Deal } from "./mockData";

/** PLACEHOLDER until the attorney writes the agreement. Changing the wording means a new version, signed again. */
export const AGREEMENT_VERSION = "PLACEHOLDER-2026-11-04";
/** How long a borrower the broker brings stays theirs (the agreement's borrower protection). PLACEHOLDER. */
export const PROTECTION_MONTHS = 12;

/** The substance of the agreement, clause by clause (research: business-purpose only, disclosure, non-circumvention). */
export const AGREEMENT_TERMS: string[] = [
  "Business-purpose loans only. The broker sends LendHous loans for investment property held by a business, never a loan for a home the borrower or their family lives in, and never calls a consumer loan a business-purpose one (a felony in Florida, Fla. Stat. 494.0025).",
  "What the broker sends is accurate as far as they know: who the borrower is, how the property is used, where the money goes and what the property is worth. They tell LendHous at once if they learn otherwise.",
  "The broker's fee is the points agreed on each loan, paid by the borrower at closing. Every fee the borrower pays is disclosed on the term sheet and the settlement statement; the broker takes nothing from the borrower that isn't.",
  `LendHous won't go around the broker: a borrower the broker brings stays theirs for ${PROTECTION_MONTHS} months from the referral, and the broker's fee applies to loans LendHous makes that borrower in that time.`,
  "The broker can't bind LendHous, promise approval or terms, or say it's LendHous. Quotes they share say LendHous is the lender and that nothing is a commitment until a term sheet is accepted.",
  "The broker keeps any license their state requires, keeps borrowers' information private, and indemnifies LendHous for losses from what they misstate or leave out.",
  "Either side can end the agreement with written notice. Fees on loans already funded are still paid.",
];

export type BrokerStatus = NonNullable<Broker["status"]>;
export const BROKER_STATUS: Record<BrokerStatus, string> = { applied: "Waiting for approval", approved: "Approved", suspended: "Suspended" };

/** Only an approved firm sends deals: one that hasn't signed the agreement yet has no status. */
export const canSendDeals = (broker: Pick<Broker, "status"> | undefined) => broker?.status === "approved";

export type BrokerApplication = NonNullable<Broker["application"]>;
export type ApplicationInput = Omit<BrokerApplication, "agreementVersion" | "signedAt" | "ip">;

const sameName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** Why a broker's application can't be sent yet, or null. */
export function applicationProblem(input: ApplicationInput, agreed: boolean): string | null {
  if (!input.legalName.trim()) return "Enter the brokerage's legal name.";
  if (!/^[A-Z]{2}$/.test(input.entityState)) return "Enter the state it was formed in, like FL.";
  const principals = input.principals.map((name) => name.trim()).filter(Boolean);
  if (!principals.length) return "List the brokerage's owners and officers.";
  if (input.nmls && !/^\d{3,12}$/.test(input.nmls)) return "An NMLS ID is digits only.";
  if (!agreed) return "Check the box to agree to the broker agreement.";
  if (!principals.some((name) => sameName(name, input.signedName))) return "Sign with the name of one of the owners or officers listed.";
  return null;
}

/** Why an owner can't approve this firm yet, or null. A possible sanctions match needs a reason it isn't them. */
export function approveProblem(broker: Broker | undefined, reason: string): string | null {
  if (!broker?.application) return "This brokerage hasn't signed the broker agreement.";
  if (broker.status === "approved") return "It's already approved.";
  if (!broker.screening) return "Screen it against the OFAC list first.";
  if (broker.screening.status === "match") return "It matched the OFAC list. LendHous can't work with it.";
  if (broker.screening.status === "review" && !reason.trim()) return "The OFAC check found a possible match: say why it isn't them before approving.";
  return null;
}

/** A broker's fee on a loan: expected until the loan funds, then unpaid until it's recorded as paid. */
export type FeeState = "expected" | "unpaid" | "paid" | "none";
const FUNDED = new Set(["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off", "reo"]);
const ENDED = new Set(["declined", "withdrawn"]);
export const FEE_STATE: Record<FeeState, string> = { expected: "Expected at closing", unpaid: "Not paid yet", paid: "Paid", none: "No fee" };

export function feeOf(deal: Pick<Deal, "app" | "status" | "brokerPoints" | "brokerFeePaid">): { amount: number; state: FeeState } {
  if (deal.brokerFeePaid) return { amount: deal.brokerFeePaid.amount, state: "paid" };
  const amount = round2((evaluate(deal.app).noteAmount * (deal.brokerPoints ?? 0)) / 100);
  if (!amount || ENDED.has(deal.status)) return { amount: 0, state: "none" };
  return { amount, state: FUNDED.has(deal.status) ? "unpaid" : "expected" };
}

/** Why a fee payment can't be recorded, or null. */
export function feePaidProblem(deal: Deal | undefined, amount: number, on: string, today: string): string | null {
  if (!deal?.brokerId) return "This loan has no broker.";
  if (!FUNDED.has(deal.status)) return "A broker's fee is paid once the loan funds.";
  if (deal.brokerFeePaid) return "It's already recorded as paid.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter the amount paid.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) return "Enter the day it was paid, today or before.";
  if (on < deal.closingDate) return "It can't be paid before the loan closed.";
  return null;
}

/** A referral code: short, unambiguous letters and digits, from the firm's id so it stays the same. */
export function referralCodeFor(id: string, salt = "") {
  const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
  let hash = 2166136261;
  for (const char of `${id}:${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  let code = "";
  for (let i = 0; i < 8; i++) { code += ALPHABET[hash % ALPHABET.length]; hash = Math.imul(hash ^ (i + 7), 2246822519) >>> 0; }
  return code;
}

export const referralPath = (code: string) => `/start?ref=${code}`;

/** Whether a referral still holds on a day: the borrower is the broker's for PROTECTION_MONTHS from it. */
export function referralHolds(referredOn: string, today: string, months = PROTECTION_MONTHS) {
  const [y, m, d] = referredOn.split("-").map(Number);
  const until = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  return today <= until;
}
