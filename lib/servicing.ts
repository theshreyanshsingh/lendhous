// A funded loan's payment history and payoff statement (Spec 8). Dates are YYYY-MM-DD and interest is paid in arrears
// on the 1st, so a loan's first payment falls on the 1st of the month after it closes.
import { evaluate, fundedBalances, payoffQuote } from "./engine";
import type { Deal } from "./mockData";

/** The same day a number of months later. Only used with due dates, which are always the 1st. */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

export const firstDueDate = (closingDate: string) => addMonths(`${closingDate.slice(0, 7)}-01`, 1);

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The balance after some payments on an amortizing loan. */
export function amortizedBalance(amount: number, ratePct: number, monthlyPayment: number, payments: number) {
  let left = amount;
  for (let month = 0; month < payments; month++) left -= monthlyPayment - (left * ratePct) / 100 / 12;
  return Math.max(0, left);
}

export type PaymentRow = { due: string; amount: number; status: "paid" | "late" };

/** Every payment that has come due. nextPaymentDue is the next one to pay, or the latest one missed on a late loan. */
export function paymentHistory(deal: Deal): PaymentRow[] {
  if (!deal.nextPaymentDue) return [];
  const amount = fundedBalances(evaluate(deal.app), deal.app, deal.disbursedDraws).nextPayment;
  const late = deal.paymentsLate ?? 0;
  const rows: PaymentRow[] = [];
  const last = late ? deal.nextPaymentDue : addMonths(deal.nextPaymentDue, -1);
  for (let due = firstDueDate(deal.closingDate); due <= last; due = addMonths(due, 1)) rows.push({ due, amount, status: "paid" });
  rows.slice(rows.length - late).forEach((row) => { row.status = "late"; });
  return rows;
}

export const paymentsMade = (deal: Deal) => paymentHistory(deal).filter((row) => row.status === "paid").length;

/** The loan after one payment arrives: the oldest late payment first, otherwise the next one due. */
export function afterPayment(deal: Deal): Deal {
  const late = deal.paymentsLate ?? 0;
  if (late > 1) return { ...deal, paymentsLate: late - 1 };
  return { ...deal, paymentsLate: 0, nextPaymentDue: addMonths(deal.nextPaymentDue!, 1), status: deal.status === "servicing_delinquent" ? "servicing_current" : deal.status };
}

/** The principal owed today: what has been lent out, less what a rental loan's payments have paid down. */
export function balanceOf(deal: Deal) {
  const e = evaluate(deal.app);
  const amount = deal.app.product === "dscr" ? amortizedBalance(e.noteAmount, e.rate, e.monthlyPayment, paymentsMade(deal)) : fundedBalances(e, deal.app, deal.disbursedDraws).disbursed;
  return Math.round(amount * 100) / 100;
}

/** What it takes to pay the loan off on a date: principal plus the interest since the last payment. */
export function payoffFor(deal: Deal, goodThrough: string) {
  const e = evaluate(deal.app);
  const dscr = deal.app.product === "dscr";
  const principal = balanceOf(deal);
  // The last payment covers interest up to its own due date. A loan with none yet accrues from closing.
  const history = paymentHistory(deal).filter((row) => row.status === "paid");
  const paidThrough = history.length ? history[history.length - 1].due : deal.closingDate;
  const quote = payoffQuote({
    disbursedPrincipal: principal,
    ratePct: e.rate,
    daysAccrued: Math.max(0, daysBetween(paidThrough, goodThrough)),
    accrualBasisAmount: !dscr && deal.app.accrual === "full_boat" ? e.noteAmount : undefined,
  });
  return { principal, accrued: quote.accrued, perDiem: quote.perDiem, total: quote.total };
}
