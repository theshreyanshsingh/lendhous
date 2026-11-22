// A rehab's pace (docs/feature-ideas-2026-11-22.md, rank 6): how much of the holdback has been drawn against how much of
// the term has passed, when the last draw was asked for, and whether the rest will be drawn before maturity at the rate
// so far. A loan with no draw for weeks is stalled: the borrower is asked for an update with photos, the team sees it on
// its queue, and the partners and buyers who hold it see the pace. Pure.
import { evaluate } from "./engine";
import { holdbackLeft } from "./budget";
import type { Deal, DrawRequest } from "./mockData";
import { addDays, daysBetween, maturityOf } from "./servicing";

/** PLACEHOLDER until GT sets them: days without a draw before a project counts as stalled, and how often it's asked about. */
export const STALL_DAYS = 45;
export const ASK_EVERY_DAYS = 30;
/** PLACEHOLDER: drawn this far behind the share of the term used counts as behind. */
export const BEHIND_BY = 0.25;

const BUILDING = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];
const floridaDay = (at: string) => new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export type PaceState = "on_pace" | "behind" | "stalled";
export type Pace = {
  state: PaceState;
  /** Share of the holdback drawn, and share of the term used, 0 to 1. */
  drawn: number; used: number;
  /** The last draw asked for (or closing, if none), and the days since. */
  lastActivity: string; quietDays: number;
  /** When the rest would be drawn at the rate so far, and whether that's after maturity. */
  finishBy?: string; lateFinish: boolean;
  maturity: string;
};

/** The pace of a funded rehab or construction loan with holdback left, or null for any other loan. */
export function projectPace(deal: Deal, draws: Pick<DrawRequest, "dealId" | "requestedAt" | "status">[], today: string): Pace | null {
  if (!BUILDING.includes(deal.status)) return null;
  const holdback = evaluate(deal.app).holdback;
  const left = holdbackLeft(deal);
  if (holdback <= 0 || left <= 0.5) return null;
  const maturity = maturityOf(deal);
  const term = Math.max(1, daysBetween(deal.closingDate, maturity));
  const sinceClosing = Math.max(0, daysBetween(deal.closingDate, today));
  const drawn = Math.min(1, Math.max(0, (holdback - left) / holdback));
  const used = Math.min(1, sinceClosing / term);
  const asked = draws.filter((draw) => draw.dealId === deal.id && draw.status !== "rejected").map((draw) => floridaDay(draw.requestedAt)).sort();
  const lastActivity = asked.at(-1) && asked.at(-1)! > deal.closingDate ? asked.at(-1)! : deal.closingDate;
  const quietDays = Math.max(0, daysBetween(lastActivity, today));
  // At the rate drawn so far: the days the rest would take.
  const finishBy = drawn > 0 && sinceClosing > 0 ? addDays(today, Math.ceil(((1 - drawn) / drawn) * sinceClosing)) : undefined;
  const lateFinish = Boolean(finishBy && finishBy > maturity) || (drawn === 0 && used >= 0.5);
  const state: PaceState = quietDays >= STALL_DAYS ? "stalled" : drawn + BEHIND_BY < used ? "behind" : "on_pace";
  return { state, drawn, used, lastActivity, quietDays, finishBy, lateFinish, maturity };
}

export const PACE_LABEL: Record<PaceState, string> = { on_pace: "On pace", behind: "Behind", stalled: "Stalled" };

/** The pace in words, for the team, the borrower and the loan's holders alike. */
export function paceWords(pace: Pace) {
  const share = (value: number) => `${Math.round(value * 100)}%`;
  const base = `${share(pace.drawn)} of the rehab budget drawn, ${share(pace.used)} of the term used`;
  if (pace.state === "stalled") return `${base}. No draw asked for in ${pace.quietDays} days.`;
  if (pace.lateFinish) return `${base}. At this rate the work runs past maturity${pace.finishBy ? ` (about ${pace.finishBy})` : ""}.`;
  return `${base}.`;
}

/**
 * Tonight's stalled loans to ask about: stalled, and not asked in the last ASK_EVERY_DAYS. The day goes on the loan
 * (deal.paceAsked) so it's asked once a month, not every night.
 */
export function stalledToAsk(deals: Deal[], draws: Pick<DrawRequest, "dealId" | "requestedAt" | "status">[], today: string) {
  return deals.filter((deal) => {
    if (projectPace(deal, draws, today)?.state !== "stalled") return false;
    const last = deal.paceAsked?.at(-1);
    return !last || daysBetween(last, today) >= ASK_EVERY_DAYS;
  }).map((deal) => deal.id);
}
