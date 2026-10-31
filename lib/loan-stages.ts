// How a loan moves from application to servicing (Spec 4). Staff move it forward; only the borrower can accept a term
// sheet; and a loan can't clear to close with documents open or its capital not committed.
import type { Estimate } from "./engine";
import type { Deal, LoanStatus } from "./mockData";

const NEXT: Partial<Record<LoanStatus, { to: LoanStatus; action: string }>> = {
  submitted: { to: "initial_review", action: "Start initial review" },
  initial_review: { to: "underwriting", action: "Send to underwriting" },
  underwriting: { to: "term_sheet_issued", action: "Issue term sheet" },
  term_sheet_issued: { to: "term_sheet_accepted", action: "Waiting for the borrower to accept" },
  term_sheet_accepted: { to: "conditions", action: "Start clearing conditions" },
  conditions: { to: "clear_to_close", action: "Mark clear to close" },
  clear_to_close: { to: "closing", action: "Send to closing" },
  closing: { to: "funded", action: "Mark funded" },
  funded: { to: "servicing_current", action: "Start servicing" },
};

export type NextStage = { to: LoanStatus; action: string; blockers: string[]; borrowerStep: boolean };

/** The loan's next step and what stands in its way. Null once it is in servicing. */
export function nextStage(deal: Deal, e: Estimate): NextStage | null {
  const step = NEXT[deal.status];
  if (!step) return null;
  const blockers: string[] = [];
  if (step.to === "term_sheet_issued") blockers.push(...e.hardStops);
  if (step.to === "clear_to_close") {
    const open = deal.docs.filter((doc) => doc.status !== "accepted" && doc.status !== "waived").length;
    if (open) blockers.push(`${open} document${open > 1 ? "s" : ""} still open`);
    const allocated = deal.allocations.reduce((sum, item) => sum + item.amount, 0);
    if (allocated !== e.noteAmount) blockers.push("Capital doesn't cover the whole loan yet");
  }
  if ((step.to === "clear_to_close" || step.to === "funded") && deal.capitalStatus !== "committed") blockers.push("Capital isn't committed");
  if (step.to === "funded" && (deal.fundingApprovers?.length ?? 0) < 2) blockers.push(`Needs two people to approve funding (${deal.fundingApprovers?.length ?? 0} of 2)`);
  return { ...step, blockers, borrowerStep: deal.status === "term_sheet_issued" };
}

export const canAdvance = (stage: NextStage | null) => Boolean(stage && !stage.borrowerStep && stage.blockers.length === 0);
