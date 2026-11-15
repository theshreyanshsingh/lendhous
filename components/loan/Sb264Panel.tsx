"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section } from "@/components/ui";
import type { Deal, Sb264Answers } from "@/lib/mockData";
import { DOMICILES, prefilledPeople, sb264Check, type Sb264Input } from "@/lib/sb264";
import { useStore } from "@/lib/store";

const STATE = { clear: ["Clear", "green"], answers_needed: ["Answers needed", "amber"], stop: ["Can't buy", "rose"] } as const;
const STATUS: Record<Sb264Answers["people"][number]["status"], string> = { citizen: "U.S. citizen", permanent_resident: "U.S. permanent resident", other: "Neither" };
const VISA: Record<Sb264Answers["people"][number]["visa"], string> = { none: "No (or a tourist visa)", non_tourist: "A non-tourist visa", asylum: "Asylum" };

/**
 * Florida's limits on buyers from countries of concern (lib/sb264.ts), on the Credit review tab of a purchase. U.S.
 * citizens and permanent residents clear from the application; anyone else needs a domicile, and a buyer from a country
 * of concern needs the property's distance from military installations and critical infrastructure.
 */
export function Sb264Panel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const result = sb264Check(deal);
  const blank = (): Sb264Input => deal.sb264
    ? { people: deal.sb264.people, entityCountry: deal.sb264.entityCountry, acres: deal.sb264.acres, militaryWithin5: deal.sb264.militaryWithin5, sensitiveWithin10: deal.sb264.sensitiveWithin10, agricultural: deal.sb264.agricultural }
    : { people: prefilledPeople(deal), entityCountry: "US", militaryWithin5: "unknown", sensitiveWithin10: "unknown", agricultural: false };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Sb264Input>(blank);
  if (!result) return null;
  const person = (index: number, change: Partial<Sb264Answers["people"][number]>) => setForm({ ...form, people: form.people.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  const save = async () => { if (await dispatch({ t: "saveSb264", dealId: deal.id, answers: form, by: viewerName })) setEditing(false); };
  return (
    <Section title="Buyers from countries of concern (SB 264)" right={<Badge tone={STATE[result.state][1]}>{STATE[result.state][0]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="sb264">
        <ul className="space-y-0.5" data-testid="sb264-lines">{result.lines.map((line) => <li key={line} className={result.state === "stop" && line.includes("can't") ? "text-bad" : result.state === "clear" ? "text-muted-foreground" : "text-warn"}>{line}</li>)}</ul>
        <p className="text-xs text-muted-foreground">The title company collects every buyer&apos;s affidavit under the law at closing. Property bought in breach is forfeited to the state, subject to the mortgage, but the exit is gone.</p>
        {!editing && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="sb264-edit" onClick={() => { setForm(blank()); setEditing(true); }}>{deal.sb264 ? "Change the answers" : "Answer the questions"}</button>}
        <Reveal open={editing}>
          <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="sb264-form">
            {form.people.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-4" data-testid="sb264-person">
                <label className="block min-w-0"><span className="label">Buyer or owner</span><input className="desk-input" value={item.name} maxLength={160} onChange={(event) => person(index, { name: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Is a</span><select className="desk-input" data-testid="sb264-status" value={item.status} onChange={(event) => person(index, { status: event.target.value as Sb264Answers["people"][number]["status"] })}>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="block min-w-0"><span className="label">Domiciled in</span><select className="desk-input" data-testid="sb264-domicile" value={item.domicile} onChange={(event) => person(index, { domicile: event.target.value })}><option value="">Choose</option>{Object.entries(DOMICILES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="block min-w-0"><span className="label">Here lawfully on</span><select className="desk-input" data-testid="sb264-visa" value={item.visa} onChange={(event) => person(index, { visa: event.target.value as Sb264Answers["people"][number]["visa"] })}>{Object.entries(VISA).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block min-w-0"><span className="label">The borrowing entity is organized in, or run from</span><select className="desk-input" data-testid="sb264-entity" value={form.entityCountry} onChange={(event) => setForm({ ...form, entityCountry: event.target.value })}>{Object.entries(DOMICILES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">Lot size in acres (optional)</span><input className="desk-input" inputMode="decimal" data-testid="sb264-acres" value={form.acres ?? ""} onChange={(event) => { const acres = Number(event.target.value.replace(/[^0-9.]/g, "")); setForm({ ...form, acres: acres || undefined }); }} /></label>
              <label className="block min-w-0"><span className="label">Within 10 miles of a military installation or critical infrastructure</span><select className="desk-input" data-testid="sb264-within10" value={form.sensitiveWithin10} onChange={(event) => setForm({ ...form, sensitiveWithin10: event.target.value as Sb264Input["sensitiveWithin10"] })}><option value="unknown">Not checked</option><option value="no">No</option><option value="yes">Yes</option></select></label>
              <label className="block min-w-0"><span className="label">Within 5 miles of a military installation</span><select className="desk-input" data-testid="sb264-within5" value={form.militaryWithin5} onChange={(event) => setForm({ ...form, militaryWithin5: event.target.value as Sb264Input["militaryWithin5"] })}><option value="unknown">Not checked</option><option value="no">No</option><option value="yes">Yes</option></select></label>
            </div>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="sb264-agricultural" checked={form.agricultural} onChange={(event) => setForm({ ...form, agricultural: event.target.checked })} /> The property is agricultural land</label>
            <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="sb264-save" onClick={() => void save()}>Save</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
