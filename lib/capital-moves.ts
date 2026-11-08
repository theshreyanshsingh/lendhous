// The capital side's moves partway through a loan (docs/competitor-gaps.md, 1.9): what a partner wants done with its
// money when a loan pays off (sent, the principal rolled into its next loan, or all of it rolled), a partner's share
// moved to another partner or back to LendHous with the interest split to the day, and partners who send their share of
// each draw as it's released instead of all of the holdback at closing. Pure, so the reducer, the access rules, the
// portfolio and the team's desk agree.
import type { Book } from "./book";
import { evaluate } from "./engine";
import { payoffShare, ratesOn, reoShare, type Holding } from "./investor-statements";
import { payoffOn } from "./loan-exits";
import type { Bid, Deal, DrawCall, Partner, PayoffProceeds, RolloverChoice, ShareTransfer } from "./mockData";
import { firmOfacBlocker } from "./ofac";
import { SERVICED } from "./servicing";
import { isBusinessDay } from "./sla";

export const ROLLOVER: Record<RolloverChoice, { label: string; detail: string }> = {
  send: { label: "Send it to me", detail: "LendHous sends the principal and interest to you once the payoff arrives." },
  principal: { label: "Roll the principal, send the interest", detail: "The principal waits for your next loan with LendHous, so you don't wire it again; the interest is sent to you." },
  all: { label: "Roll all of it", detail: "Principal and interest both wait for your next loan with LendHous." },
};
export const rolloverOf = (partner: Pick<Partner, "rollover"> | undefined): RolloverChoice => partner?.rollover?.choice ?? "send";

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const ENDED = ["declined", "withdrawn"];

/** The partner's accepted bid that holds a share of this loan now: not one it handed on. */
export const currentBids = (book: Pick<Book, "bids">, dealId: string) => book.bids.filter((bid) => bid.dealId === dealId && bid.status === "accepted" && !bid.until);

const holdingOf = (deal: Deal, bid: Bid): Holding => ({ deal, share: bid.pct / 100, investorRate: bid.lenderRate, noteRate: evaluate(deal.app).rate });

/** Each current partner's money from a loan that just paid off, or whose bank-owned property just sold, split the way it chose. */
export function payoffProceeds(book: Pick<Book, "bids" | "partners">, paidOff: Deal, id: (n: number) => string): { partnerId: string; proceeds: PayoffProceeds }[] {
  const on = paidOff.paidOff?.receivedOn ?? paidOff.reo?.sold?.on;
  if (!on) return [];
  return currentBids(book, paidOff.id).map((bid, n) => {
    const { principal, interest } = paidOff.paidOff ? payoffShare(holdingOf(paidOff, bid)) : reoShare(holdingOf(paidOff, bid));
    const choice = rolloverOf(book.partners.find((partner) => partner.id === bid.partnerId));
    const rolled = choice === "all" ? round2(principal + interest) : choice === "principal" ? principal : 0;
    return { partnerId: bid.partnerId, proceeds: { id: id(n), dealId: paidOff.id, loanNumber: paidOff.loanNumber, on, principal, interest, choice, rolled, toSend: round2(principal + interest - rolled) } };
  });
}

/** A partner's rolled-over money not yet put into a loan. A loan that falls through before funding gives its part back. */
export function creditOf(book: Pick<Book, "deals" | "partners">, partnerId: string, exceptDealId?: string) {
  const rolled = (book.partners.find((partner) => partner.id === partnerId)?.proceeds ?? []).reduce((sum, item) => sum + item.rolled, 0);
  const used = book.deals.filter((deal) => deal.id !== exceptDealId && deal.partnerFunding?.partnerId === partnerId && !ENDED.includes(deal.status)).reduce((sum, deal) => sum + (deal.partnerFunding!.fromCredit ?? 0), 0);
  return Math.max(0, round2(rolled - used));
}

/** What a partner wires for closing: its share of the loan, less the holdback when it funds draws as they're released. */
export function closingShare(deal: Pick<Deal, "app">, pct: number, fundsDraws: boolean) {
  const e = evaluate(deal.app);
  return Math.round(((fundsDraws ? e.noteAmount - e.holdback : e.noteAmount) * pct) / 100);
}

export { toWire } from "./partner-funding";

