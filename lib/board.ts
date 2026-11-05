// The pipeline as a board: a column per stage up to closing. Dropping a card on a column only does what the loan's
// next step allows, with the same checks as the loan page's button; anything else says why not.
import type { Estimate } from "./engine";
import { canAdvance, nextStage } from "./loan-stages";
import { pipelineStages, type Deal, type LoanStatus } from "./mockData";

/** The board's columns: every stage before funding. */
export const BOARD_COLUMNS = pipelineStages.slice(0, 8);
const label = (code: LoanStatus) => pipelineStages.find((stage) => stage.code === code)?.label.toLowerCase() ?? code;

/** Whether a loan can move to a column, or why not. */
export function boardMove(deal: Deal, e: Estimate, to: LoanStatus, today?: string): { ok: true } | { ok: false; why: string } {
  if (deal.status === to) return { ok: false, why: `${deal.loanNumber} is already there.` };
  const step = nextStage(deal, e, today);
  if (!step) return { ok: false, why: `${deal.loanNumber} has no next step on the board.` };
  if (step.to !== to) return { ok: false, why: `${deal.loanNumber} moves one step at a time: next is ${label(step.to)}.` };
  if (to === "term_sheet_issued") return { ok: false, why: "Build the term sheet on the loan page to send it." };
  if (step.borrowerStep) return { ok: false, why: `That step is the borrower's: ${step.next}.` };
  if (!canAdvance(step)) return { ok: false, why: `Not yet: ${step.blockers[0]}.` };
  return { ok: true };
}
