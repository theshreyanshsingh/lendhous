import Link from "next/link";
import { addIncidentMeasure, markIncidentStep, saveIncident } from "@/actions/incidents";
import { Notice } from "@/components/notice";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { agentLate, breachDuties, DATA_KINDS, incidentDay, nextDeadline, NOTICE_MUST_SAY, STEP_DONE, type Duty, type Incident } from "@/lib/breach";
import { isDemoEmail } from "@/lib/deploy";
import { listIncidents } from "@/lib/incident-store";
import { servicingDate } from "@/lib/servicing";

export const metadata = { title: "Security incidents" };
export const dynamic = "force-dynamic";

type Search = { open?: string; new?: string; notice?: string; error?: string };
const TONE: Record<Duty["state"], string> = { done: "text-good", due: "text-warn", overdue: "text-bad", waiting: "text-muted-foreground" };
const small = "h-9 px-3 text-xs font-medium";

function dutyWords(duty: Duty) {
  if (duty.state === "done") return `Done ${incidentDay(duty.doneOn!)}`;
  if (duty.state === "waiting") return "Without unreasonable delay, once the people are told";
  if (duty.state === "overdue") return `Overdue: was due ${incidentDay(duty.due!)}`;
  return `Due ${incidentDay(duty.due!)} · ${duty.daysLeft} day${duty.daysLeft === 1 ? "" : "s"} left`;
}

