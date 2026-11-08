// What each capital partner and loan buyer gets from the loans it holds (Spec P8, P9, 8.6): its share of each payment
// the servicing ledger shows, less LendHous's servicing fee. Pure, so the portfolio pages, the monthly statements and
// the tests agree.
import type { Book } from "./book";
import { evaluate } from "./engine";
import { SERVICING_STRIP_PCT } from "./loan-sale";
import type { Deal } from "./mockData";
import { balanceOf, ledger, rentalBalance, SERVICED } from "./servicing";

export type Investor = { type: "partner" | "buyer"; id: string };
/**
 * A loan an investor holds: its share of the loan, the rate it earns, the day it started holding it, and the day it handed
 * the share on to someone else (lib/capital-moves.ts). Payments from `since` on are its; from `until` on they aren't.
 */
export type Holding = { deal: Deal; share: number; investorRate: number; noteRate: number; since?: string; until?: string };

/**
 * Who keeps the late fees: LendHous as servicer (the PLACEHOLDER default, until the participation and sale agreements say
 * otherwise), or the investors pro rata. An owner sets it in Settings; the server sets it before making statements and the
 * browser from the page, the way pricing is adopted.
 */
let feeRules = { lateFees: false };
export const lateFeesToInvestors = () => feeRules.lateFees;
export const setInvestorFees = (rules: { lateFees: boolean }) => { feeRules = { lateFees: Boolean(rules.lateFees) }; };

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const HELD = [...SERVICED, "paid_off"];

/** The loans an investor holds: a partner's accepted bids on funded loans, a buyer's loans from the day it bought them. */
export function holdingsOf(book: Book, investor: Investor): Holding[] {
  const held = (dealId: string) => book.deals.find((deal) => deal.id === dealId && HELD.includes(deal.status));
  if (investor.type === "partner") {
    return book.bids.filter((bid) => bid.partnerId === investor.id && bid.status === "accepted").flatMap((bid) => {
      const deal = held(bid.dealId);
      return deal ? [{ deal, share: bid.pct / 100, investorRate: bid.lenderRate, noteRate: evaluate(deal.app).rate, ...(bid.since ? { since: bid.since } : {}), ...(bid.until ? { until: bid.until } : {}) }] : [];
    });
  }
  return book.sales.filter((sale) => sale.status === "sold" && sale.soldTo === investor.id).flatMap((sale) => {
    const deal = held(sale.dealId);
    if (!deal) return [];
    const rate = evaluate(deal.app).rate;
    return [{ deal, share: 1, investorRate: Math.max(0, rate - SERVICING_STRIP_PCT), noteRate: rate, since: sale.soldAt?.slice(0, 10) }];
  });
}

/** What a payoff paid back: the principal owed, and the interest in the rest of what was owed. Fees go to whoever keeps them. */
export function payoffParts(deal: Deal) {
  const principal = deal.paidOff ? balanceOf(deal) : 0;
  return { principal, interest: deal.paidOff ? Math.max(0, deal.paidOff.owed - principal) : 0 };
}

/** One investor's part of a payoff: its share of the principal, and of the interest at its own rate, after servicing. */
export function payoffShare(holding: Holding) {
  const paid = payoffParts(holding.deal);
  const gross = holding.share * paid.interest;
  const net = holding.noteRate > 0 ? gross * (holding.investorRate / holding.noteRate) : gross;
  return { principal: round2(holding.share * paid.principal), interest: round2(net) };
}

export type Split = { interest: number; principal: number; servicingFee: number; lateFees: number; net: number; payments: number };

/**
 * The investor's share of the payments on a loan received on the days `counts` accepts (and after it started holding):
 * interest at the note's rate less the servicing fee (the difference to the investor's rate), and principal, including
 * a payoff's. Amortizing loans split each payment by the schedule.
 */
