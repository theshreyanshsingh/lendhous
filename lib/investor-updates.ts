// What a loan's investors see of how it's going (docs/competitor-gaps.md, 1.9): a plain status, the way Groundfloor
// reports defaults, and the team's updates on the loan, newest first. Only the partners and buyers who hold the loan see
// either; the borrower and broker never do. Pure.
import type { Deal } from "./mockData";

export type InvestorStatus = "current" | "late" | "default" | "default_late" | "matured" | "workout" | "paid_off";
export const INVESTOR_STATUS: Record<InvestorStatus, string> = { current: "Current", late: "Late", default: "In default", default_late: "In default, payments late", matured: "Matured, not repaid", workout: "In workout", paid_off: "Paid off" };
export const STATUS_TONE: Record<InvestorStatus, "green" | "amber" | "rose" | "slate" | "violet"> = { current: "green", late: "amber", default: "rose", default_late: "rose", matured: "amber", workout: "violet", paid_off: "slate" };

/** A loan's status in an investor's words. A workout the team declared outranks the rest until it's lifted. */
export function investorStatus(deal: Pick<Deal, "status" | "paymentsLate" | "workout">): InvestorStatus {
  if (deal.status === "paid_off") return "paid_off";
  if (deal.workout) return "workout";
  if (deal.status === "default") return deal.paymentsLate ? "default_late" : "default";
  if (deal.status === "matured") return "matured";
  if (deal.status === "servicing_delinquent" || deal.paymentsLate) return "late";
  return "current";
}

/** The team's newest update on a loan for its investors. */
export const latestUpdate = (deal: Pick<Deal, "investorUpdates">) => [...(deal.investorUpdates ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];

/** Why an update can't be posted, or null. */
export function updateProblem(deal: Deal | undefined, text: string) {
  if (!deal) return "That loan no longer exists.";
  if (!["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off"].includes(deal.status)) return "Updates for investors are for funded loans.";
  if (!text.trim()) return "Write the update.";
  return null;
}

/** Why a workout can't be declared or lifted, or null. */
export function workoutProblem(deal: Deal | undefined, on: boolean, note: string) {
  if (!deal) return "That loan no longer exists.";
  if (on && !["servicing_delinquent", "matured", "default"].includes(deal.status)) return "A workout is for a loan that's late, past maturity or in default.";
  if (on && deal.workout) return "This loan is already in a workout.";
  if (!on && !deal.workout) return "This loan isn't in a workout.";
  if (!note.trim()) return on ? "Say what's agreed: a forbearance, a payment plan, a sale." : "Say how the workout ended.";
  return null;
}
