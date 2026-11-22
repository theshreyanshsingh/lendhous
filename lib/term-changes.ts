// No surprises after the term sheet (borrowers' commonest complaint about national lenders: fees added after signing).
// Once a borrower accepts, the team can't just save new numbers that move what the borrower pays or gets. It sends the
// change with a reason, the borrower agrees to it or doesn't, and their broker sees both. Then, before funding, the
// title company's draft settlement statement is checked line by line against the terms as agreed, so a lender fee can't
// change at the closing table either. The reducer, the access rules, the screens and the title company's page all ask
// these, so they can't disagree.
import { evaluate, round2, type Application } from "./engine";
import { closingTaxes } from "./florida-taxes";
import type { Deal, LoanStatus, SettlementCheck, TermChange } from "./mockData";

/** From acceptance until the loan clears to close. After that its numbers are locked outright (lib/book-access.ts). */
export const TERMS_HELD: LoanStatus[] = ["term_sheet_accepted", "conditions"];
export const termsHeld = (deal: Pick<Deal, "status">) => TERMS_HELD.includes(deal.status);

export const TERM_KEYS = ["noteAmount", "initialAdvance", "holdback", "financedReserve", "rate", "pointsPct", "points", "lenderFees", "termMonths", "monthlyPayment", "cashToClose"] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export const TERM_LABELS: Record<TermKey, string> = {
  noteAmount: "Loan amount", initialAdvance: "Advanced at closing", holdback: "Rehab or construction holdback", financedReserve: "Interest reserve",
  rate: "Interest rate", pointsPct: "Origination points (%)", points: "Origination points ($)", lenderFees: "Lender fees", termMonths: "Term (months)",
  monthlyPayment: "Monthly payment", cashToClose: "Cash to close (estimated)",
};
export type TermLine = { key: string; label: string; before: number; after: number };
export type Terms = Record<TermKey, number>;

