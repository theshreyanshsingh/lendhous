// How a loan leaves the book or gets more time (Spec 4.1, 8.4, 8.5 and 8.10): an application declined or withdrawn
// before funding, a default declared and cured, an extension asked for, approved by two people and signed, and the
// payoff and the release of the mortgage after it. The reducer, the access rules and the screens all ask these, so the
// button a screen offers and the rule the server applies can't disagree.
import { evaluate } from "./engine";
import type { Closure, Deal, DefaultKind, LoanExtension, LoanStatus } from "./mockData";
import { pricingConfig } from "./pricing-config";
import { addDays, daysBetween, ledgerOf, maturityOf, openDefault, payoffFor, SERVICED, type Ledger } from "./servicing";

const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Behind on the loan: a payment past its grace days, or a late fee unpaid. A payment due but still in grace isn't. */
const behind = (l: Ledger) => l.paymentsLate > 0 || l.feesOwed > 0.005;

/** Before the money goes out (Spec states 3 to 10): the stages an application can be declined or withdrawn from. */
export const PRE_FUNDING: LoanStatus[] = ["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"];
export const CLOSED_APPLICATION: LoanStatus[] = ["declined", "withdrawn"];
export const isClosedApplication = (status: LoanStatus) => CLOSED_APPLICATION.includes(status);

export const DECLINE_REASONS: Record<string, string> = {
  credit: "Credit",
  experience: "Not enough experience",
  leverage: "Value or leverage doesn't support the loan",
  liquidity: "Not enough cash to close or in reserve",
  property: "Property, title or market",
  incomplete: "File not completed",
  compliance: "ID, OFAC or background check",
  capital: "No capital for this deal",
  other: "Other",
};
export const WITHDRAW_REASONS: Record<string, string> = {
  other_lender: "Went with another lender",
  fell_through: "The purchase fell through",
  terms: "Didn't accept the terms",
  timing: "Couldn't close in time",
  no_loan: "Doesn't need a loan now",
  other: "Other",
};
export const closureReason = (closure: Closure) => (closure.outcome === "declined" ? DECLINE_REASONS : WITHDRAW_REASONS)[closure.reason] ?? closure.reason;

/**
 * Where a reopened application goes back to. Its capital was let go when it closed, so one that had cleared to close
 * starts again at conditions, where the capital is lined up again.
 */
export const reopenTo = (closure: Closure): LoanStatus => (PRE_FUNDING.indexOf(closure.from) > PRE_FUNDING.indexOf("conditions") ? "conditions" : closure.from);

export const DEFAULT_KINDS: Record<DefaultKind, string> = {
  monetary: "Missed payments",
  maturity: "Not paid off at maturity",
  covenant: "Broke a loan covenant",
  insurance_lapse: "Insurance lapsed",
  tax_delinquency: "Property taxes unpaid",
};

/** Why a default can't be declared, or null. The notice itself is the attorney's; this records the decision. */
export function defaultError(deal: Deal, kind: DefaultKind, effectiveOn: string, today: string) {
  if (!SERVICED.includes(deal.status)) return "This loan isn't being serviced.";
  if (openDefault(deal)) return "This loan is already in default.";
  if (effectiveOn > today) return "The effective date can't be in the future.";
  if (effectiveOn < deal.closingDate) return "That date is before the loan closed.";
  const l = ledgerOf(deal, today);
  if (kind === "monetary" && !l.paymentsLate) return "No payment is late, so it can't be a payment default.";
  if (kind === "maturity" && !l.matured) return "The loan hasn't matured yet.";
  return null;
}

/** Why an open default can't be cured yet, or null. */
export function cureError(deal: Deal, today: string) {
  if (!openDefault(deal)) return "This loan isn't in default.";
  const l = ledgerOf(deal, today);
  if (l.matured) return "The loan is past maturity. Extend it or take the payoff to end the default.";
  if (behind(l)) return `${money(l.amountDue)} is still owed. It has to be paid first.`;
  return null;
}

const { maxCount, monthsEach, feePoints, requestWindowDays } = pricingConfig.extensions;

/** The fee for an extension: feePoints of the note amount for every monthsEach months, prorated. */
export const extensionFee = (deal: Deal, months: number) => Math.round(evaluate(deal.app).noteAmount * (feePoints / 100) * (months / monthsEach) * 100) / 100;

/** The extension asked for or approved and not yet signed, if there is one. */
export const openExtension = (deal: Pick<Deal, "extensions">) => (deal.extensions ?? []).find((item) => item.status === "requested" || item.status === "approved");
export const extensionsUsed = (deal: Pick<Deal, "extensions">) => (deal.extensions ?? []).filter((item) => item.status === "executed").length;
/** The first day a borrower can ask for more time. */
export const extensionWindowOpens = (deal: Deal) => addDays(maturityOf(deal), -requestWindowDays);

