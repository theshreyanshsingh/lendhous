// A condo building check (docs/competitor-gaps-2026-11-09.md, rank 12). Since Surfside, Florida makes a condo building of
// three stories or more have a milestone inspection by December 31 of the year it turns 30 (25 where the local building
// department says so, near salt water for one), and every 10 years after; a phase 2 where phase 1 finds substantial
// structural deterioration, with repairs started within 365 days of its report (Fla. Stat. 553.899). The association
// also needs a structural integrity reserve study every 10 years (718.112(2)(g)), and one of 25 or more units posts its
// records on a website (718.111(12)(g)). HB 913 (ch. 2025-175) lets an association pause reserves while it repairs and
// borrow for repairs. These decide what a building will cost its owners, so the processor records them for every condo
// loan before it clears to close. The rules below are from LendHous's notes; the attorney confirms them (PLACEHOLDER
// dates), and buildings that turned 30 before July 1, 2022 had until the end of 2024.
import type { CondoFile, Deal } from "./mockData";
import { evaluate } from "./engine";

/** PLACEHOLDER until the attorney confirms them. */
export const CONDO_RULES = { stories: 3, milestoneYears: 30, earlyYears: 25, everyYears: 10, catchUpBy: "2024-12-31", catchUpFrom: "2022-07-01", firstSirsBy: "2025-12-31", repairDays: 365, websiteUnits: 25 };

const yearEnd = (year: number) => `${year}-12-31`;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The milestone inspection the building has to have had by now: the latest due date that has passed, or the first one
 * if none has. Null below three stories. Due dates are the end of the year it turns 30 (or 25), then every 10 years.
 */
export function milestoneDue(file: Pick<CondoFile, "stories" | "coYear" | "at25">, today: string) {
  if (file.stories < CONDO_RULES.stories) return null;
  const turns = file.coYear + (file.at25 ? CONDO_RULES.earlyYears : CONDO_RULES.milestoneYears);
  // A building that reached the age before the law took effect had until the catch-up date.
  let due = turns < Number(CONDO_RULES.catchUpFrom.slice(0, 4)) ? CONDO_RULES.catchUpBy : yearEnd(turns);
  while (yearEnd(Number(due.slice(0, 4)) + CONDO_RULES.everyYears) < today) due = yearEnd(Number(due.slice(0, 4)) + CONDO_RULES.everyYears);
  return due;
}

export type CondoState = "not_recorded" | "current" | "repairs_pending" | "overdue";
export type CondoFlag = { level: "bad" | "warn" | "note"; text: string };