/** The incident form, empty for a new one. */
function IncidentForm({ incident }: { incident?: Incident }) {
  const field = "desk-input";
  return (
    <form action={saveIncident} className="space-y-3 text-sm" data-testid="incident-form">
      {incident && <input type="hidden" name="id" value={incident.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Short name</span><input className={field} name="title" maxLength={160} required defaultValue={incident?.title} placeholder="Lost laptop with loan files" data-testid="incident-title" /></label>
        <label className="block"><span className="label">Found, or reason to believe, on</span><input className={field} type="date" name="discoveredOn" required defaultValue={incident?.discoveredOn} data-testid="incident-discovered" /></label>
        <label className="block"><span className="label">Floridians affected</span><input className={field} name="floridians" inputMode="numeric" required defaultValue={incident?.floridians} data-testid="incident-floridians" /></label>
        <label className="block"><span className="label">It started (optional)</span><input className={field} type="date" name="occurredFrom" defaultValue={incident?.occurredFrom} /></label>
        <label className="block"><span className="label">It ended (optional)</span><input className={field} type="date" name="occurredTo" defaultValue={incident?.occurredTo} /></label>
        <label className="block sm:col-span-2"><span className="label">What happened</span><textarea className={`${field} min-h-24`} name="synopsis" maxLength={4000} required defaultValue={incident?.synopsis} data-testid="incident-synopsis" /></label>
      </div>
      <fieldset className="space-y-1"><legend className="label">What information was involved</legend>
        <div className="grid gap-1 sm:grid-cols-2">{Object.entries(DATA_KINDS).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" name="dataKinds" value={key} defaultChecked={incident?.dataKinds.includes(key as keyof typeof DATA_KINDS)} data-testid={`incident-kind-${key}`} />{label}</label>)}</div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Where it happened</span><select className={field} name="source" defaultValue={incident?.source ?? "lendhous"} data-testid="incident-source"><option value="lendhous">At LendHous</option><option value="agent">At a vendor holding LendHous&apos;s data</option></select></label>
        <label className="block"><span className="label">The vendor, if it was one</span><input className={field} name="agent" maxLength={160} defaultValue={incident?.agent} /></label>
        <label className="block"><span className="label">The vendor found it on</span><input className={field} type="date" name="agentFoundOn" defaultValue={incident?.agentFoundOn} /></label>
        <label className="block"><span className="label">The vendor told LendHous on</span><input className={field} type="date" name="agentToldOn" defaultValue={incident?.agentToldOn} /></label>
        <label className="block"><span className="label">People being told (if not every Floridian)</span><input className={field} name="notified" inputMode="numeric" defaultValue={incident?.notified} /></label>
        <label className="block"><span className="label">Harm to the people</span><select className={field} name="harm" defaultValue={incident?.harm ?? "undetermined"} data-testid="incident-harm"><option value="undetermined">Not decided yet</option><option value="likely">Identity theft or financial harm is possible</option><option value="unlikely">Not likely, after investigating and consulting law enforcement</option></select></label>
        <label className="block"><span className="label">Decided no harm is likely on</span><input className={field} type="date" name="harmDecidedOn" defaultValue={incident?.harmDecidedOn} /></label>
        <label className="block sm:col-span-2"><span className="label">Why no harm is likely (kept five years)</span><textarea className={`${field} min-h-16`} name="harmReason" maxLength={4000} defaultValue={incident?.harmReason} /></label>
        <label className="block"><span className="label">Law enforcement asked to delay notice (agency)</span><input className={field} name="delayAgency" maxLength={200} defaultValue={incident?.lawDelay?.agency} /></label>
        <label className="block"><span className="label">Delay runs to</span><input className={field} type="date" name="delayUntil" defaultValue={incident?.lawDelay?.until} /></label>
      </div>
      <SubmitButton className={small} pendingLabel="Saving…">{incident ? "Save changes" : "Record it"}</SubmitButton>
    </form>
  );
}

/**
 * Security incidents and Florida's breach notices (rank 19, Fla. Stat. 501.171): each incident's deadlines from the day
 * it was found, what's been sent, and a log of what was done to contain it. Owners have it; anyone else is given it on
 * the Members page.
 */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("manage_incidents");
  const params = await searchParams;
  const today = servicingDate(new Date());
  // Demo seats share one database with nobody else's incidents in it, but keep them out of this anyway.
  const incidents = isDemoEmail(user.email) ? [] : await listIncidents();
  const opened = incidents.find((item) => item.id === params.open);
  return (
    <div className="max-w-4xl space-y-4">
      <PageIntro eyebrow="Admin" title="Security incidents" lede="If borrower or investor information may have been seen by someone who shouldn't have it, record it here the day you find out. Florida's deadlines run from that day, and this keeps them, the notices sent, and what was done about it." />
      <Notice notice={params.notice} error={params.error} />
      <section className="glass min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="eyebrow">Incidents ({incidents.length})</h2>
          {!params.new && <Link className="btn-primary h-9 px-3 text-xs" href="/admin/incidents?new=1" data-testid="incident-new">Record an incident</Link>}
        </div>
        {params.new && <div className="border-b border-border p-4"><IncidentForm /></div>}
        {incidents.length === 0 ? <p className="p-4 text-sm text-muted-foreground" data-testid="incidents-empty">None recorded. Keep it that way: encrypted fields, two approvers on money, and the audit log all help.</p> : (
          <ul className="divide-y divide-border" data-testid="incident-list">
            {incidents.map((incident) => {
              const next = nextDeadline(incident, today);
              return (
                <li key={incident.id} data-testid="incident-row">
                  <Link href={`/admin/incidents?open=${incident.id}`} className={`flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm hover:bg-hover ${opened?.id === incident.id ? "bg-active" : ""}`}>
                    <span className="min-w-0 font-medium wrap-anywhere">{incident.title}<span className="block text-xs font-normal text-muted-foreground">Found {incidentDay(incident.discoveredOn)} · {incident.floridians.toLocaleString("en-US")} Floridian{incident.floridians === 1 ? "" : "s"}</span></span>
                    <span className={`text-xs ${incident.done.closed ? "text-muted-foreground" : next ? TONE[next.state] : "text-good"}`}>{incident.done.closed ? `Closed ${incidentDay(incident.done.closed)}` : next ? `${next.label.replace(/^Optional: /, "")}: ${dutyWords(next)}` : "Notices done"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {opened && (
        <section className="glass min-w-0 space-y-4 p-4 sm:p-5" data-testid="incident-detail">
          <div>
            <h2 className="text-lg font-normal tracking-tight">{opened.title}</h2>
            <p className="text-xs text-muted-foreground">Found {incidentDay(opened.discoveredOn)}{opened.occurredFrom ? ` · happened ${incidentDay(opened.occurredFrom)}${opened.occurredTo && opened.occurredTo !== opened.occurredFrom ? ` to ${incidentDay(opened.occurredTo)}` : ""}` : ""} · recorded by {opened.by}{opened.source === "agent" ? ` · at ${opened.agent}` : ""}</p>
            <p className="mt-2 text-sm whitespace-pre-wrap wrap-anywhere">{opened.synopsis}</p>
            <p className="mt-1 text-xs text-muted-foreground">{opened.dataKinds.map((kind) => DATA_KINDS[kind]).join(" · ")}</p>
            {agentLate(opened) && <p className="mt-1 text-xs text-warn">{agentLate(opened)}</p>}
          </div>

          <div className="space-y-2">
            <h3 className="eyebrow">What the law asks, and by when</h3>
            <ul className="divide-y divide-border rounded-[2px] border border-border" data-testid="incident-duties">
              {breachDuties(opened, today).map((duty) => (
                <li key={duty.key} className="space-y-1.5 p-3" data-testid="incident-duty">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="font-medium">{duty.label}</span><span className={`text-xs ${TONE[duty.state]}`} data-testid="incident-duty-state">{dutyWords(duty)}</span></p>
                  <p className="text-xs text-muted-foreground">{duty.why}</p>
                  {duty.state !== "done" && !opened.done.closed && (
                    <form action={markIncidentStep} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={opened.id} /><input type="hidden" name="step" value={duty.key} />
                      <label className="block"><span className="label">Done on</span><input className="desk-input w-40!" type="date" name="on" defaultValue={today} /></label>
                      <SubmitButton variant="outline" className={small} pendingLabel="Saving…">Mark done</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {opened.harm !== "unlikely" && <div className="text-xs text-muted-foreground"><p>The notice to each person, by mail or email, has to say:</p><ul className="list-disc pl-5">{NOTICE_MUST_SAY.map((line) => <li key={line}>{line}</li>)}</ul><p className="mt-1">Have the attorney read it before it goes. The Department&apos;s portal is on myfloridalegal.com.</p></div>}
          </div>

          <div className="space-y-2">
            <h3 className="eyebrow">What was done ({opened.measures.length})</h3>
            {opened.measures.length > 0 && <ul className="space-y-1 text-sm" data-testid="incident-measures">{opened.measures.map((item, index) => <li key={index}><span className="text-xs text-muted-foreground">{incidentDay(item.on)} · {item.by}</span><br />{item.text}</li>)}</ul>}
            <form action={addIncidentMeasure} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={opened.id} />
              <label className="block min-w-0 flex-1 basis-64"><span className="label">Step taken</span><input className="desk-input" name="text" maxLength={1000} required placeholder="Reset every staff password and turned on device encryption" data-testid="incident-measure" /></label>
              <label className="block"><span className="label">On</span><input className="desk-input w-40!" type="date" name="on" defaultValue={today} /></label>
              <SubmitButton variant="outline" className={small} pendingLabel="Adding…">Add</SubmitButton>
            </form>
          </div>

          <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm text-link">Change the details</summary><div className="mt-3"><IncidentForm incident={opened} /></div></details>
          {!opened.done.closed && (
            <form action={markIncidentStep} className="border-t border-border pt-3">
              <input type="hidden" name="id" value={opened.id} /><input type="hidden" name="step" value="closed" /><input type="hidden" name="on" value={today} />
              <SubmitButton variant="outline" className={small} pendingLabel="Closing…">Close the incident</SubmitButton>
            </form>
          )}
          <p className="text-xs text-muted-foreground">{Object.keys(opened.done).length ? `Steps: ${Object.entries(opened.done).map(([key, day]) => `${STEP_DONE[key as keyof typeof STEP_DONE]} ${day}`).join(" · ")}.` : ""} Kept encrypted. Keep the written records for at least five years.</p>
        </section>
      )}
    </div>
  );
}
