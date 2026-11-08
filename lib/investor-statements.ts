// What each capital partner and loan buyer gets from the loans it holds (Spec P8, P9, 8.6): its share of each payment
// the servicing ledger shows, less LendHous's servicing fee. Pure, so the portfolio pages, the monthly statements and
// the tests agree.
import type { Book } from "./book";
import { evaluate } from "./engine";
import { SERVICING_STRIP_PCT } from "./loan-sale";
import type { Deal } from "./mockData";
import { reoProceeds } from "./collections";
import { addMonths, advancesOwed, balanceOf, ledger, noteRateOn, rentalBalance, SERVICED } from "./servicing";

export type Investor = { type: "partner" | "buyer"; id: string };
/**
 * A loan an investor holds: its share of the loan, the rate it earns, the note's rate as priced, the day it started holding
 * it, and the day it handed the share on to someone else (lib/capital-moves.ts). Payments from `since` on are its; from
 * `until` on they aren't.
 */
export type Holding = { deal: Deal; share: number; investorRate: number; noteRate: number; since?: string; until?: string };

/**
 * The note's rate and the investor's for interest on a day. A modification that changes the note's rate moves the
 * investor's by the same points, so LendHous's servicing spread stays what it was (PLACEHOLDER until the participation and
 * sale agreements say how a workout is shared), never below nothing.
 */
export function ratesOn(holding: Holding, day: string) {
  const note = noteRateOn(holding.deal, day);
  return { note, investor: Math.max(0, holding.investorRate + note - holding.noteRate) };
}

/**
 * Who keeps the late fees: LendHous as servicer (the PLACEHOLDER default, until the participation and sale agreements say
 * otherwise), or the investors pro rata. An owner sets it in Settings; the server sets it before making statements and the
 * browser from the page, the way pricing is adopted.
 */
let feeRules = { lateFees: false };
export const lateFeesToInvestors = () => feeRules.lateFees;
export const setInvestorFees = (rules: { lateFees: boolean }) => { feeRules = { lateFees: Boolean(rules.lateFees) }; };

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const HELD = [...SERVICED, "paid_off", "reo"];

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

/**
 * What a payoff paid back: the principal owed, and the interest in the rest of what was owed. Costs LendHous advanced come
 * back to it first (PLACEHOLDER), and fees go to whoever keeps them. A third party's bid at a foreclosure sale can come up
 * short, so it pays costs, then principal, then interest, as far as it goes.
 */
export function payoffParts(deal: Deal) {
  if (!deal.paidOff) return { principal: 0, interest: 0 };
  const balance = balanceOf(deal);
  const advances = advancesOwed(deal);
  if (deal.paidOff.foreclosureSale) {
    const received = Math.min(deal.paidOff.amount, deal.paidOff.owed);
    const principal = Math.min(balance, Math.max(0, received - advances));
    return { principal, interest: Math.max(0, received - advances - principal) };
  }
  return { principal: balance, interest: Math.max(0, deal.paidOff.owed - balance - advances) };
}

/** One investor's part of a payoff: its share of the principal, and of the interest at its own rate, after servicing. */
export function payoffShare(holding: Holding) {
  const paid = payoffParts(holding.deal);
  const gross = holding.share * paid.interest;
  const rates = ratesOn(holding, holding.deal.paidOff?.receivedOn ?? "9999-12-31");
  const net = rates.note > 0 ? gross * (rates.investor / rates.note) : gross;
  return { principal: round2(holding.share * paid.principal), interest: round2(net) };
}

/** One investor's part of a bank-owned property's sale (lib/collections.ts): its share of the principal back, and of the rest at its own rate. */
export function reoShare(holding: Holding) {
  const paid = reoProceeds(holding.deal);
  const gross = holding.share * paid.interest;
  const rates = ratesOn(holding, holding.deal.reo?.sold?.on ?? "9999-12-31");
  return { principal: round2(holding.share * paid.principal), interest: round2(rates.note > 0 ? gross * (rates.investor / rates.note) : gross) };
}

export type Split = { interest: number; principal: number; servicingFee: number; lateFees: number; net: number; payments: number };

/**
 * The investor's share of the payments on a loan received on the days `counts` accepts (and after it started holding):
 * interest at the note's rate less the servicing fee (the difference to the investor's rate), and principal, including
 * a payoff's. Amortizing loans split each payment by the schedule.
 */
export function splitOf(holding: Holding, counts: (day: string) => boolean): Split {
  const { deal, share } = holding;
  const l = ledger(deal);
  const take = (day: string | undefined) => Boolean(day && counts(day) && (!holding.since || day >= holding.since) && (!holding.until || day < holding.until));
  let principal = 0, lateFees = 0, payments = 0;
  // Interest grouped by the rates it ran at, since a modification can change them partway through.
  const byRate = new Map<string, { note: number; investor: number; amount: number }>();
  const interestAt = (amount: number, day: string) => {
    const rates = ratesOn(holding, day);
    const key = `${rates.note}:${rates.investor}`;
    byRate.set(key, { ...rates, amount: (byRate.get(key)?.amount ?? 0) + amount });
  };
  l.rows.forEach((row, index) => {
    if (!take(row.paidOn)) return;
    payments++;
    lateFees += row.feePaid;
    // A payment pays the month before it, so the rate is the one that month began with.
    const month = addMonths(row.due, -1);
    if (deal.app.product === "dscr") {
      const paidDown = rentalBalance(deal, index) - rentalBalance(deal, index + 1);
      principal += paidDown;
      interestAt(row.amount - paidDown, month);
    } else interestAt(row.amount, month);
  });
  // A portfolio loan's release: its price is principal, and the interest on it to the day is interest (lib/portfolio.ts).
  for (const release of deal.releases ?? []) {
    if (!take(release.on)) continue;
    principal += release.principal;
    interestAt(release.interest, release.on);
    payments++;
  }
  if (deal.paidOff && take(deal.paidOff.receivedOn)) {
    const paid = payoffParts(deal);
    principal += paid.principal;
    interestAt(paid.interest, deal.paidOff.receivedOn);
    payments++;
  }
  // A bank-owned property's sale: after the costs, principal back first, then interest (lib/collections.ts).
  if (deal.reo?.sold && take(deal.reo.sold.on)) {
    const paid = reoProceeds(deal);
    principal += paid.principal;
    interestAt(paid.interest, deal.reo.sold.on);
    payments++;
  }
  let interest = 0, fee = 0;
  for (const group of byRate.values()) {
    interest += group.amount;
    fee += group.note > 0 ? share * group.amount * (1 - group.investor / group.note) : 0;
  }
  const gross = share * interest;
  const servicingFee = fee;
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
      // A share handed on by the month's end, or a loan paid off or its bank-owned property sold, leaves nothing outstanding.
      const paidOff = holding.deal.status === "paid_off" || Boolean(holding.deal.reo?.sold && holding.deal.reo.sold.on <= lastDay) || Boolean(holding.until && holding.until <= lastDay);
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
