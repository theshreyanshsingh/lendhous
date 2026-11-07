// The borrower's draw from a phone (docs/next-features-prompt.md, N): one budget line at a time, with the camera for each,
// last draw's photo beside the new one, and how far along the borrower says the work is. Then when they'll hear back,
// from the team's draw target in Settings. Pure, so the form, the server and the staff's draw cards agree.
import { isContingency } from "./budget";
import type { Deal, DrawPhoto, DrawRequest, DrawRequestLine } from "./mockData";
import { dueAt, floridaTime, type Target } from "./sla";

/** The lines a borrower can draw on: money left on them, and not the contingency, which moves by change order. */
export const drawableLines = (deal: Pick<Deal, "scope">) => (deal.scope ?? []).filter((line) => line.budget > line.released && !isContingency(line));

/** The newest photos of a line from this loan's earlier draws, to set beside the new ones. */
export function lastPhotos(draws: DrawRequest[], dealId: string, scopeId: string, before?: string): { on: string; photos: DrawPhoto[] } | null {
  const earlier = draws
    .filter((draw) => draw.dealId === dealId && draw.status !== "rejected" && (!before || draw.requestedAt < before) && draw.linePhotos?.some((photo) => photo.scopeId === scopeId))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  return earlier ? { on: earlier.requestedAt, photos: earlier.linePhotos!.filter((photo) => photo.scopeId === scopeId) } : null;
}

/** What one line still needs before the borrower moves on, or null. A line left at $0 is skipped. */
export function lineProblem(line: Pick<DrawRequestLine, "requested" | "claimedPct">, photos: number) {
  if (line.requested <= 0) return "Enter the amount for this line, or go back and leave it out.";
  if (line.claimedPct === undefined || !Number.isFinite(line.claimedPct)) return "Say how far along this work is.";
  if (line.claimedPct < 0 || line.claimedPct > 1) return "How far along is a percent from 0 to 100.";
  if (photos === 0) return "Take at least one photo of this work.";
  return null;
}

/** A percent typed as 0 to 100, as the fraction a line keeps, or undefined while it's blank or not a number. */
export const claimedFrom = (typed: string) => (typed.trim() === "" || !Number.isFinite(Number(typed)) ? undefined : Math.round(Number(typed)) / 100);

/** Whether the team still owes the borrower a decision. */
export const awaitingDecision = (draw: Pick<DrawRequest, "status">) => draw.status === "submitted" || draw.status === "inspecting" || draw.status === "inspected";

/** When the team aims to decide: the draw target from Settings, counted from when the borrower asked. */
export const decideBy = (draw: Pick<DrawRequest, "requestedAt">, target: Target) => dueAt(draw.requestedAt, target);

/** The borrower's words for it. Past the target, they're told someone will be in touch rather than given a time gone by. */
export function decideByText(draw: Pick<DrawRequest, "requestedAt">, target: Target, now: Date) {
  const due = decideBy(draw, target);
  return now > due ? "This is taking longer than we aim for. Your loan officer will be in touch today." : `We'll decide by ${floridaTime(due)}.`;
}

/** The borrower says the line is further along than the inspection found, by more than this (PLACEHOLDER). */
export const CLAIM_GAP = 0.2;
export const claimGap = (line: Pick<DrawRequestLine, "claimedPct" | "observedPct">) => line.claimedPct !== undefined && line.observedPct !== undefined && line.claimedPct - line.observedPct > CLAIM_GAP + 1e-9;
