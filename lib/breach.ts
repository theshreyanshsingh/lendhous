// Security incidents and Florida's breach notices (docs/competitor-gaps-2026-11-09.md, rank 19; Fla. Stat. 501.171).
// LendHous holds Social Security numbers, birth dates and bank details. If they're breached, each Floridian affected is
// told within 30 days of LendHous finding it or having reason to believe it, by mail or email, with the dates, what was
// taken and who to contact; the Department of Legal Affairs within 30 days too, once 500 or more Floridians are affected;
// and the nationwide credit bureaus without unreasonable delay, once more than 1,000 people are told at once. Writing to
// the Department with good cause within those 30 days buys 15 more days for the people; a law enforcement agency's written
// request delays it. If, after investigating and talking to law enforcement, LendHous reasonably decides nobody is likely
// to suffer identity theft or other financial harm, it doesn't notify the people, but keeps that decision in writing for
// five years and sends it to the Department within 30 days. A vendor that's breached (a third-party agent) has 10 days to
// tell LendHous. This keeps the incident, works out each deadline, and logs the security steps taken. Pure.

export const BREACH_RULES = { noticeDays: 30, goodCauseDays: 15, departmentAt: 500, bureausOver: 1000, agentDays: 10, keepYears: 5 };

export const DATA_KINDS = {
  ssn: "Social Security numbers",
  dob: "Birth dates",
  bank: "Bank account or card numbers",
  id_card: "Driver's license, passport or other ID numbers",
  login: "Usernames or emails with passwords",
  financial: "Financial records (statements, tax returns)",
  health: "Medical or health insurance information",
  other: "Other personal information",
} as const;
export type DataKind = keyof typeof DATA_KINDS;

export type IncidentStep = "individuals" | "department" | "goodCause" | "determination" | "bureaus" | "closed";
export type Incident = {
  id: string; title: string;
  /** The day LendHous determined there was a breach, or had reason to believe one occurred: the clocks start here. */
  discoveredOn: string;
  occurredFrom?: string; occurredTo?: string;
  /** Found by LendHous, or reported by a vendor holding its data (a third-party agent), and when that vendor told it. */
  source: "lendhous" | "agent"; agent?: string; agentFoundOn?: string; agentToldOn?: string;
  synopsis: string; dataKinds: DataKind[];
  /** People in Florida whose information was, or is reasonably believed to have been, accessed; and everyone told. */
  floridians: number; notified?: number;
  /** "unlikely": after investigating and consulting law enforcement, no identity theft or financial harm is likely. */
  harm: "undetermined" | "likely" | "unlikely";
  harmDecidedOn?: string; harmReason?: string;
  lawDelay?: { agency: string; until: string };
  done: Partial<Record<IncidentStep, string>>;
  measures: { on: string; text: string; by: string }[];
  by: string; at: string;
};

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const isDay = (day: string | undefined) => Boolean(day && /^\d{4}-\d{2}-\d{2}$/.test(day));

export type Duty = { key: IncidentStep; label: string; why: string; due?: string; doneOn?: string; state: "done" | "due" | "overdue" | "waiting"; daysLeft?: number };

/** What the law asks of LendHous for this incident, with each deadline and where it stands. */
export function breachDuties(incident: Incident, today: string): Duty[] {
  const duties: Duty[] = [];
  const thirty = addDays(incident.discoveredOn, BREACH_RULES.noticeDays);
  const stateOf = (key: IncidentStep, due?: string): Pick<Duty, "state" | "doneOn" | "daysLeft"> => {
    const doneOn = incident.done[key];
    if (doneOn) return { state: "done", doneOn };
    if (!due) return { state: "waiting" };
    const daysLeft = daysUntil(today, due);
    return { state: daysLeft < 0 ? "overdue" : "due", daysLeft };
  };
  if (incident.harm === "unlikely") {
    const decided = incident.harmDecidedOn ?? incident.discoveredOn;
    const due = addDays(decided, BREACH_RULES.noticeDays);
    duties.push({ key: "determination", label: "Send the written no-harm decision to the Department of Legal Affairs", why: `No notice to the people is needed if, after investigating and consulting law enforcement, LendHous reasonably decided no identity theft or financial harm is likely; the decision goes to the Department within 30 days of it and is kept for ${BREACH_RULES.keepYears} years (501.171(4)(c)).`, due, ...stateOf("determination", due) });
  } else {
    let due = incident.done.goodCause ? addDays(thirty, BREACH_RULES.goodCauseDays) : thirty;
    if (incident.lawDelay && incident.lawDelay.until > due) due = incident.lawDelay.until;
    duties.push({ key: "individuals", label: "Tell each Floridian affected, by mail or email", why: `Within ${BREACH_RULES.noticeDays} days of finding it${incident.done.goodCause ? `, plus ${BREACH_RULES.goodCauseDays} for the good cause given to the Department` : ""}${incident.lawDelay && incident.lawDelay.until >= due ? `; ${incident.lawDelay.agency} asked in writing to delay it to ${longDay(incident.lawDelay.until)}` : ""} (501.171(4)). Say when it happened, what was taken, and who to contact.`, due, ...stateOf("individuals", due) });
    if (!incident.done.individuals && !incident.done.goodCause && incident.harm === "undetermined" && today <= thirty) duties.push({ key: "goodCause", label: "Optional: ask the Department for 15 more days, with good cause in writing", why: "Only while the 30 days are running, and only for the notice to the people (501.171(3)(a)).", due: thirty, ...stateOf("goodCause", thirty) });
  }
  if (incident.floridians >= BREACH_RULES.departmentAt) duties.push({ key: "department", label: "Notify the Department of Legal Affairs", why: `${incident.floridians.toLocaleString("en-US")} Floridians are affected, ${BREACH_RULES.departmentAt} or more, so the Department hears within ${BREACH_RULES.noticeDays} days with a synopsis, the number of Floridians, any free services offered, a copy of the notice and a contact (501.171(3)).`, due: thirty, ...stateOf("department", thirty) });
  const told = incident.notified ?? (incident.harm === "unlikely" ? 0 : incident.floridians);
  if (told > BREACH_RULES.bureausOver) duties.push({ key: "bureaus", label: "Notify Equifax, Experian and TransUnion", why: `More than ${BREACH_RULES.bureausOver.toLocaleString("en-US")} people are told at once, so the nationwide credit bureaus hear the timing, distribution and content of the notices without unreasonable delay (501.171(5)).`, ...stateOf("bureaus", incident.done.individuals ?? undefined) });
  return duties;
}

