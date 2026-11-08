// A loan's journey for the loan pages: when it reached each step (from deal.stages), how long each took, where it is
// today, the target closing date, and its draws and maturity after funding.
import type { Deal, DrawRequest, LoanStatus } from "./mockData";
import { PRE_FUNDING } from "./loan-exits";
import { ledger, SERVICED } from "./servicing";

export const MILESTONES: { label: string; statuses: LoanStatus[] }[] = [
  { label: "Applied", statuses: ["submitted"] },
  { label: "Underwriting", statuses: ["initial_review", "underwriting"] },
  { label: "Term sheet", statuses: ["term_sheet_issued", "term_sheet_accepted"] },
  { label: "Conditions", statuses: ["conditions"] },
  { label: "Clear to close", statuses: ["clear_to_close", "closing"] },
  { label: "Funded", statuses: ["funded", ...(SERVICED as LoanStatus[])] },
];

export type TimelinePoint = { label: string; on?: string; days?: number; state: "done" | "now" | "next"; target?: boolean };
export type Timeline = { points: TimelinePoint[]; draws: { on: string; amount: number }[] };

/** The calendar day a timestamp fell on in Florida, or the day itself. */
export const floridaDay = (at: string) => (/^\d{4}-\d{2}-\d{2}$/.test(at) ? at : new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
const between = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** Null for an application that ended before funding. today is "" before the browser knows it; then no running count. */
export function loanTimeline(deal: Deal, draws: DrawRequest[], today: string): Timeline | null {
  if (deal.status === "declined" || deal.status === "withdrawn") return null;
  const stages = deal.stages ?? [];
  const reached = (statuses: LoanStatus[]) => stages.filter((stage) => statuses.includes(stage.status)).map((stage) => floridaDay(stage.at)).sort()[0];
  const paidOff = deal.status === "paid_off";
  // A loan ends paid off, or foreclosed with the property LendHous's (lib/collections.ts).
  const ended = paidOff || deal.status === "reo";
  const current = ended ? MILESTONES.length : Math.max(0, MILESTONES.findIndex((step) => step.statuses.includes(deal.status)));
  const points: TimelinePoint[] = MILESTONES.map((step, i) => ({ label: step.label, on: i <= current ? reached(step.statuses) : undefined, state: i < current ? "done" : i === current ? "now" : "next" }));
  if (paidOff) points.push({ label: "Paid off", on: reached(["paid_off"]) ?? deal.paidOff?.receivedOn, state: "now" });
  if (deal.status === "reo") points.push({ label: "Bank-owned", on: deal.reo?.since, state: "now" });
  // Each step lasted until the next one with a date, and the current step until today.
  points.forEach((point, i) => {
    if (!point.on) return;
    const after = points.slice(i + 1).find((later) => later.on && later.state !== "next")?.on;
    const end = after ?? (point.state === "now" && today && !ended && current < MILESTONES.length - 1 ? today : undefined);
    if (end) point.days = between(point.on, end);
  });
  const funded = points[MILESTONES.length - 1];
  if (PRE_FUNDING.includes(deal.status) && deal.closingDate) Object.assign(funded, { on: deal.closingDate, target: true });
  if (SERVICED.includes(deal.status)) points.push({ label: "Matures", on: ledger(deal).maturity, state: "next" });
  const paid = draws.filter((draw) => draw.dealId === deal.id && draw.status === "funded" && draw.fundedAt).map((draw) => ({ on: floridaDay(draw.fundedAt!), amount: draw.approved ?? draw.lines.reduce((sum, line) => sum + line.requested, 0) }));
  return { points, draws: paid.sort((a, b) => a.on.localeCompare(b.on)) };
}
