// A borrower's monthly statement for a funded loan (Spec 8.6): where the loan stands at the end of the month, what came
// in and went out during it, what's due next, and what it would take to pay it off. Pure: it reads the same servicing
// ledger the loan page and the payoff letters do, so the three always agree.
import type { Book } from "./book";
import { evaluate, fundedBalances } from "./engine";
import { inBankruptcy } from "./collections";
import { splitOf } from "./investor-statements";
import type { Deal } from "./mockData";
import { addDays, addMonths, balanceOf, ledgerOf, maturityOf, METHODS, noteRateOn, payoffFor, SERVICED } from "./servicing";
import { interestBasis } from "./status-words";
import { individualBorrower, TAX_CONFIG } from "./tax-forms";

export type BorrowerStatement = {
  dealId: string; loanNumber: string; borrowerName: string; entityName: string; property: string;
  month: string; statementDate: string;
  rate: number; interestOn: string; maturity: string; principal: number;
  holdback: { total: number; drawn: number; remaining: number };
  draws: { on: string; amount: number }[];
  payments: { on: string; amount: number; method: string }[];
  received: number;
  billed: { due: string; amount: number; status: string }[];
  lateFees: number; feesOwed: number;
  nextDue: { on: string; amount: number } | null;
  amountDue: number; daysPastDue: number;
  payoff: { goodThrough: string; total: number; perDiem: number } | null;
  paidOff?: string;
  interestThisYear: number;
  /** The borrower is in bankruptcy, so the statement says it's for information only (lib/collections.ts). */
  bankruptcy?: boolean;
};

const monthStart = (month: string) => `${month}-01`;
/** The last day of a month: "2026-10" → "2026-10-31". */
export const monthEnd = (month: string) => addDays(addMonths(monthStart(month), 1), -1);
const inMonth = (month: string) => (day: string | undefined) => Boolean(day && day.startsWith(`${month}-`));
const round2 = (amount: number) => Math.round(amount * 100) / 100;

/** A loan gets a statement for a month it was funded at the end of, or the month it paid off in. */
export function statementDue(deal: Deal, month: string) {
  if (deal.closingDate > monthEnd(month)) return false;
  if (deal.status === "paid_off") return Boolean(deal.paidOff && deal.paidOff.receivedOn >= monthStart(month) && deal.paidOff.receivedOn <= monthEnd(month));
  return SERVICED.includes(deal.status);
}

/** Interest the borrower paid in a calendar year, as the 1098 counts it. */
export const interestPaidIn = (deal: Deal, year: number) => { const rate = evaluate(deal.app).rate; return round2(splitOf({ deal, share: 1, investorRate: rate, noteRate: rate }, (day) => day.startsWith(`${year}-`)).interest); };
/** Whether LendHous files a 1098 for this loan for that year: an individual borrower who paid enough interest. */
export const gets1098 = (deal: Deal, year: number) => individualBorrower(deal) && interestPaidIn(deal, year) >= TAX_CONFIG.mortgageInterestThreshold;

/** The statement for a loan and month, or null when it doesn't get one. */
export function borrowerStatementFor(book: Book, deal: Deal, month: string): BorrowerStatement | null {
  if (!statementDue(deal, month)) return null;
  const end = monthEnd(month);
  const statementDate = addMonths(monthStart(month), 1);
  const e = evaluate(deal.app);
  const atEnd = ledgerOf(deal, end);
  const next = ledgerOf(deal, statementDate);
  const counts = inMonth(month);
  const payments = (deal.payments ?? []).filter((payment) => !payment.reversed && counts(payment.receivedOn)).map((payment) => ({ on: payment.receivedOn, amount: payment.amount, method: METHODS[payment.method] }));
  const draws = book.draws.filter((draw) => draw.dealId === deal.id && draw.status === "funded" && counts(draw.fundedAt?.slice(0, 10))).map((draw) => ({ on: draw.fundedAt!.slice(0, 10), amount: draw.approved ?? 0 }));
  const balances = fundedBalances(e, deal.app, deal.disbursedDraws);
  const paidOff = deal.status === "paid_off" ? deal.paidOff?.receivedOn : undefined;
  const nextRow = next.rows.find((row) => row.due === next.nextDue);
  const payoff = paidOff ? null : payoffFor(deal, statementDate, next);
  return {
    dealId: deal.id, loanNumber: deal.loanNumber, borrowerName: deal.borrowerName, entityName: deal.entityName, property: `${deal.address}, ${deal.city} ${deal.zip}`,
    month, statementDate,
    rate: noteRateOn(deal), interestOn: interestBasis(deal.app.product, deal.app.accrual), maturity: maturityOf(deal), principal: paidOff ? 0 : balanceOf(deal),
    holdback: { total: round2(e.holdback), drawn: round2(e.holdback - balances.holdbackRemaining), remaining: round2(balances.holdbackRemaining) },
    draws, payments, received: round2(payments.reduce((sum, payment) => sum + payment.amount, 0)),
    billed: atEnd.rows.filter((row) => counts(row.due)).map((row) => ({ due: row.due, amount: row.amount, status: row.status })),
    lateFees: round2(atEnd.rows.filter((row) => counts(row.lateOn) && row.late && !row.waived).reduce((sum, row) => sum + row.fee, 0)),
    feesOwed: atEnd.feesOwed,
    nextDue: !paidOff && next.nextDue && nextRow ? { on: next.nextDue, amount: nextRow.amount } : null,
    amountDue: paidOff ? 0 : next.amountDue, daysPastDue: paidOff ? 0 : next.daysPastDue,
    payoff: payoff && { goodThrough: statementDate, total: payoff.total, perDiem: payoff.perDiem },
    paidOff,
    interestThisYear: interestPaidIn(deal, Number(month.slice(0, 4))),
    ...(inBankruptcy(deal) ? { bankruptcy: true } : {}),
  };
}
