import { removeReportSchedule, saveReportSchedule } from "@/actions/report-schedules";
import { SubmitButton } from "@/components/submit-button";
import type { Recipient } from "@/lib/report-schedule-store";
import { REPORT_KINDS, scheduleWords, WEEKDAYS, type ReportKind, type ReportSchedule } from "@/lib/scheduled-reports";

const SEES: Record<Recipient["sees"], string> = { team: "The team (whole book)", partner: "Partners (their loans)", buyer: "Loan buyers (their loans)" };

/**
 * Reports by email (rank 23): delinquency, maturities and aged receivables, to download now or on a schedule. The email
 * is a link; the file is made when the person opens it, for what their account may see. A server component.
 */
export function ScheduledReports({ schedules, people, demo }: { schedules: ReportSchedule[]; people: Recipient[]; demo: boolean }) {
  const groups = (Object.keys(SEES) as Recipient["sees"][]).map((sees) => [sees, people.filter((person) => person.sees === sees)] as const).filter(([, list]) => list.length);
  return (
    <section className="glass min-w-0 space-y-4 p-4 sm:p-5" id="scheduled" data-testid="scheduled-reports">
      <div>
        <h2 className="eyebrow">Reports by email</h2>
        <p className="mt-1 text-xs text-muted-foreground">Delinquency, maturities and aged receivables. The email carries a link, not the file: it&apos;s made when the person signs in and opens it, so it&apos;s current then, and partners and buyers get only their own loans, with no borrower names.</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3" data-testid="report-downloads">
        {(Object.entries(REPORT_KINDS) as [ReportKind, (typeof REPORT_KINDS)[ReportKind]][]).map(([kind, info]) => (
          <li key={kind} className="rounded-[2px] border border-border p-3 text-xs">
            <a className="font-medium text-link underline" href={`/api/reports/scheduled/${kind}`} data-testid={`report-download-${kind}`}>{info.label} (CSV)</a>
            <p className="mt-1 text-muted-foreground">{info.hint}</p>
          </li>
        ))}
      </ul>
      {schedules.length > 0 && (
        <ul className="divide-y divide-border rounded-[2px] border border-border text-sm" data-testid="report-schedules">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="report-schedule">
              <span className="min-w-0"><span className="font-medium">{REPORT_KINDS[schedule.kind].label}</span> · {scheduleWords(schedule)}<span className="block text-xs text-muted-foreground">To {schedule.to.map((person) => person.name).join(", ")}{schedule.lastSent ? ` · last sent ${schedule.lastSent}` : ""}</span></span>
              <form action={removeReportSchedule}><input type="hidden" name="id" value={schedule.id} /><SubmitButton variant="outline" className="h-9 px-3 text-xs" pendingLabel="Stopping…">Stop</SubmitButton></form>
            </li>
          ))}
        </ul>
      )}
      {demo ? <p className="text-xs text-muted-foreground" data-testid="report-schedule-demo">On a demo seat the reports download from the demo book, but schedules are for real accounts.</p> : (
        <form action={saveReportSchedule} className="space-y-3 text-sm" data-testid="report-schedule-form">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block"><span className="label">Report</span><select className="desk-input" name="kind" data-testid="schedule-kind">{(Object.entries(REPORT_KINDS) as [ReportKind, { label: string }][]).map(([kind, info]) => <option key={kind} value={kind}>{info.label}</option>)}</select></label>
            <label className="block"><span className="label">How often</span><select className="desk-input" name="every" data-testid="schedule-every"><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
            <label className="block"><span className="label">Weekly on</span><select className="desk-input" name="weekday" defaultValue="1">{WEEKDAYS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
            <label className="block"><span className="label">Monthly on the</span><select className="desk-input" name="monthday" defaultValue="1">{Array.from({ length: 28 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
          </div>
          <fieldset className="space-y-2"><legend className="label">To</legend>
            {groups.length === 0 && <p className="text-xs text-muted-foreground">No one with an account can be sent a report yet.</p>}
            {groups.map(([sees, list]) => (
              <div key={sees}><p className="text-xs text-muted-foreground">{SEES[sees]}</p>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">{list.map((person) => <label key={person.id} className="flex items-center gap-2 text-xs"><input type="checkbox" name="to" value={person.id} data-testid="schedule-to" />{person.name}</label>)}</div>
              </div>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">It goes out with the nightly jobs, early morning Eastern time.</p>
          <SubmitButton className="h-9 px-3 text-xs" pendingLabel="Saving…">Schedule it</SubmitButton>
        </form>
      )}
    </section>
  );
}
