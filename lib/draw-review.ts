// Checking a draw's work two ways (docs/competitor-gaps-2026-11-09.md, rank 4). An inspector's visit takes about two
// business days; the team reviewing the borrower's own photos at a desk can decide the same day, as CIVIC's Snap Draws and
// Kiavi's most common draws do. The borrower picks, where the draw qualifies: a single home, a modest amount, photos of
// every line taken at the property and not seen before, a loan that's current, and nothing an inspector found off before.
// The team can still send a photo review on to an inspector, saying why. Each way has its own fee, kept from the money
// released, which an owner sets in Settings. Pure, given those fees.
import type { Book } from "./book";
import { claimGap } from "./draw-walk";
import { fundedBalances, evaluate } from "./engine";
import type { Deal, DrawPhoto, DrawRequest, DrawRequestLine } from "./mockData";
import { photoCheck, reusedPhotos } from "./photo-checks";

export type DrawPath = NonNullable<DrawRequest["path"]>;
export const PATH_LABEL: Record<DrawPath, string> = { desk: "Photo review", inspector: "Inspector visit" };

/** What each way of checking a draw costs the borrower, in dollars. Set from Settings; 0 charges nothing. */
let fees: Record<DrawPath, number> = { inspector: 0, desk: 0 };
export const drawFees = () => fees;
export const setDrawFees = (next: Record<DrawPath, number>) => { fees = { inspector: Math.max(0, Number(next.inspector) || 0), desk: Math.max(0, Number(next.desk) || 0) }; };

/** PLACEHOLDER until GT sets them: the most a photo review can release at once, and the photos each line needs for one. */
export const DESK = { maxDraw: 35_000, photosPerLine: 2 };

const money = (amount: number) => `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
type Photo = Pick<DrawPhoto, "scopeId" | "lat" | "lng" | "takenAt" | "sha256" | "dhash"> & { id?: string; at?: string };

/**
 * Why this draw can't be checked from the borrower's photos alone, or null when it can. The same answer on the borrower's
 * phone, which only offers the choice when it's null, and on the server, which refuses a photo review otherwise.
 */
export function deskProblem(book: Pick<Book, "deals" | "draws" | "photoRequests">, deal: Deal, lines: Pick<DrawRequestLine, "scopeId" | "requested">[], photos: Photo[], at: string): string | null {
  if (deal.app.propertyType === "2_4") return "A building with 2 to 4 units gets an inspector's visit.";
  if (deal.contractorIsGtAffiliate) return "An affiliated contractor's work gets an independent inspector.";
  // After a storm passes over the property, an inspector sees it before photos alone are relied on again.
  const hold = deal.stormHold;
  if (hold && !book.draws.some((draw) => draw.dealId === deal.id && draw.inspection && draw.inspection.method !== "desk" && draw.inspection.at >= hold.passedAt)) return `${hold.name} has passed since an inspector last saw the property, so an inspector looks first.`;
  if (deal.status !== "funded" && deal.status !== "servicing_current") return "While the loan is behind, draws get an inspector's visit.";
  const total = lines.reduce((sum, line) => sum + line.requested, 0);
  if (total > DESK.maxDraw) return `A photo review is for draws up to ${money(DESK.maxDraw)}.`;
  const left = fundedBalances(evaluate(deal.app), deal.app, deal.disbursedDraws).holdbackRemaining;
  if (total >= left - 0.5) return "The last draw gets an inspector's visit to confirm the work is finished.";
  if (lines.some((line) => photos.filter((photo) => photo.scopeId === line.scopeId).length < DESK.photosPerLine)) return `A photo review needs at least ${DESK.photosPerLine} photos of each line.`;
  if (!deal.geo) return "The property isn't on the map yet, so the photos' locations can't be checked.";
  const checks = photos.map((photo) => photoCheck({ ...photo, at: photo.at ?? at }, deal.geo));
  if (checks.some((check) => !check.located)) return "Every photo needs the phone's location: allow it when you take them.";
  if (checks.some((check) => check.far || check.old)) return "Some photos weren't taken at the property just now.";
  if (reusedPhotos(book, photos.map((photo, index) => ({ ...photo, id: photo.id ?? `new-${index}` }))).length) return "Some photos match photos already sent.";
  if (book.draws.some((draw) => draw.dealId === deal.id && draw.lines.some(claimGap))) return "An earlier inspection found less work done than claimed, so draws on this loan get an inspector.";
  return null;
}

/** What the borrower receives for a draw once it's released: what was approved, less the fee for checking it. */
export const toSend = (draw: Pick<DrawRequest, "approved" | "fee">) => Math.max(0, Math.round(((draw.approved ?? 0) - (draw.fee ?? 0)) * 100) / 100);

/** Why the team can't record a photo review of this draw, or null. */
export function deskReviewProblem(draw: DrawRequest, observed: Record<string, number>) {
  if (draw.path !== "desk") return "This draw is for an inspector.";
  if (draw.status !== "submitted") return "This draw has already been reviewed.";
  if (draw.lines.some((line) => !Number.isFinite(observed[line.scopeId]) || observed[line.scopeId] < 0 || observed[line.scopeId] > 1)) return "Enter how far along each line is, from the photos.";
  return null;
}
