// What a partner or loan buyer sees about the loans it holds, beyond its money (docs/competitor-gaps-2026-11-09.md, rank
// 14): when each loan should pay off, from the borrower's stated exit or its maturity; a line a month on how it's going
// (payments, draws against the work, insurance, storms, extensions and changes); and its capital account as a file. The
// borrower's own words (an exit plan's note) never reach a holder. Pure, so the pages and the tests agree.
import { PACE_LABEL, paceWords, projectPace } from "./project-pace";
import type { Book } from "./book";
import { evaluate } from "./engine";
import { CONFIDENCE, EXIT_CHOICES } from "./exit-plans";
import { policiesOf, policyWord } from "./insurance";
import { holdingsOf, splitOf, type Holding, type Investor } from "./investor-statements";
import { INVESTOR_STATUS, investorStatus } from "./investor-updates";
import type { Deal, DrawRequest, PayoffRequest } from "./mockData";
import { holdbackLeft, projectHealth } from "./budget";
import { holdingOf, tapeOf } from "./loan-sale";
import { balanceOf, daysBetween, ledger } from "./servicing";
import type { StormWatch } from "./storms";

/**
 * What a holder's copy of a loan doesn't carry, worked out by the server from the whole book: how far the work has got
 * against the money paid out, when it was last inspected and a draw last released, and a storm whose cone covers it now.
 */
export type HolderWatch = { done?: number; paid?: number; ahead?: boolean; lastInspected?: string; lastReleased?: string; storm?: string; payoffAsked?: string; /** The last draw asked for, for the project's pace (lib/project-pace.ts). */ lastAsked?: string };

export function holderWatch(deal: Deal, book: { draws: DrawRequest[]; storms: StormWatch[]; payoffs: PayoffRequest[] }): HolderWatch {
  const { draws, storms } = book;
  const mine = draws.filter((draw) => draw.dealId === deal.id);
  // A payoff letter asked for and not refused or paid is the clearest sign the loan is about to pay off.
  const payoffAsked = book.payoffs.filter((item) => item.dealId === deal.id && (item.status === "requested" || item.status === "sent")).map((item) => item.goodThrough).sort().pop();
  const health = projectHealth(deal, mine);
  const lastInspected = mine.map((draw) => draw.inspection?.at.slice(0, 10)).filter(Boolean).sort().pop();
  const lastReleased = mine.filter((draw) => draw.status === "funded").map((draw) => draw.fundedAt?.slice(0, 10)).filter(Boolean).sort().pop();
  const storm = storms.find((item) => item.status === "active" && item.nowIn.includes(deal.id))?.label;
  const lastAsked = mine.filter((draw) => draw.status !== "rejected").map((draw) => draw.requestedAt).sort().pop();
  return { ...(lastAsked ? { lastAsked } : {}), ...(health ? { done: health.done, paid: health.paid, ahead: health.ahead } : {}), ...(lastInspected ? { lastInspected } : {}), ...(lastReleased ? { lastReleased } : {}), ...(storm ? { storm } : {}), ...(payoffAsked ? { payoffAsked } : {}) };
}

/**
 * The book with each loan's summary: a real holder's copy already has it from the server; a demo seat, which keeps the
 * whole demo book in the browser, works it out here.
 */
export const withWatch = <T extends Pick<Book, "deals" | "draws" | "storms" | "payoffs">>(book: T): T => ({ ...book, deals: book.deals.map((deal) => (deal.holderWatch ? deal : { ...deal, holderWatch: holderWatch(deal, book) })) });

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const pct = (share: number) => `${Math.round(share * 100)}%`;
const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

export type ExpectedPayoff = { month?: string; words: string; basis: "paid" | "letter" | "plan" | "maturity" | "term" | "trouble" };

