// A loan's dates as a calendar file (RFC 5545 .ics) the borrower adds to their own calendar: the closing while it's
// coming, each payment's due date (one monthly event to the last payment), and the maturity on a short-term loan. All-day
// events, no amounts (a payment can change with draws or a modification) and no links that sign anyone in. Pure.
import type { Deal } from "./mockData";
import { PRE_FUNDING } from "./loan-exits";
import { ledger, SERVICED } from "./servicing";

export type CalendarEvent = { uid: string; day: string; summary: string; description: string; monthlyUntil?: string; remindDaysBefore?: number };

const compact = (day: string) => day.replaceAll("-", "");
const nextDay = (day: string) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
/** Text with the characters RFC 5545 reserves escaped. */
const text = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines over 75 octets are folded: a line break and a space (RFC 5545 3.1). */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (new TextEncoder().encode(current + char).length > (parts.length ? 74 : 75)) { parts.push(current); current = ""; }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The events for one loan as of a day. */
export function loanEvents(deal: Pick<Deal, "id" | "loanNumber" | "status" | "closingDate" | "address" | "city" | "app"> & Partial<Deal>, today: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const where = `${deal.address}, ${deal.city}`;
  if (PRE_FUNDING.includes(deal.status) && deal.closingDate && deal.closingDate >= today) {
    events.push({ uid: `closing-${deal.id}`, day: deal.closingDate, summary: `Loan closing: ${where}`, description: `The closing date set for ${deal.loanNumber}. It can move: LendHous tells you if it does, and your loan page always has the current date.`, remindDaysBefore: 2 });
  }
  if (SERVICED.includes(deal.status)) {
    const l = ledger(deal as Deal);
    const first = l.rows.find((row) => row.due >= today && !row.paidOn)?.due ?? l.nextDue;
    const last = l.rows[l.rows.length - 1]?.due;
    if (first && last && first <= last) events.push({ uid: `payments-${deal.id}`, day: first, summary: `LendHous payment due: ${deal.loanNumber}`, description: `Your monthly payment on ${where} is due. The amount is on your loan page and your monthly statement.`, monthlyUntil: last, remindDaysBefore: 3 });
    if (deal.app.product !== "dscr" && l.maturity >= today) events.push({ uid: `maturity-${deal.id}`, day: l.maturity, summary: `Loan matures: ${deal.loanNumber}`, description: `${deal.loanNumber} on ${where} is due in full. Ask LendHous early about a payoff letter, a refinance or an extension.`, remindDaysBefore: 30 });
  }
  return events;
}

/** The calendar file. `stamp` is when it was made, as an ISO time. */
export function icsFile(events: CalendarEvent[], stamp: string) {
  const at = stamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LendHous//Loan dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:LendHous loan dates"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}@lendhous`, `DTSTAMP:${at}`, `DTSTART;VALUE=DATE:${compact(event.day)}`, `DTEND;VALUE=DATE:${compact(nextDay(event.day))}`, `SUMMARY:${text(event.summary)}`, `DESCRIPTION:${text(event.description)}`, "TRANSP:TRANSPARENT");
    if (event.monthlyUntil) lines.push(`RRULE:FREQ=MONTHLY;UNTIL=${compact(event.monthlyUntil)}`);
    if (event.remindDaysBefore) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(event.summary)}`, `TRIGGER:-P${event.remindDaysBefore}D`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
