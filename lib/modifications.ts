// Changing a funded loan's terms in a workout (Spec 8.10; Lightning Docs' modification agreement): a new rate, the
// payments behind and their late fees added to principal or the fees waived, and more months on a short-term loan. It's
// proposed with a reason, approved by two different people, then signed by the borrower before it takes effect from the
// 1st of the month it's signed in. An extension (lib/loan-exits.ts) needs the loan current; a modification is for when it
// isn't. The reducer, the access rules and the screens all ask these, so what a screen offers and the server applies agree.
import { evaluate, fundedBalances, ioPayment, maturityDate, round2 } from "./engine";
import { shortDay } from "./format";
import type { Deal, LoanModification } from "./mockData";
import { USURY } from "./usury";
import { balanceOf, capitalizedOf, extendedMonths, ledgerOf, maturityOf, noteRateOn, recastPayment, rentalBalance, SERVICED, signedModifications } from "./servicing";

const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = <T>(items: T[], pick: (item: T) => number) => round2(items.reduce((total, item) => total + pick(item), 0));

/** PLACEHOLDER until GT sets them: the most months one modification adds to a short-term loan. */
export const MODIFICATION = { maxMonths: 12 };

export type ModificationTerms = Pick<LoanModification, "rate" | "capitalize" | "waiveFees" | "months">;

/** The modification proposed or approved and not yet signed, if there is one. */
export const openModification = (deal: Pick<Deal, "modifications">) => (deal.modifications ?? []).find((item) => item.status === "proposed" || item.status === "approved");

/** The 1st of the month it's signed in: interest runs at the new rate from then, and payments due after it are the new payment. */
export const effectiveFrom = (on: string) => `${on.slice(0, 7)}-01`;

/** Florida's usury limit for a loan of this size (Fla. Stat. 687.02 and 687.071). */
const usuryLimit = (balance: number) => (balance <= USURY.civilUpTo ? USURY.civil : USURY.above);

export type ModificationPreview = {
  effectiveOn: string;
  fromRate: number; toRate: number;
  fromMaturity: string; toMaturity: string;
  fromPayment: number; newPayment: number;
  fromPrincipal: number; toPrincipal: number;
  capitalizedDues: string[]; capitalizedPayments: number;
  fees: { due: string; amount: number }[]; capitalizedFees: number; waivedFees: number;
  afterPayments: number;
  /** What would still be owed to be current once it's signed: the payments behind it didn't add to principal. */
  stillOwed: number;
};

/** The modification as signed on a day, with what it would change worked out from the loan as it stands then. */
export function modificationPreview(deal: Deal, terms: ModificationTerms, on: string): ModificationPreview {
  const l = ledgerOf(deal, on);
  const e = evaluate(deal.app);
  const effectiveOn = effectiveFrom(on);
  const fromRate = noteRateOn(deal);
  const toRate = terms.rate ?? fromRate;
  const behind = l.rows.filter((row) => row.due <= effectiveOn && (row.status === "due" || row.status === "late"));
  const capitalizedDues = terms.capitalize ? behind.map((row) => row.due) : [];
  const capitalizedPayments = terms.capitalize ? sum(behind, (row) => row.amount) : 0;
  const owedFees = l.rows.filter((row) => row.fee - row.feePaid > 0.005).map((row) => ({ due: row.due, amount: round2(row.fee - row.feePaid) }));
  const feeTotal = sum(owedFees, (fee) => fee.amount);
  const fees = terms.capitalize || terms.waiveFees ? owedFees : [];
  const capitalizedFees = terms.capitalize && !terms.waiveFees ? feeTotal : 0;
  const waivedFees = terms.waiveFees ? feeTotal : 0;
  const afterPayments = l.rows.filter((row) => row.due <= effectiveOn).length;
  const added = round2(capitalizedPayments + capitalizedFees);
  const fromPrincipal = balanceOf(deal);
  // A rental loan's payment is worked out again on the new balance over the months left; a short-term loan's is
  // interest only, on what's lent plus what was added, at the new rate.
  let newPayment: number;
  let toPrincipal: number;
  if (deal.app.product === "dscr") {
    const draft: LoanModification = { id: "preview", ...terms, reason: "", proposedBy: "", proposedAt: "", proposedOn: "", status: "executed", approvers: [], executed: { on, effectiveOn, reference: "", by: "", at: "9999", fromRate, toRate, fromMaturity: "", toMaturity: "", fromPayment: 0, newPayment: 0, capitalizedDues, capitalizedPayments, fees, capitalizedFees, waivedFees, afterPayments } };
    const balance = rentalBalance({ ...deal, modifications: [...signedModifications(deal), draft] }, afterPayments);
    newPayment = recastPayment(deal, balance, afterPayments, toRate);
    toPrincipal = round2(balance);
  } else {
    const funded = fundedBalances(e, deal.app, deal.disbursedDraws);
    newPayment = round2(ioPayment((deal.app.accrual === "dutch" ? funded.disbursed : e.noteAmount) + capitalizedOf(deal) + added, toRate));
    toPrincipal = round2(fromPrincipal + added);
  }
  const fromMaturity = maturityOf(deal);
  const toMaturity = terms.months ? maturityDate(deal.closingDate, e.termMonths + extendedMonths(deal) + terms.months) : fromMaturity;
  const fromPayment = l.rows.find((row) => row.due > effectiveOn)?.amount ?? newPayment;
  const stillOwed = Math.max(0, round2(l.amountDue - capitalizedPayments - (terms.capitalize || terms.waiveFees ? feeTotal : 0)));
  return { effectiveOn, fromRate, toRate, fromMaturity, toMaturity, fromPayment, newPayment, fromPrincipal, toPrincipal, capitalizedDues, capitalizedPayments, fees, capitalizedFees, waivedFees, afterPayments, stillOwed };
}

