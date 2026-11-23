// The appraisal from order to report (docs/feature-ideas-2026-11-22.md, rank 7). Competitors' borrowers waited weeks with
// no word, paid for an appraisal on a loan that was then declined, and had no way to question a value. So: the order, the
// appraiser's visit and the expected date are on the loan page; nothing is ordered, and no fee taken, until the loan
// checks out; when an appraisal can be reused shows before one is ordered; and a value below plan can be questioned once,
// with up to five sales. Pure, so the reducer, the access rules and the screens all ask the same questions.
import { evaluate } from "./engine";
import type { Deal } from "./mockData";
import { ofacBlocker } from "./ofac";
import { addDays } from "./servicing";
import { isBusinessDay } from "./sla";

/** PLACEHOLDER until GT sets them: sales a second look can cite, how recent they are, the answer time and how long a report stays good. */
export const APPRAISAL_RULES = { reviewSales: 5, salesWithinMonths: 12, answerBusinessDays: 10, reuseDays: 120, maxFee: 5_000 };

/** PLACEHOLDER wording until GT and the attorney approve it: when an appraisal can be reused, shown before one is ordered. */
export const REUSE_POLICY = [
  `An appraisal LendHous orders is good for ${APPRAISAL_RULES.reuseDays} days. If your closing moves within that time, you don't pay for another.`,
  `An appraisal another lender ordered in the last ${APPRAISAL_RULES.reuseDays} days can be used if the appraiser agrees to readdress it to LendHous. Tell us before we order one.`,
  "You get a copy of the report as soon as it's in, whether or not the loan closes.",
];

/** From an accepted term sheet to closing: when an appraisal is ordered and followed. */
export const ORDER_STAGES = ["term_sheet_accepted", "conditions", "clear_to_close", "closing"];
/** When the borrower sees the appraisal card: from the term sheet, so the reuse policy comes before anything is ordered. */
export const TRACKED = ["term_sheet_issued", ...ORDER_STAGES];

export interface AppraisalValues { asIs: number; arv?: number }
export interface CompSale { address: string; price: number; soldOn: string; note: string }
export interface ValueReview {
  reason: string; sales: CompSale[]; by: string; at: string;
  answer?: AppraisalValues & { note: string; by: string; at: string };
}
export interface AppraisalFile {
  ordered: { on: string; firm: string; fee: number; dueOn: string; by: string; at: string };
  /** The appraiser's visit to the property, as set with the borrower. */
  inspectionOn?: string;
  /** Each change to the day the report is expected, with why. The borrower sees them. */
  moves?: { from: string; to: string; reason: string; by: string; at: string }[];
  delivered?: AppraisalValues & { on: string; by: string; at: string };
  review?: ValueReview;
}

const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));
const rehab = (deal: Pick<Deal, "app">) => deal.app.product === "fix_flip" || deal.app.product === "ground_up";
/** Whether this loan's appraisal gives a value after the work too. */
export const needsArv = rehab;
/** A loan valued by a broker's price opinion instead has no appraisal to follow. */
export const appraised = (deal: Pick<Deal, "app">) => deal.app.valuationSource !== "bpo";

/** The values the loan was sized on: the price (or the value given on a refinance) and, on a rehab, the value after the work. */
export function plannedValues(deal: Pick<Deal, "app">): AppraisalValues {
  const asIs = deal.app.purpose === "purchase" ? deal.app.purchasePrice : (deal.app.appraisedAsIs ?? deal.app.purchasePrice);
  return rehab(deal) ? { asIs, arv: deal.app.arv } : { asIs };
}

/** The loan the pricing rules allow at these appraised values, and whether it can be made at all. */
export function loanAt(deal: Pick<Deal, "app">, values: AppraisalValues) {
  const e = evaluate({ ...deal.app, appraisedAsIs: values.asIs, ...(rehab(deal) && values.arv !== undefined ? { arv: values.arv } : {}) });
  return { noteAmount: e.noteAmount, eligible: e.eligible };
}

/** The lowest value, to the $1,000, that keeps the loan at today's amount, with the other value as planned. */
function lowestKeeping(deal: Pick<Deal, "app">, key: keyof AppraisalValues, planned: AppraisalValues, target: number) {
  const keeps = (value: number) => { const at = loanAt(deal, { ...planned, [key]: value }); return at.eligible && at.noteAmount >= target - 0.5; };
  const top = planned[key] ?? 0;
  if (!top || !keeps(top)) return top;
  let low = 0, high = top;
  while (high - low > 1_000) { const mid = Math.floor((low + high) / 2); if (keeps(mid)) high = mid; else low = mid; }
  return Math.ceil(high / 1_000) * 1_000;
}

