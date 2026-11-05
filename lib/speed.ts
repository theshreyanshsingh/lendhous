// How fast the team works against its targets, for the reports: the median and the slowest wait in the period for each
// kind of work, by loan officer. A wait counts in the period it ended in.
import type { Book } from "./book";
import type { Period } from "./reports";
import { businessHoursBetween, SLA_TARGETS, type SlaKey, type Targets } from "./sla";
import { servicingDate } from "./servicing";

export type Wait = { key: SlaKey; officer: string; hours: number };
export type Cell = { count: number; median: number; slowest: number; met: number };
const TIMED: SlaKey[] = ["firstLook", "termSheet", "drawDecision"];

/** Every finished wait the book can time: a new application looked at, a term sheet sent, a draw decided. */
export function waitsIn(book: Book, period: Period, targets: Targets = SLA_TARGETS): Wait[] {
  const inPeriod = (at: string) => { const day = servicingDate(new Date(at)); return day >= period.from && day <= period.to; };
  const hours = (key: SlaKey, from: string, to: string) => (targets[key].business ? businessHoursBetween(new Date(from), new Date(to)) : Math.max(0, (Date.parse(to) - Date.parse(from)) / 3_600_000));
  const waits: Wait[] = [];
  for (const deal of book.deals) {
    const officer = deal.team?.officer?.name ?? "No loan officer";
    const stages = deal.stages ?? [];
    const submitted = stages.find((stage) => stage.status === "submitted");
    const next = submitted && stages.find((stage) => stage.at > submitted.at && stage.status !== "submitted");
    if (submitted && next && inPeriod(next.at)) waits.push({ key: "firstLook", officer, hours: hours("firstLook", submitted.at, next.at) });
    const sheet = deal.termSheets?.[0];
    const ready = deal.completed?.at ?? stages.find((stage) => stage.status === "underwriting")?.at;
    if (sheet && ready && sheet.issuedAt > ready && inPeriod(sheet.issuedAt)) waits.push({ key: "termSheet", officer, hours: hours("termSheet", ready, sheet.issuedAt) });
    for (const draw of book.draws.filter((item) => item.dealId === deal.id && item.decidedAt && inPeriod(item.decidedAt))) waits.push({ key: "drawDecision", officer, hours: hours("drawDecision", draw.requestedAt, draw.decidedAt!) });
  }
  return waits;
}

function cell(values: number[], target: number): Cell {
  if (!values.length) return { count: 0, median: 0, slowest: 0, met: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: values.length, median, slowest: sorted.at(-1)!, met: values.filter((value) => value <= target).length };
}

/** The scoreboard: each kind of work overall and by loan officer, against its target. */
export function speedScoreboard(book: Book, period: Period, targets: Targets = SLA_TARGETS) {
  const waits = waitsIn(book, period, targets);
  const measures = TIMED.map((key) => ({ key, target: targets[key], overall: cell(waits.filter((wait) => wait.key === key).map((wait) => wait.hours), targets[key].hours) }));
  const officers = [...new Set(waits.map((wait) => wait.officer))].sort();
  const byOfficer = officers.map((name) => ({ name, cells: Object.fromEntries(TIMED.map((key) => [key, cell(waits.filter((wait) => wait.officer === name && wait.key === key).map((wait) => wait.hours), targets[key].hours)])) as Record<SlaKey, Cell> }));
  return { measures, byOfficer };
}

/** A wait in words: "3.5 business hours", "2 days". */
export function hoursText(hours: number, business: boolean) {
  if (business && hours >= 16) return `${Math.round((hours / 8) * 10) / 10} business days`;
  if (!business && hours >= 48) return `${Math.round((hours / 24) * 10) / 10} days`;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}${business ? " business" : ""} hour${rounded === 1 ? "" : "s"}`;
}
