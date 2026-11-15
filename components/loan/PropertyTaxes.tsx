"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { shortDay } from "@/lib/format";
import type { Deal, TaxCheck } from "@/lib/mockData";
import { billYear, latestChecks, TAX_STATUS, taxStage, taxTask } from "@/lib/property-taxes";
import { useStore } from "@/lib/store";

const TONE: Record<TaxCheck["status"], "green" | "amber" | "rose"> = { paid: "green", unpaid: "amber", delinquent: "rose", certificate_sold: "rose" };
const newId = () => `tax${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The property's taxes (lib/property-taxes.ts): its parcels, and each year's bill as last checked on the county tax
 * collector's site. LendHous doesn't escrow taxes, so this is how an unpaid bill is caught before a tax certificate is
 * sold ahead of the mortgage.
 */
export function PropertyTaxes({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const today = serviceDay(s);
  const year = billYear(today);
  const parcels = deal.taxes?.parcels ?? [];
  const latest = latestChecks(deal, year);
  const task = taxTask(deal, today);
  const stage = taxStage(deal, today);
  const [editing, setEditing] = useState(false);
  const [parcelText, setParcelText] = useState(parcels.join("\n"));
  const [recording, setRecording] = useState(false);
  const blank = () => ({ parcel: parcels[0] ?? "", year, amount: "", status: "paid" as TaxCheck["status"], paidOn: "", checkedOn: today, note: "" });
  const [form, setForm] = useState(blank);
  const saveParcels = async () => { if (await dispatch({ t: "saveTaxParcels", dealId: deal.id, parcels: parcelText.split(/[\n,;]+/) })) setEditing(false); };
  const record = async () => {
    const check = { parcel: form.parcel, year: form.year, amount: form.amount === "" ? undefined : Number(form.amount), status: form.status, paidOn: form.status === "paid" && form.paidOn ? form.paidOn : undefined, checkedOn: form.checkedOn, note: form.note };
    if (await dispatch({ t: "recordTaxCheck", dealId: deal.id, checkId: newId(), check, by: viewerName })) setRecording(false);
  };
  const history = [...(deal.taxes?.checks ?? [])].sort((a, b) => b.checkedOn.localeCompare(a.checkedOn) || b.at.localeCompare(a.at)).slice(0, 8);
  return (
    <Section title="Property taxes" right={stage === null && parcels.length ? <Badge tone="green">{year} paid</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="property-taxes">
        <p className="text-xs text-muted-foreground">LendHous doesn&apos;t escrow taxes. Florida&apos;s bills go out November 1, are delinquent April 1, and by June 1 the county sells a tax certificate on an unpaid parcel, which comes ahead of the mortgage.</p>
        {task && <p className={stage === "certificate" || stage === "delinquent" ? "text-bad" : "text-warn"} data-testid="tax-task">{task}.</p>}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Parcels</p>
            {!editing && <button type="button" className="text-xs text-link underline" data-testid="tax-parcels-edit" onClick={() => { setParcelText(parcels.join("\n")); setEditing(true); }}>{parcels.length ? "Change" : "Add"}</button>}
          </div>
          {!editing && (parcels.length ? (
            <ul className="mt-1 space-y-1" data-testid="tax-parcels">{parcels.map((parcel) => { const check = latest.get(parcel); return <li key={parcel} className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{parcel}</span>{check ? <span className="text-xs"><Badge tone={TONE[check.status]}>{year}: {TAX_STATUS[check.status]}</Badge>{check.amount !== undefined ? ` ${usd(check.amount, 2)}` : ""} · checked {shortDay(check.checkedOn)}</span> : <span className="text-xs text-muted-foreground">{year} bill not checked</span>}</li>; })}</ul>
          ) : <p className="text-xs text-muted-foreground">No parcel number yet. It&apos;s on the county property appraiser&apos;s record and the title commitment.</p>)}
          <Reveal open={editing}>
            <div className="mt-2 space-y-2">
              <label className="block"><span className="label">Parcel numbers, one per line</span><textarea className="desk-input min-h-16 font-mono text-xs" data-testid="tax-parcels-input" maxLength={1200} value={parcelText} onChange={(event) => setParcelText(event.target.value)} /></label>
              <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="tax-parcels-save" onClick={() => void saveParcels()}>Save</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setEditing(false)}>Cancel</button></div>
            </div>
          </Reveal>
        </div>
        {parcels.length > 0 && !recording && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="tax-record-open" onClick={() => { setForm(blank()); setRecording(true); }}>Record what the county shows</button>}
        <Reveal open={recording}>
          <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="tax-record-form">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block min-w-0"><span className="label">Parcel</span><select className="desk-input" data-testid="tax-record-parcel" value={form.parcel} onChange={(event) => setForm({ ...form, parcel: event.target.value })}>{parcels.map((parcel) => <option key={parcel} value={parcel}>{parcel}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">Tax year</span><select className="desk-input" data-testid="tax-record-year" value={form.year} onChange={(event) => setForm({ ...form, year: Number(event.target.value) })}>{[year, year - 1, year - 2].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">The bill (optional)</span><input className="desk-input" inputMode="decimal" data-testid="tax-record-amount" placeholder="$0.00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/[^0-9.]/g, "") })} /></label>
              <label className="block min-w-0"><span className="label">The county shows</span><select className="desk-input" data-testid="tax-record-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaxCheck["status"] })}>{(Object.entries(TAX_STATUS) as [TaxCheck["status"], string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              {form.status === "paid" && <label className="block min-w-0"><span className="label">Paid on (optional)</span><input className="desk-input" type="date" max={form.checkedOn} data-testid="tax-record-paid-on" value={form.paidOn} onChange={(event) => setForm({ ...form, paidOn: event.target.value })} /></label>}
              <label className="block min-w-0"><span className="label">Checked on</span><input className="desk-input" type="date" max={today} data-testid="tax-record-checked-on" value={form.checkedOn} onChange={(event) => setForm({ ...form, checkedOn: event.target.value })} /></label>
            </div>
            <label className="block"><span className="label">Note (optional)</span><input className="desk-input" data-testid="tax-record-note" maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
            <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="tax-record-save" disabled={!form.parcel || !form.checkedOn} onClick={() => void record()}>Save</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setRecording(false)}>Cancel</button></div>
          </div>
        </Reveal>
        {history.length > 0 && (
          <details className="text-xs" data-testid="tax-history">
            <summary className="cursor-pointer text-muted-foreground">Checks recorded ({deal.taxes!.checks.length})</summary>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">{history.map((check) => <li key={check.id}>{shortDay(check.checkedOn)}: {check.parcel}, {check.year}, {TAX_STATUS[check.status].toLowerCase()}{check.amount !== undefined ? `, ${usd(check.amount, 2)}` : ""}{check.paidOn ? `, paid ${shortDay(check.paidOn)}` : ""} ({check.by}){check.note ? `: ${check.note}` : ""}</li>)}</ul>
          </details>
        )}
      </div>
    </Section>
  );
}