/** Why these terms can't be proposed today, or null. */
export function proposalProblem(deal: Deal, terms: ModificationTerms, today: string, inBankruptcy: boolean) {
  if (!SERVICED.includes(deal.status)) return "Only a loan being serviced can be modified.";
  if (inBankruptcy) return "The borrower is in bankruptcy, so the loan can only be changed through the bankruptcy court. Talk to counsel.";
  if (openModification(deal)) return "A modification is already being looked at.";
  if (terms.rate === undefined && !terms.capitalize && !terms.waiveFees && !terms.months) return "Choose at least one change.";
  const l = ledgerOf(deal, today);
  if (terms.rate !== undefined) {
    if (!Number.isFinite(terms.rate) || terms.rate <= 0) return "Enter the new rate.";
    if (Math.abs(terms.rate - noteRateOn(deal)) < 0.001) return "That's the rate it has now.";
    const limit = usuryLimit(balanceOf(deal));
    if (terms.rate > limit) return `Florida caps the rate on this loan at ${limit}% (Fla. Stat. 687).`;
  }
  if (terms.months !== undefined) {
    if (deal.app.product === "dscr") return "A rental loan's term isn't extended: change its rate or add what's behind to principal instead.";
    if (!Number.isInteger(terms.months) || terms.months < 1 || terms.months > MODIFICATION.maxMonths) return `Add 1 to ${MODIFICATION.maxMonths} months.`;
  }
  const preview = modificationPreview(deal, terms, today);
  if (terms.capitalize && !preview.capitalizedDues.length && !preview.capitalizedFees) return "Nothing is behind to add to principal.";
  if (terms.waiveFees && !preview.waivedFees) return "No late fees are owed to waive.";
  if (terms.capitalize && l.matured && !terms.months) return "The loan is past maturity: add months too, or take the payoff.";
  return null;
}

/** Why an approved modification can't be recorded as signed on that day, or null. */
export function signProblem(deal: Deal, modification: LoanModification, on: string, today: string, inBankruptcy: boolean) {
  if (modification.status !== "approved") return modification.status === "proposed" ? "It needs two approvals first." : "That modification is closed.";
  if (!SERVICED.includes(deal.status)) return "This loan isn't being serviced.";
  if (inBankruptcy) return "The borrower is in bankruptcy: the court has to approve a change to the loan.";
  if (on > today) return "The signing date can't be in the future.";
  if (on < modification.proposedOn) return "That's before the modification was proposed.";
  // Its terms start on the 1st of the month it's signed; a month already billed can't be changed after the fact.
  if (effectiveFrom(on) !== effectiveFrom(today)) return "A modification takes effect from the 1st of the month it's signed, so record it in that month.";
  return null;
}

/** What a modification changes, in a line for the audit log, the alerts and the lists. */
export function modificationWords(preview: Pick<ModificationPreview, "fromRate" | "toRate" | "capitalizedPayments" | "capitalizedFees" | "waivedFees" | "fromMaturity" | "toMaturity" | "newPayment">) {
  const parts: string[] = [];
  if (Math.abs(preview.toRate - preview.fromRate) >= 0.001) parts.push(`rate ${preview.fromRate.toFixed(2)}% to ${preview.toRate.toFixed(2)}%`);
  if (preview.capitalizedPayments + preview.capitalizedFees > 0) parts.push(`${money(preview.capitalizedPayments + preview.capitalizedFees)} behind added to principal`);
  if (preview.waivedFees > 0) parts.push(`${money(preview.waivedFees)} of late fees waived`);
  if (preview.toMaturity !== preview.fromMaturity) parts.push(`maturity ${shortDay(preview.fromMaturity)} to ${shortDay(preview.toMaturity)}`);
  parts.push(`payment ${money(preview.newPayment)}`);
  return parts.join(", ");
}