/** When a held loan should pay off, and on what: the borrower's exit plan, else its maturity. */
export function expectedPayoff(deal: Deal, today: string): ExpectedPayoff {
  if (deal.status === "paid_off" && deal.paidOff) return { month: deal.paidOff.receivedOn.slice(0, 7), words: `Paid off ${longDay(deal.paidOff.receivedOn)}.`, basis: "paid" };
  if (deal.status === "reo") return { words: "Bank-owned: it pays off when LendHous sells the property.", basis: "trouble" };
  if (deal.foreclosure && !deal.foreclosure.stopped) return { words: "In foreclosure: no payoff date until it ends.", basis: "trouble" };
  if (deal.app.product === "dscr") return { words: "A 30-year rental loan: it pays off when the borrower sells or refinances.", basis: "term" };
  const { maturity } = ledger(deal);
  const asked = deal.holderWatch?.payoffAsked;
  if (asked) return { month: (asked < today ? today : asked).slice(0, 7), words: `A payoff letter was asked for, good through ${longDay(asked)}; it matures ${longDay(maturity)}.`, basis: "letter" };
  const plan = deal.exitPlan;
  const sure = plan ? ` (${CONFIDENCE[plan.confidence].toLowerCase()})` : "";
  if (maturity < today) return { month: maturity.slice(0, 7), words: `Past its maturity of ${longDay(maturity)}${plan ? `; the borrower is ${EXIT_CHOICES[plan.choice].toLowerCase()}${sure}` : ""}.`, basis: plan ? "plan" : "maturity" };
  if (plan?.choice === "sell" && plan.saleBy) {
    const by = plan.saleBy < maturity ? plan.saleBy : maturity;
    return { month: by.slice(0, 7), words: `The borrower plans to sell${sure}, closing by ${longDay(plan.saleBy)}; it matures ${longDay(maturity)}.`, basis: "plan" };
  }
  if (plan?.choice === "extend") return { month: maturity.slice(0, 7), words: `Matures ${longDay(maturity)}; the borrower expects to ask for an extension${sure}.`, basis: "plan" };
  if (plan) return { month: maturity.slice(0, 7), words: `Matures ${longDay(maturity)}; the borrower is ${EXIT_CHOICES[plan.choice].toLowerCase()}${sure}.`, basis: "plan" };
  return { month: maturity.slice(0, 7), words: `Matures ${longDay(maturity)}; the borrower hasn't said how it will pay off yet.`, basis: "maturity" };
}

export type WatchLine = { tone: "good" | "note" | "warn" | "bad"; text: string };

/** This month's line on a held loan: the facts a holder would ask about, newest first in importance. */
export function monthlyLine(deal: Deal, watch: HolderWatch | undefined, today: string): WatchLine[] {
  const lines: WatchLine[] = [];
  const status = investorStatus(deal);
  const late = deal.status === "paid_off" ? 0 : ledger(deal).daysPastDue;
  if (status === "current" && !late) lines.push({ tone: "good", text: "Payments are current." });
  else lines.push({ tone: status === "current" || status === "late" ? "warn" : "bad", text: late ? `${INVESTOR_STATUS[status]}: ${late} days past due.` : `${INVESTOR_STATUS[status]}.` });
  if (watch?.storm) lines.push({ tone: "bad", text: `In the forecast cone of ${watch.storm}. LendHous asks the borrower for photos once it passes.` });
  if (deal.status !== "paid_off") {
    const drawn = deal.disbursedDraws ?? 0;
    const holdback = holdbackLeft(deal) + drawn;
    if (holdback > 0 && (drawn > 0 || watch?.done !== undefined)) {
      const parts = [`${dollars(drawn)} of the ${dollars(holdback)} rehab holdback drawn`];
      if (watch?.done !== undefined) parts.push(`the work about ${pct(watch.done)} done${watch.lastInspected ? ` at the last inspection, ${longDay(watch.lastInspected)}` : ""}`);
      lines.push({ tone: watch?.ahead ? "warn" : "note", text: `${parts.join("; ")}.${watch?.ahead ? " Money paid out is running ahead of the work." : ""}` });
    } else if (holdback > 0) lines.push({ tone: "note", text: `No rehab draws yet from the ${dollars(holdback)} holdback.` });
    // The project's pace: stalled or behind, the way the team sees it (lib/project-pace.ts).
    const pace = projectPace(deal, watch?.lastAsked ? [{ dealId: deal.id, requestedAt: watch.lastAsked, status: "submitted" }] : [], today);
    if (pace && (pace.state !== "on_pace" || pace.lateFinish)) lines.push({ tone: pace.state === "stalled" ? "bad" : "warn", text: `${PACE_LABEL[pace.state]}: ${paceWords(pace)}` });
  }
  if (deal.status !== "paid_off") {
    const soon = policiesOf(deal).filter((policy) => policy.expiresOn).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
    if (soon && soon.expiresOn < today) lines.push({ tone: "bad", text: `The ${policyWord(soon.kind)} policy ran out ${longDay(soon.expiresOn)}; LendHous is following up.` });
    else if (soon && daysBetween(today, soon.expiresOn) <= 60) lines.push({ tone: "warn", text: `The ${policyWord(soon.kind)} policy runs out ${longDay(soon.expiresOn)}; LendHous asks the borrower for the renewal.` });
  }
  const extended = (deal.extensions ?? []).filter((item) => item.executed).sort((a, b) => b.executed!.on.localeCompare(a.executed!.on))[0];
  if (extended && daysBetween(extended.executed!.on, today) <= 120) lines.push({ tone: "note", text: `Extended ${extended.months} month${extended.months === 1 ? "" : "s"} on ${longDay(extended.executed!.on)}.` });
  const modified = (deal.modifications ?? []).filter((item) => item.executed).sort((a, b) => b.executed!.on.localeCompare(a.executed!.on))[0];
  if (modified && daysBetween(modified.executed!.on, today) <= 120) lines.push({ tone: "warn", text: `Its terms were changed on ${longDay(modified.executed!.on)}.` });
  return lines;
}