/** PLACEHOLDER until the participation agreement sets it: business days a partner has to send its share of a draw. */
export const DRAW_CALL_DAYS = 3;
export function addBusinessDays(day: string, days: number) {
  let at = day;
  for (let left = days; left > 0;) {
    at = new Date(Date.parse(`${at}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (isBusinessDay(at)) left--;
  }
  return at;
}

/** The share of a released draw each partner that funds draws as released sends in. LendHous pays the borrower first. */
export function drawCallsFor(book: Pick<Book, "bids">, deal: Deal, drawId: string, approved: number, today: string, id: (n: number) => string): DrawCall[] {
  if (!deal.partnerFunding?.drawsAsReleased) return [];
  // Whoever holds a share now: a partner that took one over funds the draws after it.
  return currentBids(book, deal.id).map((bid, n) => ({ id: id(n), drawId, partnerId: bid.partnerId, amount: round2((approved * bid.pct) / 100), calledOn: today, dueOn: addBusinessDays(today, DRAW_CALL_DAYS) }));
}

/** Draw shares a partner hasn't sent in yet, and the ones LendHous hasn't confirmed. */
export const openDrawCalls = (deal: Pick<Deal, "drawCalls">) => (deal.drawCalls ?? []).filter((call) => !call.received);

/**
 * What moving a share on a day comes to: its principal out on the loan, its part of the holdback LendHous still holds for
 * draws (when the partner paid it in at closing), and the interest at the partner's rate since the last payment, per day.
 */
export function transferQuote(deal: Deal, bid: Pick<Bid, "pct" | "lenderRate">, on: string) {
  const { quote } = payoffOn(deal, on);
  const share = bid.pct / 100;
  const e = evaluate(deal.app);
  // The partner's rate moves with the note's when a modification changes it (lib/investor-statements.ts).
  const rates = ratesOn({ deal, share, investorRate: bid.lenderRate, noteRate: e.rate }, on);
  const atRate = rates.note > 0 ? rates.investor / rates.note : 1;
  const principal = round2(share * quote.principal);
  const holdback = deal.partnerFunding?.drawsAsReleased ? 0 : round2(share * Math.max(0, e.holdback - (deal.disbursedDraws ?? 0)));
  const accrued = round2(share * quote.accrued * atRate);
  return { principal, holdback, accrued, perDiem: round2(share * quote.perDiem * atRate), price: round2(principal + holdback + accrued) };
}

/** Why this share can't be moved as asked, or null. */
export function transferProblem(book: Pick<Book, "bids" | "partners" | "deals">, deal: Deal, fromPartnerId: string, to: string, on: string, today: string) {
  if (!SERVICED.includes(deal.status)) return "Shares move only on a funded loan that hasn't paid off.";
  const bid = currentBids(book, deal.id).find((item) => item.partnerId === fromPartnerId);
  if (!bid) return "That partner doesn't hold a share of this loan.";
  if (to === fromPartnerId) return "Choose who takes the share.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return "Choose the day it moves.";
  if (on < deal.closingDate) return "That's before the loan closed.";
  if (on > today) return "A share moves on a day that's come, so the interest to the day is known.";
  if (to !== "gt-main") {
    const firm = book.partners.find((partner) => partner.id === to);
    if (!firm) return "That partner is no longer on file.";
    if (!firm.ndaSigned) return `${firm.name} hasn't signed the NDA.`;
    if (currentBids(book, deal.id).some((item) => item.partnerId === to)) return `${firm.name} already holds a share of this loan.`;
    const held = firmOfacBlocker(firm, today);
    if (held) return `${held}.`;
  }
  return null;
}

/** The book after a share moves: the old bid ends that day, the new holder's starts, and the allocation follows. */
export function moveShare(book: Book, deal: Deal, transfer: ShareTransfer, bidId: string): Pick<Book, "bids" | "deals"> {
  const old = currentBids(book, deal.id).find((bid) => bid.partnerId === transfer.from)!;
  const bids = book.bids.map((bid) => (bid.id === old.id ? { ...bid, until: transfer.on } : bid));
  const taken: Bid[] = transfer.to === "gt-main" ? [] : [{ id: bidId, dealId: deal.id, partnerId: transfer.to, pct: old.pct, lenderRate: transfer.rate, lenderPoints: 0, conditions: `Took over a share on ${transfer.on}`, status: "accepted", type: "transfer", at: transfer.at, since: transfer.on }];
  const amount = deal.allocations.find((item) => item.sourceId === `partner:${transfer.from}`)?.amount ?? 0;
  const rest = deal.allocations.filter((item) => item.sourceId !== `partner:${transfer.from}`);
  // Back to LendHous, the share joins its own money on the loan.
  const allocations = transfer.to === "gt-main"
    ? (rest.some((item) => item.sourceId === "gt-main") ? rest.map((item) => (item.sourceId === "gt-main" ? { ...item, amount: item.amount + amount } : item)) : [...rest, { sourceId: "gt-main", amount }])
    : [...rest, { sourceId: `partner:${transfer.to}`, amount }];
  const route: Deal["route"] = allocations.every((item) => item.sourceId === "gt-main") ? "in_house" : allocations.some((item) => item.sourceId === "gt-main") ? "split" : "partner";
  return {
    bids: [...taken, ...bids],
    deals: book.deals.map((item) => (item.id === deal.id ? { ...item, allocations, route, transfers: [...(item.transfers ?? []), transfer], teaserSentTo: transfer.to === "gt-main" || item.teaserSentTo.includes(transfer.to) ? item.teaserSentTo : [...item.teaserSentTo, transfer.to] } : item)),
  };
}

/** Payoff money LendHous still owes partners, oldest first. */
export const proceedsToSend = (partners: Partner[]) => partners.flatMap((partner) => (partner.proceeds ?? []).filter((item) => item.toSend > 0 && !item.sent).map((item) => ({ partner, proceeds: item }))).sort((a, b) => a.proceeds.on.localeCompare(b.proceeds.on));

/** Shares moved whose price hasn't been settled yet. */
export const unsettledTransfers = (deals: Deal[]) => deals.flatMap((deal) => (deal.transfers ?? []).filter((item) => !item.settled).map((transfer) => ({ deal, transfer })));
