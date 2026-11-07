// Construction budget controls (docs/competitor-gaps.md, 1.6): a contingency line that's only spent by moving it, change
// orders that move budget between lines once the loan has funded (with the effect on the after-repair value checked),
// overruns an inspection finds, which put the loan out of balance until they're covered, the interest reserve's balance,
// and how far the work has got against the money paid. Pure, so the borrower's page, the team's and the book agree.
import { evaluate, fundedBalances, inBalanceTest, round2 } from "./engine";
import type { ChangeOrder, Deal, DrawRequest, LoanPayment, ScopeLine } from "./mockData";
import { maturityOf, SERVICED } from "./servicing";

export const CONTINGENCY_ID = "contingency";
/** The share of the budget we suggest setting aside. PLACEHOLDER until GT sets it (research: 5–10% is usual). */
export const CONTINGENCY_SUGGESTED = 0.05;

export const isContingency = (line: Pick<ScopeLine, "id">) => line.id === CONTINGENCY_ID;
const left = (line: ScopeLine) => line.budget - line.released;

/** The holdback still to be drawn on the loan. */
export const holdbackLeft = (deal: Deal) => fundedBalances(evaluate(deal.app), deal.app, deal.disbursedDraws).holdbackRemaining;

/** Overruns an inspection found that the borrower hasn't covered yet. */
export const openOverruns = (deal: Pick<Deal, "overruns">) => (deal.overruns ?? []).filter((item) => !item.covered);

/**
 * Whether what's left to draw still pays for the work left: the budget not yet released plus any overrun no one has covered.
 * Out of balance, nothing more is released until the borrower covers the gap (Spec 7: the in-balance test).
 */
export function budgetBalance(deal: Deal) {
  const costToComplete = round2((deal.scope ?? []).reduce((sum, line) => sum + left(line), 0) + openOverruns(deal).reduce((sum, item) => sum + item.amount, 0));
  const available = holdbackLeft(deal);
  const { inBalance, shortfall } = inBalanceTest({ remainingHoldback: available, balancingDeposits: 0, costToComplete });
  return { available, costToComplete, inBalance, shortfall: round2(shortfall) };
}

export type ChangeInput = Pick<ChangeOrder, "from" | "to" | "amount" | "reason"> & { newDivision?: string; arv?: number };

/** What the loan's after-repair value would be at a new estimate, against its limit: null when the product has none. */
export function arvCheck(deal: Deal, arv: number) {
  if (deal.app.product !== "fix_flip" && deal.app.product !== "ground_up") return null;
  const e = evaluate(deal.app);
  const limit = e.ratios.find((ratio) => ratio.key === "ltarv")?.limit ?? 1;
  const ratio = arv > 0 ? e.noteAmount / arv : Infinity;
  return { ratio, limit, over: ratio > limit + 1e-9 };
}

/** Why this change order can't be asked for, or approved, on the loan as it stands, or null. */
export function changeOrderProblem(deal: Deal | undefined, input: ChangeInput): string | null {
  if (!deal) return "That loan no longer exists.";
  if (!SERVICED.includes(deal.status)) return "Change orders are for a funded loan's budget. Before closing, change the scope of work itself.";
  const scope = deal.scope ?? [];
  const from = scope.find((line) => line.id === input.from);
  if (!from) return "Choose the line the money comes from.";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Enter the amount to move.";
  if (input.amount > left(from) + 1e-9) return `${from.division} has only $${left(from).toLocaleString("en-US")} left to move.`;
  if (input.to === "new") {
    const name = input.newDivision?.trim() ?? "";
    if (!name) return "Name the new line.";
    if (name.length > 60) return "Keep the new line's name under 60 characters.";
    if (scope.some((line) => line.division.toLowerCase() === name.toLowerCase())) return "There's already a line with that name: move the money to it instead.";
  } else {
    const to = scope.find((line) => line.id === input.to);
    if (!to) return "Choose the line the money goes to.";
    if (to.id === from.id) return "Move the money to a different line.";
    if (isContingency(to)) return "Money goes back to contingency only by lowering a line before closing.";
  }
  if (!input.reason.trim()) return "Say what changed in the work and why.";
  if (input.arv !== undefined) {
    if (!Number.isFinite(input.arv) || input.arv <= 0) return "Enter the new after-repair value, or leave it blank.";
    const check = arvCheck(deal, input.arv);
    if (check?.over) return `At $${input.arv.toLocaleString("en-US")}, the loan would be ${(check.ratio * 100).toFixed(1)}% of the after-repair value, over its ${(check.limit * 100).toFixed(1)}% limit. Ask an owner about a modification.`;
  }
  return null;
}

/** The scope once an approved change order is applied: the money moves between lines, and a new line starts at nothing released. */
export function applyChange(scope: ScopeLine[], order: ChangeOrder): ScopeLine[] {
  const moved = scope.map((line) => (line.id === order.from ? { ...line, budget: round2(line.budget - order.amount) } : line.id === order.to ? { ...line, budget: round2(line.budget + order.amount) } : line));
  return order.to === "new" ? [...moved, { id: `co-${order.id}`, division: order.newDivision!.trim(), budget: round2(order.amount), released: 0 }] : moved;
}

export const openChanges = (deal: Pick<Deal, "changeOrders">) => (deal.changeOrders ?? []).filter((item) => item.status === "requested");

/** The interest reserve held from the loan, what's been paid from it, and how long the rest lasts at today's payment. */
export function reserveOf(deal: Deal, asOf: string) {
  const e = evaluate(deal.app);
  const funded = e.financedReserve;
  if (funded <= 0) return null;
  const used = round2((deal.payments ?? []).filter((item: LoanPayment) => item.method === "reserve" && !item.reversed).reduce((sum, item) => sum + item.amount, 0));
  const remaining = round2(Math.max(0, funded - used));
  const monthly = fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment;
  const months = monthly > 0 ? Math.floor((remaining + 0.005) / monthly) : 0;
  const toMaturity = monthsBetween(asOf, maturityOf(deal));
  return { funded, used, remaining, monthly, months, toMaturity, runsShort: months < toMaturity };
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
};

/** Why a payment can't be taken from the interest reserve, or null. */
export function reservePaymentProblem(deal: Deal, amount: number, asOf: string) {
  const reserve = reserveOf(deal, asOf);
  if (!reserve) return "This loan has no interest reserve.";
  if (amount > reserve.remaining + 0.005) return `The interest reserve has only $${reserve.remaining.toLocaleString("en-US", { minimumFractionDigits: 2 })} left.`;
  return null;
}

/**
 * How far the work has got against the money paid out: the latest inspection of each line, weighted by its budget, next to
 * the share released. Money running ahead of the work is the warning sign.
 */
export function projectHealth(deal: Deal, draws: DrawRequest[]) {
  const scope = (deal.scope ?? []).filter((line) => !isContingency(line));
  const budget = scope.reduce((sum, line) => sum + line.budget, 0);
  if (budget <= 0) return null;
  const inspected = draws.filter((draw) => draw.dealId === deal.id && ["inspected", "approved", "funded"].includes(draw.status)).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const latest = new Map<string, number>();
  for (const draw of inspected) for (const line of draw.lines) if (line.observedPct !== undefined) latest.set(line.scopeId, line.observedPct);
  const done = scope.reduce((sum, line) => sum + line.budget * Math.min(1, latest.get(line.id) ?? (line.released > 0 ? line.released / line.budget : 0)), 0) / budget;
  const paid = scope.reduce((sum, line) => sum + line.released, 0) / budget;
  return { done, paid, ahead: paid > done + 0.05 };
}