/** What the appraisal has to come in at for the loan to stay as it is. */
export function valueToKeep(deal: Pick<Deal, "app">): AppraisalValues & { loan: number } {
  const planned = plannedValues(deal);
  const loan = evaluate(deal.app).noteAmount;
  return { loan, asIs: lowestKeeping(deal, "asIs", planned, loan), ...(planned.arv !== undefined ? { arv: lowestKeeping(deal, "arv", planned, loan) } : {}) };
}

/** The values as they stand: the report's, or the answer to a second look if there's been one. */
export const currentValues = (file: AppraisalFile | undefined): AppraisalValues | undefined => file?.review?.answer ?? file?.delivered;

/** The report came in under what the loan was sized on. */
export function belowPlan(deal: Pick<Deal, "app" | "appraisal">) {
  const values = currentValues(deal.appraisal);
  if (!values) return false;
  const planned = plannedValues(deal);
  return values.asIs < planned.asIs || (planned.arv !== undefined && values.arv !== undefined && values.arv < planned.arv);
}

export type OrderCheck = { key: "terms" | "pricing" | "ofac"; label: string; ok: boolean; note?: string };

/**
 * What has to be true before anyone pays for an appraisal: the borrower took the terms, the loan fits the pricing rules
 * as it stands, and nobody on it is on the sanctions list. A borrower shouldn't pay $750 for an appraisal on a loan that
 * was never going to close.
 */
export function orderChecks(deal: Deal): OrderCheck[] {
  const e = evaluate(deal.app);
  const ofac = ofacBlocker(deal);
  return [
    { key: "terms", label: "The borrower accepted the term sheet", ok: ORDER_STAGES.includes(deal.status) },
    { key: "pricing", label: "The loan fits the pricing rules as it stands", ok: e.eligible, ...(e.hardStops.length ? { note: e.hardStops.join("; ") } : {}) },
    { key: "ofac", label: "Everyone on it is clear of the sanctions list", ok: !ofac, ...(ofac ? { note: ofac } : {}) },
  ];
}

export type OrderInput = { on: string; firm: string; fee: number; dueOn: string };

/** Why the appraisal can't be ordered as entered, or null. */
export function orderProblem(deal: Deal, input: OrderInput, today: string): string | null {
  if (!appraised(deal)) return "This loan is valued by a broker's price opinion, not an appraisal.";
  if (deal.appraisal) return "The appraisal is already ordered. Change its dates below.";
  const failed = orderChecks(deal).find((check) => !check.ok);
  if (failed) return `Not yet: ${failed.label.charAt(0).toLowerCase()}${failed.label.slice(1)} isn't true${failed.note ? ` (${failed.note})` : ""}.`;
  if (!input.firm.trim()) return "Add the appraisal firm.";
  if (input.firm.length > 160) return "Keep the firm's name under 160 characters.";
  if (!isDay(input.on) || input.on > today) return "Enter the day it was ordered, today or earlier.";
  if (!Number.isFinite(input.fee) || input.fee < 0 || input.fee > APPRAISAL_RULES.maxFee) return `Enter the fee, up to $${APPRAISAL_RULES.maxFee.toLocaleString("en-US")}.`;
  if (!isDay(input.dueOn) || input.dueOn < input.on) return "Enter the day the report is expected, on or after the order.";
  return null;
}

export type DatesInput = { inspectionOn?: string; dueOn?: string; reason: string };