/** Why this extension can't be asked for, or null. The team can file one at any time; a borrower from the window on. */
export function extensionRequestError(deal: Deal, months: number, today: string, byTeam: boolean) {
  if (!SERVICED.includes(deal.status)) return "Only a funded loan can be extended.";
  if (openExtension(deal)) return "An extension is already being looked at.";
  if (extensionsUsed(deal) >= maxCount) return `This loan has had the most extensions allowed (${maxCount}).`;
  if (!Number.isInteger(months) || months < 1 || months > monthsEach) return `An extension is 1 to ${monthsEach} months.`;
  if (!byTeam && today < extensionWindowOpens(deal)) return `You can ask for an extension from ${extensionWindowOpens(deal)}, ${requestWindowDays} days before maturity.`;
  return null;
}

export type ExtensionCheck = { label: string; ok: boolean };

/** What the approvers should see before they sign (Spec 8.4). None of these stops an approval: the loan being current stops the signing. */
export function extensionChecks(deal: Deal, today: string): ExtensionCheck[] {
  const l = ledgerOf(deal, today);
  const checks: ExtensionCheck[] = [{ label: behind(l) ? `${money(l.amountDue)} is owed and has to be paid before it's signed` : "Payments are current", ok: !behind(l) }];
  const scope = deal.scope ?? [];
  const budget = scope.reduce((sum, line) => sum + line.budget, 0);
  if (budget > 0) {
    const done = Math.round((scope.reduce((sum, line) => sum + line.released, 0) / budget) * 100);
    checks.push({ label: `Rehab ${done}% drawn (75% or more, or listed for sale or refinancing)`, ok: done >= 75 });
  }
  if (deal.allocations.some((item) => item.sourceId.startsWith("partner:") || item.sourceId.startsWith("buyer:"))) checks.push({ label: "Another lender or buyer holds part of this loan: get their consent if their agreement asks for it", ok: false });
  checks.push({ label: "Updated value (BPO or AVM) still within the leverage limits", ok: false });
  return checks;
}

/** The maturity once this extension is signed. */
export const maturityAfter = (deal: Deal, extension: LoanExtension) => maturityOf({ ...deal, extensions: (deal.extensions ?? []).map((item) => (item.id === extension.id ? { ...item, status: "executed" as const } : item)) });

/** Why an approved extension can't be signed today, or null. */
export function executeError(deal: Deal, extension: LoanExtension, on: string, today: string) {
  if (extension.status !== "approved") return extension.status === "requested" ? "It needs two approvals first." : "That extension is closed.";
  if (on > today) return "The signing date can't be in the future.";
  if (on < extension.requestedAt.slice(0, 10)) return "That's before the extension was asked for.";
  const l = ledgerOf(deal, today);
  if (behind(l)) return `Bring the loan current first: ${money(l.amountDue)} is owed.`;
  return null;
}

/** The ledger and payoff on the day a payoff arrived. */
export function payoffOn(deal: Deal, receivedOn: string) {
  const l: Ledger = ledgerOf(deal, receivedOn);
  return { ledger: l, quote: payoffFor(deal, receivedOn, l) };
}

/** Why this payoff can't be recorded, or null. Less than the payoff isn't a payoff: it's a payment. */
export function payoffError(deal: Deal, amount: number, receivedOn: string, today: string) {
  if (!SERVICED.includes(deal.status)) return "This loan isn't being serviced.";
  if (receivedOn > today) return "The date received can't be in the future.";
  if (receivedOn < deal.closingDate) return "That date is before the loan closed.";
  const { total } = payoffOn(deal, receivedOn).quote;
  if (amount + 0.005 < total) return `That's ${money(total - amount)} short of the ${money(total)} payoff on ${receivedOn}. Record it as a payment, or collect the rest first.`;
  return null;
}

/** The day the satisfaction of mortgage is due out, once a loan is paid off. */
export const lienReleaseDue = (deal: Deal) => (deal.paidOff ? addDays(deal.paidOff.receivedOn, pricingConfig.lienReleaseDays) : undefined);
/** A paid-off loan whose mortgage release isn't recorded yet. */
export const lienReleaseOpen = (deal: Deal) => deal.status === "paid_off" && Boolean(deal.paidOff) && !deal.paidOff?.release?.recordedOn;
export const lienReleaseDaysLeft = (deal: Deal, today: string) => { const due = lienReleaseDue(deal); return due ? daysBetween(today, due) : 0; };
