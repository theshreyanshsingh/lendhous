"use client";
import { serviceDay } from "@/lib/book";
import { icsFile, loanEvents } from "@/lib/calendar-file";
import { downloadFile } from "@/lib/csv";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/**
 * Puts the loan's closing, payment due dates and maturity in the borrower's own calendar (lib/calendar-file.ts). A real
 * account gets the file from the server, which a phone opens in its calendar; demo data, which lives in this browser,
 * makes it here.
 */
export function AddToCalendar({ deal }: { deal: Deal }) {
  const { s, local } = useStore();
  const events = loanEvents(deal, serviceDay(s));
  if (!events.length) return null;
  const label = "Add to calendar";
  const title = events.map((event) => event.summary).join("; ");
  const className = "text-xs text-link underline underline-offset-2";
  if (local) return <button type="button" className={className} data-testid="add-to-calendar" title={title} onClick={() => downloadFile(`lendhous-${deal.loanNumber}.ics`, icsFile(events, new Date().toISOString()), "text/calendar;charset=utf-8")}>{label}</button>;
  return <a className={className} href={`/api/loan-calendar/${deal.id}`} download data-testid="add-to-calendar" title={title}>{label}</a>;
}