/** Why the visit or expected day can't be changed like this, or null. A later report needs a reason the borrower sees. */
export function datesProblem(deal: Pick<Deal, "appraisal">, input: DatesInput): string | null {
  const file = deal.appraisal;
  if (!file) return "Order the appraisal first.";
  if (file.delivered) return "The report is already in.";
  if (input.inspectionOn === undefined && input.dueOn === undefined) return "Change the visit or the expected day.";
  if (input.inspectionOn !== undefined && (!isDay(input.inspectionOn) || input.inspectionOn < file.ordered.on)) return "Enter the visit's day, on or after the order.";
  if (input.dueOn !== undefined) {
    if (!isDay(input.dueOn) || input.dueOn < file.ordered.on) return "Enter the day the report is expected, on or after the order.";
    if (input.dueOn !== file.ordered.dueOn && !input.reason.trim()) return "Say why the report's day moved: the borrower sees it.";
  }
  if (input.reason.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

/** Why the report can't be recorded as entered, or null. */
export function deliveredProblem(deal: Pick<Deal, "app" | "appraisal">, input: AppraisalValues & { on: string }, today: string): string | null {
  const file = deal.appraisal;
  if (!file) return "Order the appraisal first.";
  if (file.delivered) return "The report is already recorded.";
  if (!isDay(input.on) || input.on > today || input.on < file.ordered.on) return "Enter the day the report came in, between the order and today.";
  if (!Number.isFinite(input.asIs) || input.asIs <= 0) return "Enter the value as it is today.";
  if (needsArv(deal) && (input.arv === undefined || !Number.isFinite(input.arv) || input.arv <= 0)) return "Enter the value after the work.";
  return null;
}

const monthsBefore = (day: string, months: number) => { const at = new Date(`${day}T12:00:00Z`); at.setUTCMonth(at.getUTCMonth() - months); return at.toISOString().slice(0, 10); };

/** Why a second look can't be asked for like this, or null. Once per appraisal, on a value under plan. */
export function reviewProblem(deal: Pick<Deal, "app" | "appraisal" | "status">, input: { reason: string; sales: CompSale[] }, today: string): string | null {
  const file = deal.appraisal;
  if (!ORDER_STAGES.includes(deal.status)) return "A second look is asked for before closing.";
  if (!file?.delivered) return "Ask once the report is in.";
  if (file.review) return "A second look has already been asked for on this appraisal.";
  if (!belowPlan(deal)) return "The appraisal supports the loan as planned.";
  if (!input.reason.trim()) return "Say why the value looks low.";
  if (input.reason.length > 1000) return "Keep it under 1,000 characters.";
  if (!input.sales.length) return "Add at least one sale to compare with.";
  if (input.sales.length > APPRAISAL_RULES.reviewSales) return `Add up to ${APPRAISAL_RULES.reviewSales} sales.`;
  const since = monthsBefore(today, APPRAISAL_RULES.salesWithinMonths);
  for (const sale of input.sales) {
    if (!sale.address.trim() || sale.address.length > 200) return "Give each sale's address.";
    if (!Number.isFinite(sale.price) || sale.price <= 0) return `Give the price ${sale.address.trim()} sold for.`;
    if (!isDay(sale.soldOn) || sale.soldOn > today || sale.soldOn < since) return `${sale.address.trim()} has to have sold in the last ${APPRAISAL_RULES.salesWithinMonths} months.`;
    if (sale.note.length > 300) return "Keep each sale's note under 300 characters.";
  }
  return null;
}

/** Why the second look can't be answered like this, or null. */
export function answerProblem(deal: Pick<Deal, "app" | "appraisal">, input: AppraisalValues & { note: string }): string | null {
  const review = deal.appraisal?.review;
  if (!review) return "Nobody has asked for a second look.";
  if (review.answer) return "It's already answered.";
  if (!Number.isFinite(input.asIs) || input.asIs <= 0) return "Enter the value as it is today, after the second look.";
  if (needsArv(deal) && (input.arv === undefined || !Number.isFinite(input.arv) || input.arv <= 0)) return "Enter the value after the work, after the second look.";
  if (!input.note.trim()) return "Say what the appraiser said: the borrower sees it.";
  if (input.note.length > 1000) return "Keep it under 1,000 characters.";
  return null;
}

/** The day a second look is promised by: APPRAISAL_RULES.answerBusinessDays Florida business days after it was asked. */
export function answerDueOn(askedOn: string) {
  let day = askedOn;
  for (let counted = 0; counted < APPRAISAL_RULES.answerBusinessDays;) { day = addDays(day, 1); if (isBusinessDay(day)) counted++; }
  return day;
}

/** Where the appraisal stands, in a word, for badges and lists. */
export function appraisalStage(file: AppraisalFile | undefined, today: string): "not_ordered" | "ordered" | "late" | "in" | "review" {
  if (!file) return "not_ordered";
  if (file.review && !file.review.answer) return "review";
  if (file.delivered) return "in";
  return file.ordered.dueOn < today ? "late" : "ordered";
}
export const STAGE_LABEL = { not_ordered: "Not ordered", ordered: "Ordered", late: "Running late", in: "Report in", review: "Second look asked" } as const;
