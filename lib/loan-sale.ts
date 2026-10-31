// What a loan buyer sees and the arithmetic they rely on. Prices are a percent of the unpaid balance: 100 is par,
// 98 is a 2% discount. Like a partner teaser, the tape names no street, borrower or entity until the sale closes.
import { evaluate, fundedBalances, maturityDate } from "./engine";
import type { Deal, LoanSale } from "./mockData";

/** Kept by LendHous as servicer, the same placeholder 1% strip as partner teasers (Spec 6.6). */
export const SERVICING_STRIP_PCT = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

type Note = { balance: number; ratePct: number; months: number; monthlyPayment?: number };

/** Monthly cash to the buyer after servicing, ending with the balance at maturity. monthlyPayment means it amortizes. */
export function cashFlows({ balance, ratePct, months, monthlyPayment }: Note, stripPct = SERVICING_STRIP_PCT) {
  const flows: number[] = [];
  let left = balance;
  for (let month = 1; month <= months; month++) {
    const interest = (left * ratePct) / 100 / 12;
    const principal = month === months ? left : monthlyPayment ? Math.min(left, Math.max(0, monthlyPayment - interest)) : 0;
    flows.push(interest + principal - (left * stripPct) / 100 / 12);
    left -= principal;
  }
  return flows;
}

/** Annual yield if the loan pays as agreed to maturity, bought at this price. Solved by bisection on the monthly rate. */
export function yieldAtPrice(note: Note, pricePct: number, stripPct = SERVICING_STRIP_PCT) {
  const flows = cashFlows(note, stripPct);
  const price = (note.balance * pricePct) / 100;
  const worth = (monthly: number) => flows.reduce((sum, flow, index) => sum + flow / (1 + monthly) ** (index + 1), 0);
  let low = -0.05;
  let high = 0.25;
  for (let step = 0; step < 80; step++) {
    const middle = (low + high) / 2;
    if (worth(middle) > price) low = middle;
    else high = middle;
  }
  return round2(((low + high) / 2) * 12 * 100);
}

/** The balance after some payments on an amortizing loan. */
function amortizedBalance(amount: number, ratePct: number, monthlyPayment: number, payments: number) {
  let left = amount;
  for (let month = 0; month < payments; month++) left -= monthlyPayment - (left * ratePct) / 100 / 12;
  return Math.max(0, left);
}

export const pricePaid = (balance: number, pricePct: number) => round2((balance * pricePct) / 100);

/** The loan tape: everything a buyer needs to price the loan, and nothing that identifies the borrower. */
export function tapeOf(deal: Deal, sale: LoanSale) {
  const e = evaluate(deal.app);
  const amortizing = deal.app.product === "dscr";
  const funded = fundedBalances(e, deal.app, deal.disbursedDraws);
  const balance = round2(amortizing ? amortizedBalance(e.noteAmount, e.rate, e.monthlyPayment, sale.paymentsMade) : funded.disbursed);
  const monthsLeft = Math.max(1, e.termMonths - sale.paymentsMade);
  const note: Note = { balance, ratePct: e.rate, months: monthsLeft, monthlyPayment: amortizing ? e.monthlyPayment : undefined };
  const band = Math.floor(deal.app.fico / 20) * 20;
  const paymentsLate = deal.paymentsLate ?? 0;
  return {
    tapeId: "N-" + deal.loanNumber.slice(-4),
    product: deal.app.product,
    county: deal.app.county,
    state: deal.app.state,
    zip3: deal.zip.slice(0, 3) + "xx",
    propertyType: deal.app.propertyType,
    note,
    balance,
    // Buying a rehab loan means funding its remaining draws, so the buyer has to see this next to the balance.
    holdbackLeft: funded.holdbackRemaining,
    noteRate: e.rate,
    netRate: round2(e.rate - SERVICING_STRIP_PCT),
    termMonths: e.termMonths,
    monthsLeft,
    maturity: maturityDate(deal.closingDate, e.termMonths),
    paymentsMade: sale.paymentsMade,
    paymentsLate,
    current: paymentsLate === 0,
    monthlyIncome: round2(cashFlows(note)[0]),
    askPct: sale.askPct,
    askPrice: pricePaid(balance, sale.askPct),
    askYield: yieldAtPrice(note, sale.askPct),
    ratios: e.ratios,
    ficoBand: `${band}–${band + 19}`,
    fico: deal.app.fico,
    tier: e.tier,
    grade: e.score.grade,
    score: e.score.score,
    exit: deal.exitStrategy,
    noteAmount: e.noteAmount,
    affiliatedContractor: Boolean(deal.contractorIsGtAffiliate),
  };
}
export type LoanTape = ReturnType<typeof tapeOf>;

/** What a sale leaves on the buyer's books: what they paid and what the loan still pays them. */
export function holdingOf(tape: LoanTape, paidPct: number) {
  return { paid: pricePaid(tape.balance, paidPct), yield: yieldAtPrice(tape.note, paidPct), monthlyIncome: tape.monthlyIncome };
}
