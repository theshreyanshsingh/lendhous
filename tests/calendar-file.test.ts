import { describe, expect, it } from "vitest";
import { demoBook, serviceDay } from "@/lib/book";
import { icsFile, loanEvents } from "@/lib/calendar-file";
import { ledger } from "@/lib/servicing";

const b = demoBook();
const today = serviceDay(b);

describe("a loan's dates in the borrower's own calendar", () => {
  it("gives a funded loan one monthly payment event to its last payment, and its maturity", () => {
    const flip = b.deals.find((deal) => deal.id === "d2")!;
    const l = ledger(flip);
    const events = loanEvents(flip, today);
    expect(events.map((event) => event.uid)).toEqual(["payments-d2", "maturity-d2"]);
    expect(events[0]).toMatchObject({ summary: "LendHous payment due: LH-DEMO-1002", monthlyUntil: l.rows[l.rows.length - 1].due, remindDaysBefore: 3 });
    expect(events[0].day >= today).toBe(true);
    expect(events[1]).toMatchObject({ day: l.maturity, remindDaysBefore: 30 });
    expect(events.map((event) => event.description).join(" ")).not.toMatch(/\$/);
  });

  it("gives a loan on its way to closing the closing date, and nothing once it's past", () => {
    const pending = { ...b.deals.find((deal) => deal.status === "underwriting")!, closingDate: "2026-11-20" };
    expect(loanEvents(pending, today)).toEqual([expect.objectContaining({ uid: `closing-${pending.id}`, day: "2026-11-20", remindDaysBefore: 2 })]);
    expect(loanEvents(pending, "2026-11-21")).toEqual([]);
  });

  it("writes a calendar file the calendar apps read: all-day, monthly, a reminder, escaped and folded", () => {
    const file = icsFile([{ uid: "payments-d2", day: "2026-11-01", summary: "LendHous payment due: LH-DEMO-1002", description: "Your payment on 456 Placeholder Ave, Fort Lauderdale is due; see your loan page. ".repeat(2), monthlyUntil: "2027-04-01", remindDaysBefore: 3 }], "2026-11-19T15:04:05.123Z");
    const lines = file.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toEqual(expect.arrayContaining(["UID:payments-d2@lendhous", "DTSTAMP:20261119T150405Z", "DTSTART;VALUE=DATE:20261101", "DTEND;VALUE=DATE:20261102", "RRULE:FREQ=MONTHLY;UNTIL=20270401", "TRIGGER:-P3D", "END:VCALENDAR"]));
    const unfolded = file.replace(/\r\n /g, "");
    expect(unfolded).toContain(String.raw`Fort Lauderdale is due\; see`);
    expect(unfolded).toContain(String.raw`456 Placeholder Ave\, Fort`);
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
    expect(file.endsWith("\r\n")).toBe(true);
  });
});
