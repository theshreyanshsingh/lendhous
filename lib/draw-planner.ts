// The borrower's draw cash planner (docs/feature-ideas-2026-11-22.md, rank 8). Draws pay back work already done, so a
// borrower fronts each stage before its draw comes in. "100% of rehab financed" still means carrying a stage at a time.
// This works out how much, for how long, and what the draw fees add up to, for the number of draws they plan. Pure.
import { evaluate } from "./engine";
import { holdbackLeft } from "./budget";
import { DESK, drawFees } from "./draw-review";
import type { Deal } from "./mockData";
import { SLA_TARGETS, type Targets } from "./sla";

/** PLACEHOLDER: business days an inspector's visit takes before the draw can be decided, as lib/draw-review.ts says. */
export const INSPECTION_DAYS = 2;
export const DRAW_CHOICES = [2, 3, 4, 5, 6, 8] as const;

export type DrawPlan = {
  /** What's left to draw, and how many draws it's split into. */
  left: number; draws: number;
  /** About what each stage costs the borrower before its draw pays it back. */
  perDraw: number;
  /** Business days from asking to the money: a photo review where the draw qualifies, an inspector's visit otherwise. */
  days: { desk?: number; inspector: number };
  /** The fees for checking every draw, the way each would be checked. */
  fees: number;
  /** Cash to close plus the first stage: what the borrower needs on hand to start. Before funding only. */
  toStart?: number;
};

const SINGLE_HOMES = ["sfr", "condo", "townhome"];

/** The plan for splitting what's left of the holdback into this many draws. Null for a loan with no holdback left. */
export function drawPlan(deal: Deal, draws: number, targets: Targets = SLA_TARGETS): DrawPlan | null {
  const estimate = evaluate(deal.app);
  const funded = !["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"].includes(deal.status);
  const left = funded ? holdbackLeft(deal) : estimate.holdback;
  if (left <= 0.5 || draws < 1) return null;
  const perDraw = Math.round(left / draws);
  const decision = Math.max(1, Math.ceil(targets.drawDecision.business ? targets.drawDecision.hours / 8 : targets.drawDecision.hours / 24));
  // A photo review is open to a single home's draws up to the desk's limit (lib/draw-review.ts); anything else gets a visit.
  const desk = SINGLE_HOMES.includes(deal.app.propertyType) && perDraw <= DESK.maxDraw;
  const fee = desk ? drawFees().desk : drawFees().inspector;
  return { left, draws, perDraw, days: { ...(desk ? { desk: decision } : {}), inspector: decision + INSPECTION_DAYS }, fees: fee * draws, ...(funded ? {} : { toStart: estimate.cashToClose + perDraw }) };
}

/** The same holdback split a few ways, to compare carrying cost against fees. */
export const planChoices = (deal: Deal, targets: Targets = SLA_TARGETS) => DRAW_CHOICES.map((count) => drawPlan(deal, count, targets)).filter((plan): plan is DrawPlan => Boolean(plan));
