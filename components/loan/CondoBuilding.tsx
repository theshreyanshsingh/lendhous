"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { CONDO_STATE, condoCheck, type CondoInput } from "@/lib/condo-check";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const TONE = { not_recorded: "amber", current: "green", repairs_pending: "amber", overdue: "rose" } as const;
const FLAG = { bad: "text-bad", warn: "text-warn", note: "text-muted-foreground" } as const;

/**
 * A condo's building (lib/condo-check.ts): its age and inspections, its reserve study, paused reserves, special
 * assessments, the association's loans and website. A condo loan doesn't clear to close until this is recorded.
 */
export function CondoBuilding({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const today = serviceDay(s);
  const file = deal.condo;
  const { state, flags } = condoCheck(deal, today);
  const blank = (): CondoInput => file
    ? { association: file.association, stories: file.stories, units: file.units, coYear: file.coYear, at25: file.at25, milestone: file.milestone, sirsOn: file.sirsOn, reservesPaused: file.reservesPaused, assessment: file.assessment, associationLoan: file.associationLoan, websitePosted: file.websitePosted }
    : { association: "", stories: 1, units: 1, coYear: Number(today.slice(0, 4)) - 20, at25: false, reservesPaused: false, associationLoan: false, websitePosted: false };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CondoInput>(blank);
  const number = (key: "stories" | "units" | "coYear", label: string) => <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" type="number" inputMode="numeric" data-testid={`condo-${key}`} value={form[key]} onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) || 0 })} /></label>;
  const day = (value: string | undefined, set: (value: string | undefined) => void, label: string, testId: string) => <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" type="date" max={today} data-testid={testId} value={value ?? ""} onChange={(event) => set(event.target.value || undefined)} /></label>;
  const tick = (key: "at25" | "reservesPaused" | "associationLoan" | "websitePosted", label: string) => <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid={`condo-${key}`} checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} /> {label}</label>;
  const save = async () => { if (await dispatch({ t: "saveCondo", dealId: deal.id, condo: form, by: viewerName })) setEditing(false); };
  return (
    <Section title="Condo building" right={<Badge tone={TONE[state]}>{CONDO_STATE[state]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="condo-building">
        {file ? <p className="text-xs text-muted-foreground" data-testid="condo-summary">{file.association}: {file.stories} {file.stories === 1 ? "story" : "stories"}, {file.units} units, certificate of occupancy {file.coYear}. Recorded by {file.by}, {shortDay(file.at.slice(0, 10))}.</p>
          : <p className="text-warn">Not recorded yet. A condo loan clears to close once the building&apos;s inspections, reserve study and the association&apos;s debts are checked, from the association&apos;s documents and the building department.</p>}
        {flags.length > 0 && <ul className="space-y-0.5" data-testid="condo-flags">{flags.map((flag) => <li key={flag.text} className={FLAG[flag.level]}>{flag.text}</li>)}</ul>}
        {!editing && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="condo-edit" onClick={() => { setForm(blank()); setEditing(true); }}>{file ? "Update" : "Record the building"}</button>}
        <Reveal open={editing}>
          <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="condo-form">
            <label className="block"><span className="label">Association</span><input className="desk-input" data-testid="condo-association" maxLength={200} value={form.association} onChange={(event) => setForm({ ...form, association: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              {number("stories", "Habitable stories")}
              {number("units", "Units in the association")}
              {number("coYear", "Certificate of occupancy (year)")}
              {day(form.milestone?.phase1On, (value) => setForm({ ...form, milestone: { ...form.milestone, phase1On: value } }), "Last milestone inspection, phase 1", "condo-phase1")}
              {day(form.milestone?.phase2On, (value) => setForm({ ...form, milestone: { ...form.milestone, phase2On: value } }), "Phase 2 report, if one was needed", "condo-phase2")}
              {day(form.sirsOn, (value) => setForm({ ...form, sirsOn: value }), "Last structural integrity reserve study", "condo-sirs")}
              <label className="block min-w-0"><span className="label">Special assessment, the unit&apos;s share a month</span><input className="desk-input" inputMode="decimal" data-testid="condo-assessment" placeholder="None" value={form.assessment?.monthly ?? ""} onChange={(event) => { const monthly = Number(event.target.value.replace(/[^0-9.]/g, "")); setForm({ ...form, assessment: monthly ? { ...form.assessment, monthly } : undefined }); }} /></label>
              {form.assessment && day(form.assessment.endsOn, (value) => setForm({ ...form, assessment: { ...form.assessment!, endsOn: value } }), "Assessment ends (optional)", "condo-assessment-ends")}
            </div>
            <div className="space-y-1">
              {tick("at25", "The building department wants the first milestone inspection at 25 years (near salt water, for one)")}
              {form.milestone?.phase2On && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="condo-repairs-done" checked={Boolean(form.milestone.repairsDone)} onChange={(event) => setForm({ ...form, milestone: { ...form.milestone, repairsDone: event.target.checked } })} /> The repairs phase 2 called for are done</label>}
              {tick("reservesPaused", "The association has paused its reserve contributions")}
              {tick("associationLoan", "The association has a loan or credit line")}
              {tick("websitePosted", "The association posts its records on a website")}
            </div>
            <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="condo-save" disabled={!form.association.trim()} onClick={() => void save()}>Save</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
