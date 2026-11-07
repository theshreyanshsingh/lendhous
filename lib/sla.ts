// How long things may wait: the team's targets (PLACEHOLDER until GT sets them in Settings), and clocks that count
// business hours in Florida (9 to 5 Eastern, weekdays, less the state's paid holidays) or plain hours.

export type SlaKey = "firstLook" | "termSheet" | "drawDecision" | "docReview";
export type Target = { label: string; hours: number; business: boolean };

/** PLACEHOLDER targets. Business targets count working hours: 8 of them is one business day. */
export const SLA_TARGETS: Record<SlaKey, Target> = {
  firstLook: { label: "New application looked at", hours: 4, business: true },
  termSheet: { label: "Complete application to term sheet", hours: 8, business: true },
  drawDecision: { label: "Draw request decided", hours: 24, business: false },
  docReview: { label: "Document reviewed", hours: 8, business: true },
};
export const SLA_KEYS = Object.keys(SLA_TARGETS) as SlaKey[];
export type Targets = Record<SlaKey, Target>;

/** The targets with any hours GT saved in Settings. A saved value outside 1 to 240 hours is ignored. */
export function targetsFrom(saved?: Partial<Record<SlaKey, unknown>> | null): Targets {
  return Object.fromEntries(SLA_KEYS.map((key) => {
    const hours = Number(saved?.[key]);
    return [key, { ...SLA_TARGETS[key], hours: Number.isFinite(hours) && hours >= 1 && hours <= 240 ? hours : SLA_TARGETS[key].hours }];
  })) as Targets;
}

const OPEN = 9 * 60;
const CLOSE = 17 * 60;
const ZONE = "America/New_York";

const ymd = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The nth given weekday of a month (n = -1 for the last). */
function nth(year: number, month: number, dayOfWeek: number, n: number) {
  if (n > 0) { const first = weekday(ymd(year, month, 1)); return ymd(year, month, 1 + ((dayOfWeek - first + 7) % 7) + (n - 1) * 7); }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekday(ymd(year, month, lastDay));
  return ymd(year, month, lastDay - ((last - dayOfWeek + 7) % 7));
}
/** A date-fixed holiday on a weekend is kept on the Friday before or the Monday after. */
const observed = (day: string) => (weekday(day) === 6 ? shift(day, -1) : weekday(day) === 0 ? shift(day, 1) : day);

/** Florida's paid state holidays (Fla. Stat. 110.117) for a year, as days. */
export function floridaHolidays(year: number) {
  const thanksgiving = nth(year, 11, 4, 4);
  return [observed(ymd(year, 1, 1)), nth(year, 1, 1, 3), nth(year, 5, 1, -1), observed(ymd(year, 7, 4)), nth(year, 9, 1, 1), observed(ymd(year, 11, 11)), thanksgiving, shift(thanksgiving, 1), observed(ymd(year, 12, 25))];
}
export const isBusinessDay = (day: string) => weekday(day) !== 0 && weekday(day) !== 6 && !floridaHolidays(Number(day.slice(0, 4))).includes(day);

/** An instant as Florida's calendar day and minutes past midnight. */
function local(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Working hours in Florida between two instants: 9 to 5 Eastern on business days. */
export function businessHoursBetween(from: Date, to: Date) {
  if (to <= from) return 0;
  const start = local(from);
  const end = local(to);
  let minutes = 0;
  for (let day = start.day; day <= end.day; day = shift(day, 1)) {
    if (!isBusinessDay(day)) continue;
    const low = day === start.day ? Math.max(OPEN, start.minutes) : OPEN;
    const high = day === end.day ? Math.min(CLOSE, end.minutes) : CLOSE;
    if (high > low) minutes += high - low;
  }
  return minutes / 60;
}

export type ClockState = "ok" | "amber" | "red";
export type Clock = { elapsed: number; target: Target; state: ClockState; text: string };

const span = (hours: number, business: boolean) => {
  const unit = business ? " business" : "";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (!business && hours >= 48) return `${Math.round(hours / 24)} days`;
  if (business && hours >= 16) return `${Math.round(hours / 8)}${unit} days`;
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded}${unit} hour${rounded === 1 ? "" : "s"}`;
};

/** How a wait is going against its target: amber from three quarters of the way, red once it's past. */
export function clockOf(since: string, now: Date, target: Target): Clock {
  const start = new Date(since);
  const elapsed = target.business ? businessHoursBetween(start, now) : Math.max(0, (now.getTime() - start.getTime()) / 3_600_000);
  const state: ClockState = elapsed >= target.hours ? "red" : elapsed >= target.hours * 0.75 ? "amber" : "ok";
  const text = state === "red" ? `${span(elapsed - target.hours, target.business)} past the target` : `${span(target.hours - elapsed, target.business)} left`;
  return { elapsed, target, state, text };
}

/**
 * When a wait reaches its target: plain hours added on, or working hours counted forward through Florida's business days.
 * To the minute, which is all a "we'll decide by" time needs.
 */
export function dueAt(since: string, target: Target): Date {
  const start = new Date(since);
  if (!target.business) return new Date(start.getTime() + target.hours * 3_600_000);
  // Working hours only grow with time, so search the minutes after it for the first that has counted enough of them.
  let low = Math.ceil(start.getTime() / 60_000);
  let high = low + 60 * 24 * 60;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (businessHoursBetween(start, new Date(mid * 60_000)) >= target.hours - 1e-9) high = mid; else low = mid + 1;
  }
  return new Date(low * 60_000);
}

/** An instant as people in Florida say it: "Tuesday, November 10 at 3:15 PM". */
export const floridaTime = (at: Date) => `${at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ZONE })} at ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ZONE })}`;