/** The incident's next deadline that isn't met, for the list. */
export function nextDeadline(incident: Incident, today: string) {
  if (incident.done.closed) return null;
  return breachDuties(incident, today).filter((duty) => duty.state === "due" || duty.state === "overdue").sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0] ?? null;
}

/** A vendor's notice: it had 10 days from its own finding to tell LendHous. */
export function agentLate(incident: Pick<Incident, "source" | "agentFoundOn" | "agentToldOn">) {
  if (incident.source !== "agent" || !incident.agentFoundOn || !incident.agentToldOn) return null;
  const days = daysUntil(incident.agentFoundOn, incident.agentToldOn);
  return days > BREACH_RULES.agentDays ? `The vendor told LendHous ${days} days after finding it, past the ${BREACH_RULES.agentDays} days 501.171(6) allows.` : null;
}

/** What the notice to each person has to say (501.171(4)(e)). */
export const NOTICE_MUST_SAY = ["The date, estimated date or date range of the breach", "What personal information was, or is believed to have been, accessed", "How to contact LendHous about the breach and the information it holds about them"];

export type IncidentInput = Omit<Incident, "id" | "done" | "measures" | "by" | "at">;

/** Why the incident can't be saved as entered, or null. */
export function incidentProblem(input: IncidentInput, today: string) {
  if (!input.title.trim()) return "Give it a short name.";
  if (!isDay(input.discoveredOn) || input.discoveredOn > today) return "Enter the day LendHous found it or had reason to believe it happened, today or earlier.";
  if (input.occurredFrom && (!isDay(input.occurredFrom) || input.occurredFrom > today)) return "Enter when it started, today or earlier.";
  if (input.occurredTo && (!isDay(input.occurredTo) || (input.occurredFrom && input.occurredTo < input.occurredFrom))) return "It ends on or after the day it started.";
  if (!input.synopsis.trim()) return "Say what happened, in a few lines.";
  if (!input.dataKinds.length || input.dataKinds.some((kind) => !(kind in DATA_KINDS))) return "Choose what kind of information was involved.";
  if (!Number.isInteger(input.floridians) || input.floridians < 0) return "Enter how many people in Florida are affected (0 if none).";
  if (input.notified !== undefined && (!Number.isInteger(input.notified) || input.notified < 0)) return "Enter how many people are being told, or leave it blank.";
  if (input.source === "agent" && !input.agent?.trim()) return "Name the vendor that was breached.";
  for (const day of [input.agentFoundOn, input.agentToldOn, input.harmDecidedOn]) if (day && (!isDay(day) || day > today)) return "Dates are today or earlier.";
  if (input.harm === "unlikely" && !input.harmReason?.trim()) return "Write down why no harm is likely, after investigating and consulting law enforcement: the law asks for it in writing.";
  if (input.lawDelay && (!input.lawDelay.agency.trim() || !isDay(input.lawDelay.until))) return "Name the agency that asked for the delay and the day it runs to.";
  return null;
}

/** Why a step can't be marked done on this day, or null. */
export function stepProblem(incident: Incident, step: IncidentStep, on: string, today: string) {
  if (!isDay(on) || on > today) return "Enter the day it was done, today or earlier.";
  if (on < incident.discoveredOn) return "That's before the incident was found.";
  if (step === "goodCause" && on > addDays(incident.discoveredOn, BREACH_RULES.noticeDays)) return "Good cause has to reach the Department within the 30 days.";
  if (step === "closed" && breachDuties(incident, today).some((duty) => duty.state !== "done" && duty.key !== "goodCause")) return "Finish the notices first.";
  return null;
}

export const STEP_DONE: Record<IncidentStep, string> = { individuals: "People told", department: "Department notified", goodCause: "Good cause sent", determination: "No-harm decision sent", bureaus: "Credit bureaus notified", closed: "Closed" };
export { longDay as incidentDay };
