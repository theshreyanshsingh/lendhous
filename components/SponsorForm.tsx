"use client";
import { X } from "lucide-react";
import { CITIZENSHIP, DECLARATIONS, EXPERIENCE_MONTHS, TRACK_KIND } from "@/lib/credit";
import type { Declarations, Guarantor, Sponsor, TrackDeal } from "@/lib/mockData";

/** A declaration nobody has answered yet. Each one has to be answered on its own: there's no "no to all". */
export type Answers = Partial<Record<Exclude<keyof Declarations, "explanation">, boolean>> & { explanation: string };

export const allAnswered = (answers: Answers) => DECLARATIONS.every((item) => answers[item.key] !== undefined);
export const toDeclarations = (answers: Answers): Declarations => ({ ...Object.fromEntries(DECLARATIONS.map((item) => [item.key, Boolean(answers[item.key])])), explanation: answers.explanation } as Declarations);
export const fromDeclarations = (declarations: Declarations): Answers => ({ ...declarations });

const newGuarantor = (): Guarantor => ({ name: "", ownershipPct: 0, fico: 700, citizenship: "us" });
const newDeal = (): TrackDeal => ({ id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, address: "", kind: "flip", completed: "", purchasePrice: 0 });
const money = (value: number | undefined) => (value ? value.toLocaleString("en-US") : "");
const digits = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0;

