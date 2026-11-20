// The track record (docs/competitor-gaps-2026-11-09.md, rank 17): every loan LendHous has funded, by the year it funded
// and by program, for partners and buyers who signed the NDA. Funded, paid off, the yield it actually earned, and what
// went wrong: defaults, workouts, modifications, extensions, foreclosures, losses and what was recovered. Every funded
// loan counts, the bad ones too, and a group of only a few loans says so, since one loan moves its figures a lot. No loan
// numbers, addresses or names: it's the whole book in totals. It stays behind sign-in and the NDA; the attorney confirms
// that keeps it from being general solicitation. Pure.
import type { Book } from "./book";
import { evaluate, type Product } from "./engine";
import { payoffParts, splitOf } from "./investor-statements";
import type { Deal } from "./mockData";
import { reoProceeds } from "./collections";
import { milestones } from "./reports";
import { balanceOf, daysBetween, SERVICED, signedModifications } from "./servicing";

const PROGRAMS: Record<Product, string> = { fix_flip: "Fix & flip", bridge: "Bridge", ground_up: "Ground-up", dscr: "DSCR rental" };
/** Below this many loans, a group's figures carry a warning. PLACEHOLDER until GT sets it. */
export const SMALL_GROUP = 10;
const FUNDED = [...SERVICED, "paid_off", "reo"];

/** One funded loan, reduced to what the record counts. */
export type TrackLoan = {
  vintage: string; product: Product; amount: number; open: boolean;
  /** The loan ended: paid off (perhaps by a foreclosure sale) or its bank-owned property sold. */
  resolved?: { on: string; days: number; lent: number; interest: number; loss: number; recovered: number };
  extended: boolean; modified: boolean; workout: boolean; defaulted: boolean; foreclosed: boolean; lateNow: boolean;
};

/** What a funded loan adds to the record. Interest is the note's, before points and fees; losses include costs not recovered. */
export function trackLoan(deal: Deal): TrackLoan | null {
  if (!FUNDED.includes(deal.status)) return null;
  const funded = milestones(deal).funded ?? deal.closingDate;
  if (!funded) return null;
  const rate = evaluate(deal.app).rate;
  const foreclosed = Boolean(deal.foreclosure || deal.reo || deal.paidOff?.foreclosureSale);
  const base = {
    vintage: funded.slice(0, 4), product: deal.app.product, amount: evaluate(deal.app).noteAmount,
    extended: (deal.extensions ?? []).some((item) => item.status === "executed"), modified: signedModifications(deal).length > 0,
    workout: Boolean(deal.workout) || signedModifications(deal).length > 0, defaulted: (deal.defaults ?? []).length > 0 || foreclosed, foreclosed,
    lateNow: deal.status === "servicing_delinquent" || deal.status === "default",
  };
  const endedOn = deal.paidOff?.receivedOn ?? deal.reo?.sold?.on;
  if (!endedOn) return { ...base, open: true };
  const split = splitOf({ deal, share: 1, investorRate: rate, noteRate: rate }, () => true);
  let loss = 0;
  let recovered = 0;
  if (deal.reo?.sold) {
    const sold = reoProceeds(deal);
    loss = sold.principalLoss + sold.costShortfall;
    recovered = sold.principal;
  } else if (deal.paidOff?.foreclosureSale) {
    const paid = payoffParts(deal);
    loss = Math.max(0, balanceOf(deal) - paid.principal);
    recovered = paid.principal;
  }
  const lent = split.principal + Math.min(loss, Math.max(0, balanceOf(deal) - recovered));
  return { ...base, open: false, resolved: { on: endedOn, days: Math.max(1, daysBetween(funded, endedOn)), lent, interest: split.interest, loss, recovered } };
}

export type TrackRow = {
  key: string; label: string; funded: number; amount: number; paidOff: number; open: number;
  /** Interest earned after losses, a year, on the money lent: only loans that have ended. Null until one has. */
  realizedYield: number | null; medianDays: number | null;
  extended: number; modified: number; workouts: number; defaults: number; foreclosures: number; lateNow: number;
  losses: number; recoveries: number; small: boolean;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function rowOf(key: string, label: string, loans: TrackLoan[]): TrackRow {
  const ended = loans.flatMap((loan) => (loan.resolved ? [loan.resolved] : []));
  const weight = ended.reduce((sum, item) => sum + item.lent * (item.days / 365), 0);
  const count = (pick: (loan: TrackLoan) => boolean) => loans.filter(pick).length;
  return {
    key, label, funded: loans.length, amount: loans.reduce((sum, loan) => sum + loan.amount, 0), paidOff: ended.length, open: count((loan) => loan.open),
    realizedYield: weight > 0 ? (ended.reduce((sum, item) => sum + item.interest - item.loss, 0) / weight) * 100 : null,
    medianDays: median(ended.map((item) => item.days)),
    extended: count((loan) => loan.extended), modified: count((loan) => loan.modified), workouts: count((loan) => loan.workout), defaults: count((loan) => loan.defaulted),
    foreclosures: count((loan) => loan.foreclosed), lateNow: count((loan) => loan.lateNow),
    losses: Math.round(ended.reduce((sum, item) => sum + item.loss, 0)), recoveries: Math.round(ended.reduce((sum, item) => sum + item.recovered, 0)),
    small: loans.length < SMALL_GROUP,
  };
}

export type TrackRecord = { overall: TrackRow; byVintage: TrackRow[]; byProgram: TrackRow[]; asOf: string };

/** The whole book's record as of a day. */
export function trackRecord(book: Pick<Book, "deals">, asOf: string): TrackRecord {
  const loans = book.deals.flatMap((deal) => { const loan = trackLoan(deal); return loan ? [loan] : []; });
  const vintages = [...new Set(loans.map((loan) => loan.vintage))].sort().reverse();
  const products = [...new Set(loans.map((loan) => loan.product))].sort();
  return {
    overall: rowOf("all", "Every loan", loans),
    byVintage: vintages.map((year) => rowOf(year, `Funded in ${year}`, loans.filter((loan) => loan.vintage === year))),
    byProgram: products.map((product) => rowOf(product, PROGRAMS[product], loans.filter((loan) => loan.product === product))),
    asOf,
  };
}

/** The share of loans, as a whole percent, or a dash with none. */
export const shareOf = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
