"use client";
import { useState } from "react";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { advancing, clause, NOTICE_METHODS, noticeDueOn, noticeStatus, openStop, resumeProblem, STOP_NOTICE_BUSINESS_DAYS, STOP_REASONS, stopNoticeText, stopProblem, stopRecipients, type NoticeMethod, type StopReason } from "@/lib/stop-advance";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";

/**
 * Stopping construction advances before the work is done, and Florida's written notice to the contractor and each lienor
 * who served a notice to owner within 5 business days (Fla. Stat. 713.3471). The team's side, on the Servicing tab.
 */
export function AdvanceStops({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [stopping, setStopping] = useState(false);
  const [form, setForm] = useState<{ on: string; reason: StopReason; note: string }>({ on: "", reason: "default", note: "" });
  const [sent, setSent] = useState<Record<string, { sentOn: string; method: NoticeMethod }>>({});
  const [resume, setResume] = useState({ on: "", note: "" });
  const stop = openStop(deal);
  const past = (deal.advanceStops ?? []).filter((item) => item.resumed);
  if (!today || (!advancing(deal) && !stop && !past.length)) return null;
  const status = noticeStatus(deal, today);
  const people = stopRecipients(deal);
  const stopOn = form.on || today;
  const problem = stopProblem(deal, stopOn, form.reason, form.note, today);
  const resumeOn = resume.on || today;
  return (
    <Section title="Construction advances" right={stop ? <Badge tone="rose">Stopped</Badge> : <Badge tone="green">Advancing</Badge>}>
      <div className="space-y-3 text-sm" data-testid="advance-stops">
        {!stop && (
          <>
            <p className="text-muted-foreground">If LendHous stops advancing the holdback before the work is done, Florida law asks for a written notice to the contractor and each lienor who served a notice to owner within {STOP_NOTICE_BUSINESS_DAYS} business days (Fla. Stat. 713.3471). Draws are held until advances start again.</p>
            {!stopping ? <button type="button" className={`btn-ghost ${small}`} data-testid="stop-advances" onClick={() => setStopping(true)}>Stop advances</button> : (
              <div className="space-y-2 rounded-[2px] border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0"><span className="label">Stopped on</span><input type="date" className="desk-input" data-testid="stop-on" max={today} value={stopOn} onChange={(event) => setForm({ ...form, on: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Why</span><select className="desk-input" data-testid="stop-reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value as StopReason })}>{(Object.keys(STOP_REASONS) as StopReason[]).map((key) => <option key={key} value={key}>{STOP_REASONS[key]}</option>)}</select></label>
                </div>
                <label className="block"><span className="label">More about it{form.reason === "other" ? "" : " (optional)"}; the borrower sees this</span><input className="desk-input" data-testid="stop-note" maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
                <p className="text-xs text-muted-foreground">The notice is due by {shortDay(noticeDueOn(stopOn))}. {people.length ? `It goes to ${people.map((person) => person.name).join(", ")}.` : "No contractor or notice to owner is on file: add them to the lien file on the Closing tab."}</p>
                {problem && <p className="text-xs text-warn">{problem}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`btn-primary ${small}`} data-testid="stop-confirm" disabled={Boolean(problem)} onClick={async () => { if (await dispatch({ t: "stopAdvances", dealId: deal.id, on: stopOn, reason: form.reason, note: form.note, by: viewerName })) setStopping(false); }}>Stop advances</button>
                  <button type="button" className={`btn-ghost ${small}`} onClick={() => setStopping(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
        {stop && status && (
          <>
            <p data-testid="stop-summary">Stopped since {shortDay(stop.on)}: {STOP_REASONS[stop.reason].toLowerCase()}{stop.note ? `. ${clause(stop.note)}` : ""}. No draw goes out until advances start again.</p>
            <p className={`text-xs ${status.late ? "text-bad" : "text-muted-foreground"}`} data-testid="stop-due">{status.missing.length ? `Florida's notice is due by ${shortDay(status.due)}${status.late ? ", and it's late" : ""}: ${status.missing.length} still to send.` : "Every notice is sent."}</p>
            {!people.length && <p className="text-xs text-warn">No contractor or notice to owner is on file. Add them to the lien file on the Closing tab, then record each notice here.</p>}
            <ul className="divide-y divide-border" data-testid="stop-notices">
              {people.map((person) => {
                const done = stop.notices.find((notice) => notice.key === person.key);
                const draft = sent[person.key] ?? { sentOn: "", method: "mail" as NoticeMethod };
                return (
                  <li key={person.key} className="space-y-1.5 py-2" data-testid="stop-notice">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0"><b className="font-medium">{person.name}</b> <span className="text-muted-foreground">({person.role.toLowerCase()})</span></span>{done ? <Badge tone="green">Sent {shortDay(done.sentOn)}</Badge> : <Badge tone="amber">To send</Badge>}</div>
                    {done ? <p className="text-xs text-muted-foreground">{NOTICE_METHODS[done.method]}, recorded by {done.by}.</p> : (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block"><span className="label">Sent on</span><input type="date" className="desk-input w-auto!" data-testid="notice-sent-on" min={stop.on} max={today} value={draft.sentOn || today} onChange={(event) => setSent({ ...sent, [person.key]: { ...draft, sentOn: event.target.value } })} /></label>
                        <label className="block"><span className="label">How</span><select className="desk-input w-auto! max-w-full" data-testid="notice-method" value={draft.method} onChange={(event) => setSent({ ...sent, [person.key]: { ...draft, method: event.target.value as NoticeMethod } })}>{(Object.keys(NOTICE_METHODS) as NoticeMethod[]).map((key) => <option key={key} value={key}>{NOTICE_METHODS[key]}</option>)}</select></label>
                        <button type="button" className={`btn-ghost ${small}`} data-testid="notice-record" onClick={() => void dispatch({ t: "stopNoticeSent", dealId: deal.id, key: person.key, sentOn: draft.sentOn || today, method: draft.method, by: viewerName })}>Record it sent</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {people[0] && <details className="text-xs"><summary className="cursor-pointer text-link">The notice&apos;s wording (PLACEHOLDER until the attorney approves it)</summary><pre className="mt-2 whitespace-pre-wrap rounded-[2px] bg-muted p-3 font-sans" data-testid="stop-notice-text">{stopNoticeText(deal, people[0], stop)}</pre></details>}
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block"><span className="label">Advances start again on</span><input type="date" className="desk-input w-auto!" data-testid="resume-on" min={stop.on} max={today} value={resumeOn} onChange={(event) => setResume({ ...resume, on: event.target.value })} /></label>
                <label className="block min-w-0 flex-1 basis-56"><span className="label">What changed (the borrower sees this)</span><input className="desk-input" data-testid="resume-note" maxLength={1000} value={resume.note} onChange={(event) => setResume({ ...resume, note: event.target.value })} /></label>
                <button type="button" className={`btn-ghost ${small}`} data-testid="resume-advances" disabled={Boolean(resumeProblem(deal, resumeOn, resume.note, today))} onClick={async () => { if (await dispatch({ t: "resumeAdvances", dealId: deal.id, on: resumeOn, note: resume.note, by: viewerName })) setResume({ on: "", note: "" }); }}>Start advances again</button>
              </div>
            </div>
          </>
        )}
        {past.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground" data-testid="stop-history">{past.map((item) => <li key={item.at}>Stopped {shortDay(item.on)} ({STOP_REASONS[item.reason].toLowerCase()}), {item.notices.length} notice{item.notices.length === 1 ? "" : "s"} sent, started again {shortDay(item.resumed!.on)}: {clause(item.resumed!.note)} ({shortDate(item.resumed!.at)})</li>)}</ul>}
      </div>
    </Section>
  );
}

/** What the borrower sees while advances are stopped. */
export function AdvancesPaused({ deal }: { deal: Deal }) {
  const stop = openStop(deal);
  if (!stop) return null;
  return (
    <div className="rounded-[2px] border border-bad/30 bg-bad/5 p-3 text-sm" data-testid="advances-paused">
      <p className="font-medium text-bad">Draws are paused</p>
      <p className="mt-1">Since {shortDay(stop.on)}: {STOP_REASONS[stop.reason].toLowerCase()}{stop.note ? `. ${clause(stop.note)}` : ""}. You can still send a draw request; it&apos;s paid once draws start again. Your loan team will be in touch about what&apos;s needed.</p>
    </div>
  );
}
