"use client";
import { useState } from "react";
import { Badge, Section } from "@/components/ui";
import { shortDay } from "@/lib/format";
import type { Deal, LeaseReview, ReoOccupancy } from "@/lib/mockData";
import { ANSWERS, leaseNotes, leaseReviewProblem, OCCUPANCY_STATE, occupancyGuide, occupancyProblem, SHERIFF_CONDITIONS, sheriffProblem, TENANT_FLAGS, type OccupancyInput, type SheriffCondition, type TenantFlag } from "@/lib/occupancy";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
const TONE = { bad: "text-bad", warn: "text-warn", note: "text-muted-foreground" } as const;

/** A rental's leases and tenants, reviewed by the processor before the rent sizes the loan (lib/occupancy.ts). */
export function LeaseAndTenants({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const review = deal.leaseReview;
  const [editing, setEditing] = useState(!review);
  const [draft, setDraft] = useState<Omit<LeaseReview, "by" | "at">>({ flags: review?.flags ?? [], emailAddendum: review?.emailAddendum ?? "no", floodDisclosure: review?.floodDisclosure ?? "no", note: review?.note ?? "" });
  const problem = leaseReviewProblem(deal, draft);
  const notes = leaseNotes(deal);
  const save = async () => { if (await dispatch({ t: "saveLeaseReview", dealId: deal.id, review: draft, by: viewerName })) setEditing(false); };
  const toggle = (flag: TenantFlag) => setDraft({ ...draft, flags: draft.flags.includes(flag) ? draft.flags.filter((item) => item !== flag) : [...draft.flags, flag] });
  return (
    <Section title="Leases and tenants" right={<Badge tone={!review ? "slate" : review.flags.length ? "rose" : "green"}>{!review ? "Not reviewed" : review.flags.length ? `${review.flags.length} red flag${review.flags.length === 1 ? "" : "s"}` : "Reviewed"}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="lease-review">
        {notes.length > 0 && <ul className="space-y-1 text-xs" data-testid="lease-notes">{notes.map((note) => <li key={note.text} className={TONE[note.tone]}>{note.text}</li>)}</ul>}
        {review && !editing && (
          <div className="text-xs text-muted-foreground" data-testid="lease-review-summary">
            <p>Email notice addendum: {ANSWERS[review.emailAddendum]} · Landlord&apos;s flood disclosure: {ANSWERS[review.floodDisclosure]}</p>
            {review.note && <p className="mt-1 whitespace-pre-wrap text-foreground">{review.note}</p>}
            <p className="mt-1">Reviewed by {review.by} {shortDay(review.at.slice(0, 10))}</p>
            <button type="button" className={`btn-ghost ${small} mt-2`} data-testid="lease-review-edit" onClick={() => setEditing(true)}>Review again</button>
          </div>
        )}
        {editing && (
          <div className="space-y-3" data-testid="lease-review-form">
            <fieldset className="space-y-1"><legend className="label">Red flags in the leases and tenants</legend>
              {(Object.entries(TENANT_FLAGS) as [TenantFlag, string][]).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid={`lease-flag-${key}`} checked={draft.flags.includes(key)} onChange={() => toggle(key)} />{label}</label>)}
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="label">The tenant agreed to notices by email (addendum)</span><select className="desk-input" data-testid="lease-email" value={draft.emailAddendum} onChange={(event) => setDraft({ ...draft, emailAddendum: event.target.value as LeaseReview["emailAddendum"] })}>{Object.entries(ANSWERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block"><span className="label">Landlord&apos;s flood disclosure on a lease of a year or more</span><select className="desk-input" data-testid="lease-flood" value={draft.floodDisclosure} onChange={(event) => setDraft({ ...draft, floodDisclosure: event.target.value as LeaseReview["floodDisclosure"] })}>{Object.entries(ANSWERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
            <label className="block"><span className="label">What you found{draft.flags.length ? "" : " (optional)"}</span><textarea className="desk-input min-h-16" data-testid="lease-note" maxLength={2000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
            {problem && draft.flags.length > 0 && !draft.note.trim() && <p className="text-xs text-warn">{problem}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn-primary ${small}`} data-testid="lease-review-save" disabled={Boolean(problem)} onClick={() => void save()}>Save the review</button>
              {review && <button type="button" className={`btn-ghost ${small}`} onClick={() => setEditing(false)}>Cancel</button>}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Who's living in a property LendHous owns after a foreclosure, and the sheriff's removal of anyone there unlawfully. */
export function ReoOccupancyCard({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const saved = deal.reo?.occupancy;
  const [draft, setDraft] = useState<OccupancyInput>({ checkedOn: saved?.checkedOn ?? "", state: saved?.state ?? "unknown", note: saved?.note ?? "", confirmed: saved?.confirmed ?? [], sheriff: saved?.sheriff });
  const [filing, setFiling] = useState(false);
  const [sheriff, setSheriff] = useState({ filedOn: saved?.sheriff?.filedOn ?? "", county: saved?.sheriff?.county ?? deal.app.county ?? "", outcome: saved?.sheriff?.outcome ?? "", outcomeOn: saved?.sheriff?.outcomeOn ?? "" });
  if (!deal.reo) return null;
  const withSheriff = (): OccupancyInput => (filing || draft.sheriff ? { ...draft, sheriff: { filedOn: sheriff.filedOn, county: sheriff.county, ...(sheriff.outcome ? { outcome: sheriff.outcome as "removed" | "refused", outcomeOn: sheriff.outcomeOn } : {}) } } : draft);
  const input = withSheriff();
  const problem = today ? occupancyProblem(deal, input, today) : "…";
  const save = async () => { if (await dispatch({ t: "saveOccupancy", dealId: deal.id, occupancy: input, by: viewerName })) setFiling(false); };
  const confirm = (key: SheriffCondition) => setDraft({ ...draft, confirmed: draft.confirmed?.includes(key) ? draft.confirmed.filter((item) => item !== key) : [...(draft.confirmed ?? []), key] });
  const ready = !sheriffProblem(draft);
  return (
    <Section title="Who's living there" right={<Badge tone={!saved ? "slate" : saved.state === "vacant" ? "green" : saved.state === "squatter" ? "rose" : "amber"}>{saved ? OCCUPANCY_STATE[saved.state] : "Not checked"}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="reo-occupancy">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">Checked on</span><input className="desk-input" type="date" data-testid="occupancy-checked" value={draft.checkedOn} onChange={(event) => setDraft({ ...draft, checkedOn: event.target.value })} /></label>
          <label className="block"><span className="label">Who&apos;s there</span><select className="desk-input" data-testid="occupancy-state" value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value as ReoOccupancy["state"] })}>{Object.entries(OCCUPANCY_STATE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="occupancy-guide">{occupancyGuide(draft.state)}</p>
        {draft.state === "squatter" && (
          <fieldset className="space-y-1" data-testid="sheriff-conditions"><legend className="label">Confirm each condition (Fla. Stat. 82.036(2))</legend>
            {(Object.entries(SHERIFF_CONDITIONS) as [SheriffCondition, string][]).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid={`sheriff-${key}`} checked={draft.confirmed?.includes(key) ?? false} onChange={() => confirm(key)} />{label}</label>)}
            {ready && <p className="text-xs text-good">Every condition holds: file the verified Complaint to Remove Persons Unlawfully Occupying Residential Real Property with the {deal.app.county} County sheriff, and pay its fee. The sheriff serves notice to leave at once.</p>}
          </fieldset>
        )}
        <label className="block"><span className="label">Notes</span><textarea className="desk-input min-h-16" data-testid="occupancy-note" maxLength={2000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        {draft.state === "squatter" && ready && (filing || draft.sheriff) && (
          <div className="grid gap-2 sm:grid-cols-2" data-testid="sheriff-form">
            <label className="block"><span className="label">Complaint filed on</span><input className="desk-input" type="date" data-testid="sheriff-filed" value={sheriff.filedOn} onChange={(event) => setSheriff({ ...sheriff, filedOn: event.target.value })} /></label>
            <label className="block"><span className="label">County sheriff</span><input className="desk-input" data-testid="sheriff-county" maxLength={60} value={sheriff.county} onChange={(event) => setSheriff({ ...sheriff, county: event.target.value })} /></label>
            <label className="block"><span className="label">What the sheriff did</span><select className="desk-input" data-testid="sheriff-outcome" value={sheriff.outcome} onChange={(event) => setSheriff({ ...sheriff, outcome: event.target.value })}><option value="">Not yet</option><option value="removed">Removed them</option><option value="refused">Declined: it goes to court</option></select></label>
            {sheriff.outcome && <label className="block"><span className="label">On</span><input className="desk-input" type="date" data-testid="sheriff-outcome-on" value={sheriff.outcomeOn} onChange={(event) => setSheriff({ ...sheriff, outcomeOn: event.target.value })} /></label>}
          </div>
        )}
        {problem && draft.checkedOn && <p className="text-xs text-warn">{problem}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn-primary ${small}`} data-testid="occupancy-save" disabled={Boolean(problem)} onClick={() => void save()}>Save</button>
          {draft.state === "squatter" && ready && !filing && !draft.sheriff && <button type="button" className={`btn-ghost ${small}`} data-testid="sheriff-record" onClick={() => setFiling(true)}>Record the sheriff&apos;s complaint</button>}
        </div>
        {saved && <p className="text-xs text-muted-foreground">Last checked {shortDay(saved.checkedOn)} by {saved.by}{saved.sheriff ? ` · complaint filed ${shortDay(saved.sheriff.filedOn)} with the ${saved.sheriff.county} sheriff${saved.sheriff.outcome ? `, ${saved.sheriff.outcome === "removed" ? "removed" : "declined"} ${shortDay(saved.sheriff.outcomeOn!)}` : ""}` : ""}.</p>}
      </div>
    </Section>
  );
}