/** The holder's share of the loan's balance, for the payoff calendar: nothing on a share it moved on. */
const shareBalance = (holding: Holding) => (holding.until || holding.deal.status === "paid_off" ? 0 : holding.share * balanceOf(holding.deal));

/**
 * The holder's share of each unpaid loan by the month it should pay off: a payoff letter asked for, the borrower's stated
 * exit, else its maturity (a 30-year rental's too). A loan already past its date counts in this month.
 */
export function payoffLadder(holdings: Holding[], today: string): { month: string; value: number }[] {
  const byMonth = new Map<string, number>();
  for (const holding of holdings) {
    const amount = shareBalance(holding);
    const expected = expectedPayoff(holding.deal, today);
    if (!amount || expected.basis === "paid") continue;
    const due = expected.month ?? ledger(holding.deal).maturity.slice(0, 7);
    const month = due < today.slice(0, 7) ? today.slice(0, 7) : due;
    byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value: Math.round(value) }));
}

export type CapitalRow = {
  loanNumber: string; product: string; share: number; status: string; committed: number; calledForDraws: number; received: number;
  paidToYou: number; principalBack: number; interestToYou: number; servicingKept: number; rolledOver: number; balance: number; expectedPayoff: string;
};

/**
 * The investor's capital account, a row per loan: what it committed, what was called for draws, what LendHous received from
 * it, what came back (principal, and interest after servicing), what of a payoff was rolled into its next loan, and its
 * share outstanding. A buyer's committed and received are the price it paid.
 */
export function capitalAccount(book: Book, investor: Investor, today: string): CapitalRow[] {
  const partner = investor.type === "partner" ? book.partners.find((item) => item.id === investor.id) : undefined;
  return holdingsOf(book, investor).map((holding) => {
    const { deal } = holding;
    const split = splitOf(holding, () => true);
    const calls = (deal.drawCalls ?? []).filter((call) => call.partnerId === investor.id);
    const funding = deal.partnerFunding?.partnerId === investor.id ? deal.partnerFunding : undefined;
    const sale = investor.type === "buyer" ? book.sales.find((item) => item.dealId === deal.id && item.soldTo === investor.id && item.status === "sold") : undefined;
    // What the buyer paid: its price on the loan's balance at the sale.
    const price = sale ? holdingOf(tapeOf(deal, sale), sale.soldPct ?? 100).paid : 0;
    const committed = investor.type === "buyer" ? price : holding.share * evaluate(deal.app).noteAmount;
    const called = calls.reduce((sum, call) => sum + call.amount, 0);
    const received = investor.type === "buyer" ? price : (funding?.received ? funding.amount : 0) + calls.filter((call) => call.received).reduce((sum, call) => sum + call.amount, 0);
    const rolled = (partner?.proceeds ?? []).filter((item) => item.dealId === deal.id).reduce((sum, item) => sum + item.rolled, 0);
    const round = (amount: number) => Math.round(amount * 100) / 100;
    return {
      loanNumber: deal.loanNumber, product: deal.app.product, share: holding.share, status: holding.until ? "Moved on" : INVESTOR_STATUS[investorStatus(deal)],
      committed: round(committed), calledForDraws: round(called), received: round(received), paidToYou: split.net, principalBack: split.principal, interestToYou: round(split.interest - split.servicingFee),
      servicingKept: split.servicingFee, rolledOver: round(rolled), balance: round(shareBalance(holding)), expectedPayoff: expectedPayoff(deal, today).words,
    };
  });
}

export const CAPITAL_COLUMNS: [keyof CapitalRow, string][] = [
  ["loanNumber", "Loan"], ["product", "Program"], ["share", "Your share"], ["status", "Status"], ["committed", "Committed"], ["calledForDraws", "Called for draws"],
  ["received", "Received by LendHous"], ["paidToYou", "Paid to you"], ["principalBack", "Principal back"], ["interestToYou", "Interest to you after servicing"],
  ["servicingKept", "Servicing kept"], ["rolledOver", "Rolled into your next loan"], ["balance", "Your share outstanding"], ["expectedPayoff", "Expected payoff"],
];
