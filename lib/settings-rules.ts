// The owner's settings that the loan book's own rules follow, the way pricing is adopted: the server applies them before
// each change, and each browser from its page, so a screen offers what the server will accept.
import { setDrawFees } from "./draw-review";
import { setNfipThrough } from "./florida-insurance";

export type BookRules = { nfipThrough: string; drawFees: { inspector: number; desk: number } };

/** PLACEHOLDER fees for demo seats, so the photo review's price shows: an inspector's visit and a photo review. */
export const DEMO_RULES: BookRules = { nfipThrough: "2026-12-11", drawFees: { inspector: 250, desk: 100 } };

export const rulesFrom = (settings: { nfipAuthorizedThrough: string; drawFeeInspectionCents: number; drawFeeDeskCents: number }): BookRules => ({ nfipThrough: settings.nfipAuthorizedThrough, drawFees: { inspector: settings.drawFeeInspectionCents / 100, desk: settings.drawFeeDeskCents / 100 } });

export function applyRules(rules: BookRules) {
  setNfipThrough(rules.nfipThrough);
  setDrawFees(rules.drawFees);
}
