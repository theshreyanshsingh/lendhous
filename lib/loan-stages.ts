// How a loan moves from application to servicing (Spec 4). Staff move it forward; only the borrower can accept a term
// sheet; and a loan can't clear to close with documents open or its capital not committed.
import { activeWire, wireVerified } from "./closing";
import type { Estimate } from "./engine";
import { ofacBlocker } from "./ofac";
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

/**
 * The loan's next step and what stands in its way. Null once it is in servicing. With today, it also checks that the
 * sanctions screening is recent enough for money to go out.
 */
export function nextStage(deal: Deal, e: Estimate, today?: string): NextStage | null {
  const step = NEXT[deal.status];
  if (!step) return null;
  const blockers: string[] = [];
  // Nobody is underwritten until they've been screened, and no money goes out on an old screening.
  if (step.to === "underwriting") { const blocked = ofacBlocker(deal); if (blocked) blockers.push(blocked); }
  if (step.to === "funded") { const blocked = ofacBlocker(deal, today); if (blocked) blockers.push(blocked); }
  if (step.to === "term_sheet_issued") {
    blockers.push(...e.hardStops);
    if (!deal.creditReview) blockers.push("Credit review isn't signed off (Credit review tab)");
  }
  if (step.to === "clear_to_close") {
    // Signed loan documents come at closing and the recorded mortgage after, so neither holds up clear to close.
    const open = deal.docs.filter((doc) => !doc.stage && doc.status !== "accepted" && doc.status !== "waived").length;
    if (open) blockers.push(`${open} document${open > 1 ? "s" : ""} still open`);
    const allocated = deal.allocations.reduce((sum, item) => sum + item.amount, 0);
    if (allocated !== e.noteAmount) blockers.push("Capital doesn't cover the whole loan yet");
  }
  if ((step.to === "clear_to_close" || step.to === "funded") && deal.capitalStatus !== "committed") blockers.push("Capital isn't committed");
  if (step.to === "funded") {
    const unsigned = deal.docs.filter((doc) => doc.stage === "funding" && doc.status !== "accepted" && doc.status !== "waived");
    if (unsigned.length) blockers.push(`${unsigned.map((doc) => doc.name).join(", ")} not accepted yet`);
  }
  if (step.to === "funded" && !wireVerified(deal)) blockers.push(activeWire(deal) ? "The wire instructions haven't been verified by a call-back (Closing tab)" : "No wire instructions yet (Closing tab)");
  if (step.to === "funded" && (deal.fundingApprovers?.length ?? 0) < 2) blockers.push(`Needs two people to approve funding (${deal.fundingApprovers?.length ?? 0} of 2)`);
  return { ...step, blockers, borrowerStep: deal.status === "term_sheet_issued" };
}

export const canAdvance = (stage: NextStage | null) => Boolean(stage && !stage.borrowerStep && stage.blockers.length === 0);