/** Who guarantees the loan. Each person's own score and citizenship, because the loan is priced on the weakest of them. */
export function GuarantorFields({ guarantors, onChange }: { guarantors: Guarantor[]; onChange: (next: Guarantor[]) => void }) {
  const put = (index: number, changes: Partial<Guarantor>) => onChange(guarantors.map((item, at) => (at === index ? { ...item, ...changes } : item)));
  const owned = guarantors.reduce((sum, item) => sum + item.ownershipPct, 0);
  return (
    <div className="space-y-3" data-testid="guarantors">
      <p className="text-xs text-muted-foreground">Everyone who owns 20% or more of the LLC personally guarantees the loan. The loan is priced on the lowest of their credit scores.</p>
      {guarantors.map((item, index) => (
        <div key={index} className="grid gap-2 rounded-[2px] border border-border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
          <label className="block min-w-0"><span className="label">Full legal name</span><input className="desk-input" data-testid={`guarantor-name-${index}`} autoComplete={index === 0 ? "name" : "off"} maxLength={120} value={item.name} onChange={(event) => put(index, { name: event.target.value })} /></label>
          <label className="block min-w-0"><span className="label">Owns (%)</span><input className="desk-input" data-testid={`guarantor-own-${index}`} inputMode="numeric" value={item.ownershipPct || ""} onChange={(event) => put(index, { ownershipPct: Math.min(100, digits(event.target.value)) })} /></label>
          <label className="block min-w-0"><span className="label">Credit score</span><input className="desk-input" data-testid={`guarantor-fico-${index}`} inputMode="numeric" value={item.fico || ""} onChange={(event) => put(index, { fico: Math.min(900, digits(event.target.value)) })} /></label>
          <label className="block min-w-0"><span className="label">Citizenship</span><select className="desk-input" data-testid={`guarantor-citizen-${index}`} value={item.citizenship} onChange={(event) => put(index, { citizenship: event.target.value as Guarantor["citizenship"] })}>{Object.entries(CITIZENSHIP).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {guarantors.length > 1 ? <button type="button" aria-label={`Remove ${item.name || "this guarantor"}`} className="btn-ghost h-10! px-3!" onClick={() => onChange(guarantors.filter((_, at) => at !== index))}><X size={16} aria-hidden="true" /></button> : <span className="hidden sm:block sm:w-10" />}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {guarantors.length < 6 && <button type="button" className="btn-ghost" data-testid="add-guarantor" onClick={() => onChange([...guarantors, newGuarantor()])}>Add a guarantor</button>}
        <span className={`text-xs ${owned > 100 ? "text-bad" : owned < 51 ? "text-warn" : "text-muted-foreground"}`}>Guarantors own {owned}% of the LLC</span>
      </div>
    </div>
  );
}

/** Past deals, one row each. Only what was finished in the last 36 months counts toward experience. */
export function TrackRecordFields({ deals, onChange }: { deals: TrackDeal[]; onChange: (next: TrackDeal[]) => void }) {
  const put = (index: number, changes: Partial<TrackDeal>) => onChange(deals.map((item, at) => (at === index ? { ...item, ...changes } : item)));
  return (
    <div className="space-y-3" data-testid="track-record">
      <p className="text-xs text-muted-foreground">List the projects you finished in the last {EXPERIENCE_MONTHS} months: flips sold, rentals bought and stabilized, and builds completed. Experience lowers your rate and raises how much you can borrow. Each one is checked against its settlement statement, so list only deals you can document.</p>
      {deals.length === 0 && <p className="rounded-[2px] border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="no-track">No past deals listed. That&apos;s fine for a first project; it&apos;s priced as a first-time investor.</p>}
      {deals.map((item, index) => (
        <div key={item.id} className="grid gap-2 rounded-[2px] border border-border p-3 sm:grid-cols-6 sm:items-end" data-testid="track-row">
          <label className="block min-w-0 sm:col-span-2"><span className="label">Property address</span><input className="desk-input" data-testid={`deal-address-${index}`} maxLength={200} value={item.address} onChange={(event) => put(index, { address: event.target.value })} /></label>
          <label className="block min-w-0"><span className="label">Type</span><select className="desk-input" data-testid={`deal-kind-${index}`} value={item.kind} onChange={(event) => put(index, { kind: event.target.value as TrackDeal["kind"] })}>{Object.entries(TRACK_KIND).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block min-w-0"><span className="label">Finished</span><input className="desk-input" data-testid={`deal-completed-${index}`} type="month" placeholder="YYYY-MM" value={item.completed} onChange={(event) => put(index, { completed: event.target.value })} /></label>
          <label className="block min-w-0"><span className="label">Paid ($)</span><input className="desk-input" data-testid={`deal-price-${index}`} inputMode="numeric" value={money(item.purchasePrice)} onChange={(event) => put(index, { purchasePrice: digits(event.target.value) })} /></label>
          <div className="flex min-w-0 items-end gap-2">
            <label className="block min-w-0 flex-1"><span className="label">{item.kind === "rental" ? "Value ($)" : "Sold ($)"}</span><input className="desk-input" data-testid={`deal-sale-${index}`} inputMode="numeric" value={money(item.salePrice)} onChange={(event) => put(index, { salePrice: digits(event.target.value) || undefined })} /></label>
            <button type="button" aria-label="Remove this deal" data-testid={`remove-deal-${index}`} className="btn-ghost h-10! shrink-0 px-3!" onClick={() => onChange(deals.filter((_, at) => at !== index))}><X size={16} aria-hidden="true" /></button>
          </div>
        </div>
      ))}
      {deals.length < 40 && <button type="button" className="btn-ghost" data-testid="add-deal" onClick={() => onChange([...deals, newDeal()])}>Add a past deal</button>}
    </div>
  );
}

/** The questions every credit officer asks. A yes doesn't stop the application; it means someone reads the explanation. */
export function DeclarationFields({ answers, onChange }: { answers: Answers; onChange: (next: Answers) => void }) {
  const yes = DECLARATIONS.some((item) => answers[item.key]);
  return (
    <div className="space-y-3" data-testid="declarations">
      <p className="text-xs text-muted-foreground">For you, every guarantor and the borrowing entity. Answering yes doesn&apos;t mean no: it tells the team to read your explanation.</p>
      <ul className="divide-y divide-border rounded-[2px] border border-border">
        {DECLARATIONS.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="min-w-0 flex-1 basis-56 text-sm">{item.question}</span>
            <span className="flex gap-1" role="radiogroup" aria-label={item.question}>
              {([true, false] as const).map((value) => (
                <button key={String(value)} type="button" role="radio" aria-checked={answers[item.key] === value} data-testid={`decl-${item.key}-${value ? "yes" : "no"}`} className={`inline-flex h-9 min-w-14 items-center justify-center rounded-[2px] border px-3 text-sm font-medium transition-colors ${answers[item.key] === value ? (value ? "border-bad bg-bad text-white" : "border-primary bg-primary text-primary-foreground") : "border-rule text-foreground hover:bg-hover"}`} onClick={() => onChange({ ...answers, [item.key]: value })}>{value ? "Yes" : "No"}</button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {yes && <label className="block"><span className="label">Explain each yes: what happened and where it stands now</span><textarea className="desk-input h-auto! py-2" rows={4} maxLength={2000} data-testid="decl-explanation" value={answers.explanation} onChange={(event) => onChange({ ...answers, explanation: event.target.value })} /></label>}
    </div>
  );
}

export const emptyProfile = (): { entityState: string; guarantors: Guarantor[]; trackRecord: TrackDeal[]; answers: Answers } => ({ entityState: "FL", guarantors: [newGuarantor()], trackRecord: [], answers: { explanation: "" } });

export const toSponsor = (profile: ReturnType<typeof emptyProfile>): Sponsor => ({ entityState: profile.entityState.trim().toUpperCase(), guarantors: profile.guarantors.map((item) => ({ ...item, name: item.name.trim() })), trackRecord: profile.trackRecord.map((item) => ({ ...item, address: item.address.trim() })), declarations: toDeclarations(profile.answers) });
