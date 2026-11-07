// Booking a call from the site (docs/competitor-gaps.md, 1.10): half-hour times in Florida business hours over the next two
// weeks, less the ones taken and anything too soon to prepare for. Pure, so the page, the server and the tests agree.
import { isBusinessDay } from "./sla";

/** PLACEHOLDER until GT sets the team's hours: 10 to 4 Eastern, half-hour calls, two weeks out, at least two hours' notice. */
export const CALL_HOURS = { start: 10 * 60, end: 16 * 60, slot: 30, days: 10, noticeMinutes: 120 };

export const CALL_TOPICS = {
  new_loan: "A new loan",
  quote: "A quote I got",
  my_loan: "My loan or a draw",
  broker: "Sending deals as a broker",
  other: "Something else",
} as const;
export type CallTopic = keyof typeof CALL_TOPICS;

const ZONE = "America/New_York";
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function eastern(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The instant a Florida day and time falls on, daylight saving included. */
export function easternInstant(day: string, minutes: number) {
  const [y, m, d] = day.split("-").map(Number);
  // Eastern is 4 or 5 hours behind UTC; start at 5 and correct by what the guess reads as.
  let at = Date.UTC(y, m - 1, d, 0, minutes) + 5 * 3_600_000;
  const read = eastern(new Date(at));
  const off = (read.day === day ? read.minutes : read.day < day ? read.minutes - 1440 : read.minutes + 1440) - minutes;
  at -= off * 60_000;
  return new Date(at);
}

/** The times open to book, by Florida day: business days only, inside the hours, with notice, and not already taken. */
export function callSlots(now: Date, booked: string[], days = CALL_HOURS.days) {
  const taken = new Set(booked.map((iso) => new Date(iso).toISOString()));
  const earliest = now.getTime() + CALL_HOURS.noticeMinutes * 60_000;
  const out: { day: string; slots: string[] }[] = [];
  let day = eastern(now).day;
  for (let guard = 0; out.length < days && guard < 40; guard++, day = shift(day, 1)) {
    if (!isBusinessDay(day)) continue;
    const slots: string[] = [];
    for (let minutes = CALL_HOURS.start; minutes + CALL_HOURS.slot <= CALL_HOURS.end; minutes += CALL_HOURS.slot) {
      const at = easternInstant(day, minutes);
      if (at.getTime() >= earliest && !taken.has(at.toISOString())) slots.push(at.toISOString());
    }
    out.push({ day, slots });
  }
  return out.filter((item) => item.slots.length);
}

/** "Tuesday, November 10 at 2:30 pm Eastern". */
export function slotLabel(iso: string) {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long", month: "long", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(at).toLowerCase().replace(" ", " ");
  return `${day} at ${time} Eastern`;
}

export type CallRequest = { startsAt: string; name: string; email: string; phone: string; topic: CallTopic; notes: string };

/** Why this booking can't be made, or null: the time has to be one still open. */
export function bookingProblem(input: CallRequest, now: Date, booked: string[]): string | null {
  if (!callSlots(now, booked).some((item) => item.slots.includes(input.startsAt))) return "That time isn't open any more. Pick another.";
  if (!input.name.trim()) return "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return "Enter an email address we can send the confirmation to.";
  if (input.phone.replace(/\D/g, "").length < 10) return "Enter a phone number we can call, with its area code.";
  if (!(input.topic in CALL_TOPICS)) return "Choose what the call is about.";
  return null;
}
