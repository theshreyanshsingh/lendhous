"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section, productLabel, shortDate } from "@/components/ui";
import { CATEGORIES, libraryOf, OWNERS, templateProblem } from "@/lib/conditions";
import type { Product } from "@/lib/engine";
import type { ConditionCategory, ConditionOwner, ConditionTemplate } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const small = "h-9! px-3! text-xs!";
const PRODUCTS: Product[] = ["fix_flip", "bridge", "ground_up", "dscr"];
type Draft = Pick<ConditionTemplate, "title" | "detail" | "category" | "owner" | "needsUpload" | "products" | "dueDays" | "active" | "rental"> & { id?: string };
const blank: Draft = { title: "", detail: "", category: "prior_to_funding", owner: "borrower", needsUpload: true, products: [], dueDays: 10, active: true };

function TemplateForm({ draft, onSave, onCancel }: { draft: Draft; onSave: (draft: Draft) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState(draft);
  const [days, setDays] = useState(String(draft.dueDays));
  const problem = templateProblem({ ...value, dueDays: Number(days) });
  const put = (changes: Partial<Draft>) => setValue((current) => ({ ...current, ...changes }));
  return (
    <div className="space-y-3 rounded-[2px] border border-border p-3 text-sm" data-testid="template-form">
      <label className="block"><span className="label">Condition</span><input className="desk-input" data-testid="template-title" maxLength={200} value={value.title} onChange={(event) => put({ title: event.target.value })} /></label>
      <label className="block"><span className="label">What&apos;s needed (the borrower sees this on theirs)</span><input className="desk-input" data-testid="template-detail" maxLength={1000} value={value.detail} onChange={(event) => put({ detail: event.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block min-w-0"><span className="label">When</span><select className="desk-input" data-testid="template-category" value={value.category} onChange={(event) => put({ category: event.target.value as ConditionCategory })}>{Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block min-w-0"><span className="label">Who it&apos;s for</span><select className="desk-input" data-testid="template-owner" value={value.owner} onChange={(event) => put({ owner: event.target.value as ConditionOwner })}>{Object.entries(OWNERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block min-w-0"><span className="label">Due after (days)</span><input className="desk-input" inputMode="numeric" data-testid="template-days" value={days} onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, ""))} /></label>
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><legend className="label">Loan types (none ticked means all)</legend>{PRODUCTS.map((product) => <label key={product} className="flex items-center gap-1.5"><input type="checkbox" checked={value.products.includes(product)} onChange={(event) => put({ products: event.target.checked ? [...value.products, product] : value.products.filter((item) => item !== product) })} />{productLabel[product]}</label>)}</fieldset>
      {value.products.includes("dscr") && <label className="block text-xs"><span className="label">Rentals it applies to</span><select className="desk-input w-auto!" data-testid="template-rental" value={value.rental ?? ""} onChange={(event) => put({ rental: (event.target.value || undefined) as Draft["rental"] })}><option value="">Leased and short-term</option><option value="long_term">Leased only</option><option value="short_term">Short-term (Airbnb, VRBO) only</option></select></label>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.needsUpload} onChange={(event) => put({ needsUpload: event.target.checked })} /> It needs a file sent in</label>
      {problem && value.title && <p className="text-xs text-warn">{problem}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={`btn-primary ${small}`} data-testid="save-template" disabled={Boolean(problem)} onClick={async () => { if (await onSave({ ...value, dueDays: Number(days) })) onCancel(); }}>Save</button><button type="button" className={`btn-ghost ${small}`} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/**
 * The standard conditions (Spec A23). A loan gets the active ones for its product when it starts clearing conditions.
 * Changing one changes it for loans from then on; loans that already have it keep theirs. Every change is a new version
 * in the audit log, and a retired one can be brought back.
 */
export function ConditionLibrary() {
  const { s, dispatch, viewerName } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const library = libraryOf(s);
  const save = (draft: Draft) => dispatch({ t: "saveConditionTemplate", template: draft, by: viewerName });
  return (
    <div className="space-y-4" data-testid="condition-library">
      {editing !== "new" && <button type="button" className={`btn-primary ${small}`} data-testid="new-template" onClick={() => setEditing("new")}>Add a standard condition</button>}
      <Reveal open={editing === "new"}>{editing === "new" && <TemplateForm draft={blank} onSave={save} onCancel={() => setEditing(null)} />}</Reveal>
      {(Object.keys(CATEGORIES) as ConditionCategory[]).map((category) => {
        const rows = library.filter((item) => item.category === category);
        if (!rows.length) return null;
        return (
          <Section key={category} title={CATEGORIES[category]}>
            <ul className="divide-y divide-border text-sm">
              {rows.map((item) => (
                <li key={item.id} className="space-y-1 py-2.5" data-testid="template-row">
                  {editing === item.id ? <TemplateForm draft={item} onSave={save} onCancel={() => setEditing(null)} /> : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0"><p className={`font-medium ${item.active ? "" : "text-muted-foreground line-through"}`}>{item.title}</p>{item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}</div>
                        <span className="flex flex-wrap items-center gap-1.5"><Badge>{OWNERS[item.owner]}</Badge>{!item.active && <Badge tone="slate">Retired</Badge>}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.products.length ? item.products.map((product) => productLabel[product]).join(", ") : "Every loan type"}{item.rental ? ` (${item.rental === "short_term" ? "short-term rentals" : "leased rentals"} only)` : ""} · due {item.dueDays} days after it&apos;s added{item.needsUpload ? " · needs a file" : ""} · version {item.version}, {item.updatedBy}{item.version > 1 ? ` on ${shortDate(item.updatedAt)}` : ""}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={`btn-ghost ${small}`} data-testid="edit-template" onClick={() => setEditing(item.id)}>Edit</button>
                        <button type="button" className={`btn-ghost ${small}`} data-testid={item.active ? "retire-template" : "restore-template"} onClick={() => void save({ ...item, active: !item.active })}>{item.active ? "Retire" : "Bring back"}</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}