export function splitOf(holding: Holding, counts: (day: string) => boolean): Split {
  const { deal, share } = holding;
  const e = evaluate(deal.app);
  const l = ledger(deal);
  const take = (day: string | undefined) => Boolean(day && counts(day) && (!holding.since || day >= holding.since) && (!holding.until || day < holding.until));
  let interest = 0, principal = 0, lateFees = 0, payments = 0;
  l.rows.forEach((row, index) => {
    if (!take(row.paidOn)) return;
    payments++;
    lateFees += row.feePaid;
    if (deal.app.product === "dscr") {
      const paidDown = rentalBalance(deal, index) - rentalBalance(deal, index + 1);
      principal += paidDown;
      interest += row.amount - paidDown;
    } else interest += row.amount;
  });
  // A portfolio loan's release: its price is principal, and the interest on it to the day is interest (lib/portfolio.ts).
  for (const release of deal.releases ?? []) {
    if (!take(release.on)) continue;
    principal += release.principal;
    interest += release.interest;
    payments++;
  }
  if (deal.paidOff && take(deal.paidOff.receivedOn)) {
    const paid = payoffParts(deal);
    principal += paid.principal;
    interest += paid.interest;
    payments++;
  }
  const gross = share * interest;
  const servicingFee = holding.noteRate > 0 ? gross * (1 - holding.investorRate / holding.noteRate) : 0;
  const fees = feeRules.lateFees ? share * lateFees : 0;
  return { interest: round2(gross), principal: round2(share * principal), servicingFee: round2(servicingFee), lateFees: round2(share * lateFees), net: round2(gross - servicingFee + share * principal + fees), payments };
}

export type StatementLine = Split & { dealId: string; loanNumber: string; product: string; share: number; investorRate: number; balance: number; daysPastDue: number; status: string };
export type Statement = { investor: Investor & { name: string }; month: string; lines: StatementLine[]; totals: Split & { balance: number } };

/** One investor's month (YYYY-MM): each loan it held, what came in on it, and where it stands at the end. */
export function statementFor(book: Book, investor: Investor, month: string): Statement {
  const name = (investor.type === "partner" ? book.partners : book.buyers).find((item) => item.id === investor.id)?.name ?? investor.id;
  const lastDay = `${month}-31`;
  const lines = holdingsOf(book, investor)
    // Only loans it held during the month: funded by its end, and bought by its end.
    .filter((holding) => holding.deal.closingDate <= lastDay && (!holding.since || holding.since <= lastDay))
    .map((holding): StatementLine => {
      const split = splitOf(holding, (day) => day.slice(0, 7) === month);
      // A share handed on by the month's end, or a loan paid off, leaves nothing outstanding.
      const paidOff = holding.deal.status === "paid_off" || Boolean(holding.until && holding.until <= lastDay);
      return { ...split, dealId: holding.deal.id, loanNumber: holding.deal.loanNumber, product: holding.deal.app.product, share: holding.share, investorRate: holding.investorRate, balance: paidOff ? 0 : round2(holding.share * balanceOf(holding.deal)), daysPastDue: paidOff ? 0 : ledger(holding.deal).daysPastDue, status: holding.deal.status };
    })
    // A loan paid off before the month has nothing left to say.
    .filter((line) => line.balance > 0 || line.payments > 0);
  const sum = (pick: (line: StatementLine) => number) => round2(lines.reduce((total, line) => total + pick(line), 0));
  return { investor: { ...investor, name }, month, lines, totals: { interest: sum((line) => line.interest), principal: sum((line) => line.principal), servicingFee: sum((line) => line.servicingFee), lateFees: sum((line) => line.lateFees), net: sum((line) => line.net), payments: lines.reduce((total, line) => total + line.payments, 0), balance: sum((line) => line.balance) } };
}

/** The month before a day, as YYYY-MM: what the statements made on the 1st cover. */
export const previousMonth = (day: string) => { const [year, month] = day.split("-").map(Number); return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`; };
export const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A statement as spreadsheet rows. */
export const statementRows = (statement: Statement) => statement.lines.map((line) => ({
  Month: statement.month, Loan: line.loanNumber, Share: `${Math.round(line.share * 100)}%`, "Your rate": line.investorRate, Payments: line.payments,
  Interest: line.interest, "Servicing fee": line.servicingFee, Principal: line.principal, "Net to you": line.net, "Balance at month end": line.balance, "Days past due": line.daysPastDue, Status: line.status.replace(/_/g, " "),
}));