/** How a line's number reads: dollars, a rate, points or months. */
export function termValue(key: string, value: number) {
  if (key === "rate") return `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0")}%`;
  if (key === "pointsPct") return `${value} point${value === 1 ? "" : "s"}`;
  if (key === "termMonths") return `${value} months`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The terms these numbers make, priced as the loan is (an accepted loan's rate and points are fixed in it). */
export function termsOf(app: Application): Terms {
  const e = evaluate(app);
  return { noteAmount: e.noteAmount, initialAdvance: e.initialAdvance, holdback: e.holdback, financedReserve: e.financedReserve, rate: e.rate, pointsPct: e.pointsPct, points: e.points, lenderFees: e.lenderFees, termMonths: e.termMonths, monthlyPayment: e.monthlyPayment, cashToClose: e.cashToClose };
}

/** What an edit may change: never the pricing version, the accepted rate and points, or the repeat-borrower record. */
export function editable(changes: Partial<Application>): Partial<Application> {
  const { pricingVersion: _version, termRate: _rate, termPoints: _points, repeat: _repeat, ...rest } = changes;
  return rest;
}

const moved = (key: TermKey, a: number, b: number) => (key === "rate" || key === "pointsPct" ? Math.abs(a - b) >= 0.0005 : Math.abs(round2(a) - round2(b)) >= 0.005);

/** What these edits would move in the borrower's terms, line by line. A move of less than a cent doesn't count. */
export function termLines(app: Application, changes: Partial<Application>): TermLine[] {
  const before = termsOf(app);
  const after = termsOf({ ...app, ...editable(changes) });
  return TERM_KEYS.filter((key) => moved(key, before[key], after[key])).map((key) => ({ key, label: TERM_LABELS[key], before: round2(before[key]), after: round2(after[key]) }));
}

const sameLines = (a: TermLine[], b: TermLine[]) => a.length === b.length && a.every((line, i) => line.key === b[i].key && Math.abs(line.before - b[i].before) < 0.005 && Math.abs(line.after - b[i].after) < 0.005);

export const openTermChange = (deal: Pick<Deal, "termChanges">) => deal.termChanges?.find((item) => item.status === "proposed");

/** Why the team can't save these numbers straight away: they move what the borrower accepted. Null if they can. */
export function heldProblem(deal: Deal, changes: Partial<Application>) {
  if (!termsHeld(deal) || !termLines(deal.app, changes).length) return null;
  return "The borrower accepted this loan's terms, and this changes them. Send the change to the borrower with a reason, so they can agree to it first.";
}

/** Why this change can't go to the borrower, or null. */
export function proposeProblem(deal: Deal, changes: Partial<Application>, reason: string) {
  if (!termsHeld(deal)) return "A change goes to the borrower between accepting the term sheet and clearing to close.";
  if (openTermChange(deal)) return "A change is already waiting for the borrower. Withdraw it first.";
  if (!termLines(deal.app, changes).length) return "These numbers don't change the borrower's terms, so they can just be saved.";
  if (!reason.trim()) return "Say why the terms need to change. The borrower and their broker see it.";
  return null;
}

/** Why the borrower can't answer this change this way, or null. */
export function answerProblem(deal: Deal, changeId: string, agree: boolean, signedName: string) {
  const change = deal.termChanges?.find((item) => item.id === changeId);
  if (!change || change.status !== "proposed") return "That change isn't waiting for an answer.";
  if (!termsHeld(deal)) return "This loan has moved on, so the change can't be made now.";
  if (agree && !signedName.trim()) return "Type your name to agree.";
  // The borrower agrees to the numbers they were shown, never to ones that moved since.
  if (agree && !sameLines(change.lines, termLines(deal.app, change.changes))) return "The loan's numbers moved since this was sent. Ask your loan officer to send it again.";
  return null;
}

/** Why the team can't withdraw it, or null. */
export const withdrawProblem = (deal: Deal, changeId: string) => (deal.termChanges?.some((item) => item.id === changeId && item.status === "proposed") ? null : "That change isn't waiting for the borrower.");

/** The change as it was made: who asked, the lines, the answer. */
export function newChange(deal: Deal, id: string, changes: Partial<Application>, reason: string, by: string, at: string): TermChange {
  return { id, changes: editable(changes), lines: termLines(deal.app, changes), reason: reason.trim(), by, at, status: "proposed" };
}

// The settlement statement.

export const SETTLEMENT_KEYS = ["loanAmount", "points", "lenderFees", "brokerFee", "interestReserve", "docStamps", "intangibleTax"] as const;
export type SettlementKey = (typeof SETTLEMENT_KEYS)[number];
export const SETTLEMENT_LABELS: Record<SettlementKey, string> = {
  loanAmount: "Loan amount", points: "Origination points", lenderFees: "Lender fees (all of them added up)", brokerFee: "Broker's fee",
  interestReserve: "Interest reserve held back", docStamps: "Florida doc stamps on the note and mortgage", intangibleTax: "Florida intangible tax",
};
/** The statement is checked from conditions until the loan funds. */
export const SETTLEMENT_OPEN: LoanStatus[] = ["conditions", "clear_to_close", "closing"];
/** PLACEHOLDER: a line within a dollar of the terms matches (title companies round). */
export const SETTLEMENT_TOLERANCE = 1;

/**
 * The terms the borrower agreed to: the accepted term sheet's, with any change they agreed to since. A loan accepted
 * before term sheets were kept uses its numbers as they are.
 */
export function agreedTerms(deal: Deal): Terms & { brokerFee: number } {
  const sheet = deal.termSheets?.[deal.termSheets.length - 1];
  const now = termsOf(deal.app);
  const base: Terms = sheet?.status === "accepted" ? Object.fromEntries(TERM_KEYS.map((key) => [key, sheet.terms[key]])) as Terms : now;
  for (const change of deal.termChanges ?? []) if (change.status === "agreed") for (const line of change.lines) if (line.key in base) base[line.key as TermKey] = line.after;
  // The broker's points are fixed before the term sheet; the fee follows the loan amount as agreed.
  const brokerPoints = sheet?.status === "accepted" ? sheet.terms.brokerPoints ?? 0 : deal.brokerPoints ?? 0;
  return { ...base, brokerFee: round2((base.noteAmount * brokerPoints) / 100) };
}

/** What each lender line on the statement should be, from the agreed terms and Florida's taxes on that loan amount. */
export function expectedFigures(deal: Deal): Record<SettlementKey, number> {
  const terms = agreedTerms(deal);
  const taxes = closingTaxes(deal.app, terms.noteAmount);
  return { loanAmount: terms.noteAmount, points: terms.points, lenderFees: terms.lenderFees, brokerFee: terms.brokerFee, interestReserve: terms.financedReserve, docStamps: taxes?.stamps ?? 0, intangibleTax: taxes?.intangible ?? 0 };
}

export type SettlementLine = { key: SettlementKey; label: string; expected: number; stated: number; off: boolean };
/** The statement's lines beside the terms'. A line left blank reads as none on the statement. */
export function settlementLines(deal: Deal, check: Pick<SettlementCheck, "figures"> | undefined = deal.settlement): SettlementLine[] {
  return check ? linesFrom(expectedFigures(deal), check.figures) : [];
}

/** Typed figures against expected ones, line by line: the same check on the title company's page as on the team's. */
export function linesFrom(expected: Record<SettlementKey, number>, figures: SettlementCheck["figures"]): SettlementLine[] {
  return SETTLEMENT_KEYS.map((key) => {
    const stated = round2(figures[key] ?? 0);
    return { key, label: SETTLEMENT_LABELS[key], expected: round2(expected[key]), stated, off: Math.abs(stated - expected[key]) > SETTLEMENT_TOLERANCE };
  });
}

/** Why funding waits on the settlement statement, or null: a line differs from the terms and nobody has said why. */
export function settlementHold(deal: Deal) {
  const off = settlementLines(deal).filter((line) => line.off);
  if (!off.length || deal.settlement?.explained) return null;
  return `The settlement statement doesn't match the agreed terms (${off.map((line) => line.label.toLowerCase().replace(/ \(.*\)$/, "")).join(", ")}): have the title company fix it, or explain it on the Closing tab`;
}

/** Why these figures can't be saved, or null. */
export function settlementProblem(deal: Deal, figures: SettlementCheck["figures"]) {
  if (!SETTLEMENT_OPEN.includes(deal.status)) return "The settlement statement is checked from conditions until the loan funds.";
  const values = Object.entries(figures);
  if (!values.length || values.every(([, value]) => value === undefined)) return "Enter the lines from the settlement statement.";
  if (values.some(([key, value]) => !(SETTLEMENT_KEYS as readonly string[]).includes(key) || (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100_000_000)))) return "Each line is a dollar amount.";
  if (!figures.loanAmount) return "Enter the loan amount from the statement.";
  return null;
}

/** Why the difference can't be explained, or null. */
export function explainProblem(deal: Deal, reason: string) {
  if (!settlementLines(deal).some((line) => line.off)) return "The statement matches the terms: there's nothing to explain.";
  if (deal.settlement?.explained) return "It's already explained.";
  if (!reason.trim()) return "Say why the difference is right.";
  return null;
}