/** The building's status and what to know about it, worst first. */
export function condoCheck(deal: Pick<Deal, "app" | "condo">, today: string): { state: CondoState; flags: CondoFlag[] } {
  const file = deal.condo;
  if (!file) return { state: "not_recorded", flags: [] };
  const flags: CondoFlag[] = [];
  let overdue = false;
  let pending = false;
  const due = milestoneDue(file, today);
  if (due) {
    // An inspection counts for the cycle that ends at its due date.
    const done = file.milestone?.phase1On && file.milestone.phase1On > addDays(due, -CONDO_RULES.everyYears * 365 - 3);
    if (!done && due < today) { overdue = true; flags.push({ level: "bad", text: `Its milestone inspection was due by ${longDay(due)} and isn't on file.` }); }
    else if (!done) flags.push({ level: "warn", text: `Its milestone inspection is due by ${longDay(due)}.` });
    else flags.push({ level: "note", text: `Milestone inspection done ${longDay(file.milestone!.phase1On!)}; the next is due by ${longDay(yearEnd(Number(due.slice(0, 4)) + CONDO_RULES.everyYears))}.` });
    const phase2 = file.milestone?.phase2On;
    if (phase2 && !file.milestone?.repairsDone) {
      const startBy = addDays(phase2, CONDO_RULES.repairDays);
      if (startBy < today) { overdue = true; flags.push({ level: "bad", text: `Phase 2 found structural repairs on ${longDay(phase2)}; they had to start by ${longDay(startBy)} and aren't recorded done.` }); }
      else { pending = true; flags.push({ level: "warn", text: `Phase 2 found structural repairs on ${longDay(phase2)}; they have to start by ${longDay(startBy)}.` }); }
    }
    const sirsCurrent = file.sirsOn && file.sirsOn > addDays(today, -CONDO_RULES.everyYears * 365 - 3);
    if (!sirsCurrent && today > CONDO_RULES.firstSirsBy) { overdue = true; flags.push({ level: "bad", text: "No structural integrity reserve study from the last 10 years is on file; the first was due by the end of 2025." }); }
    else if (!sirsCurrent) flags.push({ level: "warn", text: "Its structural integrity reserve study is due by the end of 2025." });
  } else flags.push({ level: "note", text: `Under ${CONDO_RULES.stories} stories: no milestone inspection or reserve study is required.` });
  if (file.reservesPaused) { pending = true; flags.push({ level: "warn", text: "The association has paused its reserve contributions while it repairs." }); }
  if (file.associationLoan) flags.push({ level: "warn", text: "The association has a loan or credit line, which owners repay through their dues." });
  if (file.assessment?.monthly) {
    const app = { ...deal.app, hoaMonthly: (deal.app.hoaMonthly ?? 0) + file.assessment.monthly };
    const dscr = deal.app.product === "dscr" ? evaluate(app).ratios.find((ratio) => ratio.key === "dscr")?.actual : undefined;
    flags.push({ level: "warn", text: `A special assessment of $${file.assessment.monthly.toLocaleString("en-US")} a month${file.assessment.endsOn ? ` through ${longDay(file.assessment.endsOn)}` : ""}${dscr !== undefined ? `: with it, the rent covers the payment ${dscr.toFixed(2)} times` : ""}.` });
  }
  if (file.units >= CONDO_RULES.websiteUnits && !file.websitePosted) flags.push({ level: "warn", text: `An association of ${CONDO_RULES.websiteUnits} or more units has to post its records on a website; this one doesn't.` });
  const order = { bad: 0, warn: 1, note: 2 };
  return { state: overdue ? "overdue" : pending ? "repairs_pending" : "current", flags: flags.sort((a, b) => order[a.level] - order[b.level]) };
}

export const CONDO_STATE: Record<CondoState, string> = { not_recorded: "Not recorded", current: "Current", repairs_pending: "Repairs pending", overdue: "Overdue" };

/** A condo loan clears to close only once its building has been checked. */
export const condoBlocker = (deal: Pick<Deal, "app" | "condo">) => (deal.app.propertyType === "condo" && !deal.condo ? "Record the condo building check (Score & Flags)" : null);

export type CondoInput = Omit<CondoFile, "by" | "at">;

/** Why the building can't be saved as entered, or null. */
export function condoProblem(deal: Pick<Deal, "app"> | undefined, input: CondoInput, today: string) {
  if (!deal) return "That loan no longer exists.";
  if (deal.app.propertyType !== "condo") return "This loan isn't on a condo.";
  if (!input.association.trim()) return "Add the association's name.";
  if (!Number.isInteger(input.stories) || input.stories < 1 || input.stories > 120) return "Enter the building's habitable stories.";
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > 5000) return "Enter the units in the association.";
  if (!Number.isInteger(input.coYear) || input.coYear < 1900 || input.coYear > Number(today.slice(0, 4))) return "Enter the year of the certificate of occupancy.";
  for (const day of [input.milestone?.phase1On, input.milestone?.phase2On, input.sirsOn]) if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today)) return "Inspection and study dates are today or earlier.";
  if (input.milestone?.phase2On && !input.milestone.phase1On) return "A phase 2 follows a phase 1: add its date.";
  if (input.assessment && !(input.assessment.monthly > 0)) return "Enter the unit's monthly share of the assessment, or take it off.";
  return null;
}
