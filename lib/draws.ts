// Scope of work and construction draws (Spec 7). The release math is the engine's approveDraw; this supplies its inputs
// and decides who has to sign. Competitors' borrowers request draws against an approved, itemized budget, so do these.
import { approveDraw, evaluate, fundedBalances, inBalanceTest, type Product } from "./engine";
import type { Deal, DrawRequest, DrawRequestLine, ScopeLine } from "./mockData";
import { pricingConfig } from "./pricing-config";

const REHAB: [string, string, number][] = [
  ["demolition", "Demolition", 0.06],
  ["structural", "Structural and framing", 0.14],
  ["exterior", "Roof and exterior", 0.14],
  ["plumbing", "Plumbing", 0.1],
  ["electrical", "Electrical", 0.1],
  ["hvac", "HVAC", 0.08],
  ["kitchen", "Kitchen", 0.16],
  ["bathrooms", "Bathrooms", 0.12],
  ["flooring", "Flooring and paint", 0.1],
];
const BUILD: [string, string, number][] = [
  ["site", "Site work and foundation", 0.18],
  ["framing", "Framing and roof", 0.24],
  ["mechanical", "Mechanical, electrical and plumbing", 0.2],
  ["exterior", "Exterior", 0.12],
  ["interior", "Interior finishes", 0.2],
  ["soft", "Permits and soft costs", 0.06],
];

/** A starting budget split into divisions, for the borrower to adjust. Rounded to $100, and always adds up exactly. */
export function defaultScope(product: Product, budget: number, released = 0): ScopeLine[] {
  if (budget <= 0) return [];
  const divisions = product === "ground_up" ? BUILD : REHAB;
  let left = budget;
  let unreleased = released;
  return divisions.map(([id, division, share], index) => {
    const last = index === divisions.length - 1;
    const amount = last ? left : Math.round((budget * share) / 100) * 100;
    const paid = last ? unreleased : Math.min(amount, Math.round((released * share) / 100) * 100);
    left -= amount;
    unreleased -= paid;
    return { id, division, budget: amount, released: paid };
  });
}

export const scopeTotal = (scope: ScopeLine[]) => scope.reduce((sum, line) => sum + line.budget, 0);

/** Why a borrower can't submit this budget yet, or null. It has to add up to the rehab budget in the loan. */
export function scopeError(scope: ScopeLine[], budget: number) {
  const total = scopeTotal(scope);
  if (total !== budget) return `Your budget adds up to $${total.toLocaleString("en-US")}, but this loan's rehab budget is $${budget.toLocaleString("en-US")}.`;
  if (scope.some((line) => line.budget < line.released)) return "A division can't be less than what has already been released.";
  return null;
}

const holdbackLeft = (deal: Deal) => fundedBalances(evaluate(deal.app), deal.app, deal.disbursedDraws).holdbackRemaining;
const lineFor = (deal: Deal, line: DrawRequestLine) => deal.scope?.find((item) => item.id === line.scopeId);

/** Why a borrower can't request this draw yet, or null. */
export function drawRequestError(deal: Deal, lines: DrawRequestLine[]) {
  const asked = lines.filter((line) => line.requested > 0);
  if (!asked.length) return "Enter an amount for at least one budget line.";
  for (const line of asked) {
    const item = lineFor(deal, line);
    if (!item) return "That budget line is no longer on this loan.";
    if (line.requested > item.budget - item.released) return `${item.division} has only $${(item.budget - item.released).toLocaleString("en-US")} left.`;
  }
  const total = asked.reduce((sum, line) => sum + line.requested, 0);
  if (total > holdbackLeft(deal)) return `This loan has only $${holdbackLeft(deal).toLocaleString("en-US")} left to draw.`;
  return null;
}

/** What the inspection supports: the engine's line math, with the retainage held back and the loan's standing checked. */
export function reviewDraw(deal: Deal, draw: DrawRequest) {
  const lines = draw.lines.map((line) => {
    const item = lineFor(deal, line);
    return { budget: item?.budget ?? 0, observedPct: line.observedPct ?? 0, retainagePct: pricingConfig.draws.retainagePct, releasedToDate: item?.released ?? 0, requested: line.requested };
  });
  const costToComplete = (deal.scope ?? []).reduce((sum, item) => sum + item.budget - item.released, 0);
  const { inBalance } = inBalanceTest({ remainingHoldback: holdbackLeft(deal), balancingDeposits: 0, costToComplete });
  return approveDraw(lines, { holdbackRemaining: holdbackLeft(deal), inBalance, loanCurrent: !deal.paymentsLate });
}

/** A large draw needs two people, and so does any draw where the contractor is affiliated with the lender. */
export const approversNeeded = (deal: Deal, amount: number) => (amount > pricingConfig.draws.secondApproverAbove || deal.contractorIsGtAffiliate ? 2 : 1);

export function approvalError(deal: Deal, draw: DrawRequest, approver: string) {
  if (draw.status !== "inspected") return "This draw isn't waiting for approval.";
  if (draw.approvers.includes(approver)) return "A second, different approver is required.";
  const review = reviewDraw(deal, draw);
  if (review.blocked) return `${review.blocked}, so nothing can be released.`;
  if (review.approved <= 0) return "The inspection doesn't support releasing anything yet.";
  return null;
}

/** The scope after a draw is paid: the amount released goes against each line in the order they were requested. */
export function releaseToScope(scope: ScopeLine[], deal: Deal, draw: DrawRequest) {
  const per = reviewDraw(deal, draw).lines;
  let left = draw.approved ?? 0;
  const paid = new Map(draw.lines.map((line, index) => {
    const amount = Math.min(left, per[index].approved);
    left -= amount;
    return [line.scopeId, amount];
  }));
  return scope.map((line) => ({ ...line, released: line.released + (paid.get(line.id) ?? 0) }));
}
