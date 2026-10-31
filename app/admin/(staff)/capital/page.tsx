"use client";
import Link from "next/link";
import { useState } from "react";
import type { CapitalSource } from "@/lib/mockData";
import { useStore, est, capitalSummary } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
import { Section, Stat, usd, k, pct, productLabel, statusLabel, Badge } from "@/components/ui";

export default function Capital() {
  const { s, dispatch } = useStore();
  const [editing, setEditing] = useState<CapitalSource | "new" | null>(null);
  const rows = capitalSummary(s.deals, s.sources);
  const inUse = (id: string) => s.deals.some((deal) => deal.allocations.some((item) => item.sourceId === id));
  const tot = rows.reduce((a, r) => ({ c: a.c + r.source.commitment, av: a.av + r.available, dep: a.dep + r.deployed, un: a.un + r.unfunded }), { c: 0, av: 0, dep: 0, un: 0 });
  const routed = s.deals.filter((d) => d.allocations.length > 0);
  const mix = { in_house: 0, partner: 0, split: 0 } as Record<string, number>;
  routed.forEach((d) => { if (d.route) mix[d.route] += est(d.app).noteAmount; });
  const mixTot = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Money" title="Capital dashboard" lede="Available = Commitment − Reserved − Committed − Deployed − Unfunded holdbacks. Each allocation sits in one bucket at a time." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Total commitment" value={k(tot.c)} /></div>
        <div className="glass p-4"><Stat label="Deployed" value={k(tot.dep)} sub={`utilization ${tot.c ? pct(tot.dep / tot.c, 0) : "—"}`} /></div>
        <div className="glass p-4"><Stat label="Unfunded holdbacks" value={k(tot.un)} sub="counts against available" /></div>
        <div className="glass p-4"><Stat label="Available now" value={<span className="text-good" data-testid="capital-available">{k(tot.av)}</span>} /></div>
      </div>
      <Section title="Sources" right={<button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="add-source" onClick={() => setEditing("new")}>Add a source</button>}>
        {editing && <SourceForm source={editing === "new" ? undefined : editing} taken={s.sources} onClose={() => setEditing(null)} />}
        <table className="stack-table w-full"><thead><tr><th>Source</th><th className="text-right">Commitment</th><th className="text-right">Reserved</th><th className="text-right">Committed</th><th className="text-right">Deployed</th><th className="text-right">Unfunded</th><th className="text-right">Available</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-border">{rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No capital sources yet. Add your fund so loans can be routed against it.</td></tr>}{rows.map((r) => <tr key={r.source.id}><td className="font-medium">{r.source.name}{r.source.lineUndrawn !== undefined && <div className="text-[11px] text-faint">capped by undrawn line {usd(r.source.lineUndrawn)}</div>}</td><td data-label="Commitment" className="text-right">{usd(r.source.commitment)}</td><td data-label="Reserved" className="text-right">{usd(r.reserved)}</td><td data-label="Committed" className="text-right">{usd(r.committed)}</td><td data-label="Deployed" className="text-right">{usd(r.deployed)}</td><td data-label="Unfunded" className="text-right">{usd(r.unfunded)}</td><td data-label="Available" className="text-right font-semibold text-good">{usd(r.available)}</td><td className="text-right lg:whitespace-nowrap"><button type="button" className="text-xs text-link underline" data-testid="edit-source" onClick={() => setEditing(r.source)}>Edit</button>{!inUse(r.source.id) && <button type="button" className="ml-3 text-xs text-bad underline" data-testid="remove-source" onClick={() => void dispatch({ t: "removeSource", id: r.source.id })}>Remove</button>}</td></tr>)}</tbody></table>
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Routing mix ($)">
          {(["in_house", "partner", "split"] as const).map((r) => <div key={r} className="mb-2"><div className="flex justify-between text-sm"><span>{r === "in_house" ? "In-house" : r === "partner" ? "Partner" : "Split"}</span><b>{usd(mix[r])} · {pct(mix[r] / mixTot, 0)}</b></div><div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(mix[r] / mixTot) * 100}%` }} /></div></div>)}
        </Section>
        <Section title="Allocations by deal">
          <ul className="divide-y divide-border text-sm">{routed.length === 0 && <li className="py-2 text-muted-foreground">No allocations yet.</li>}{routed.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><Link className="text-link hover:underline" href={`/admin/deals/${d.id}`}>{d.loanNumber} · {productLabel[d.app.product]}</Link><span className="flex items-center gap-2"><Badge>{d.allocations.some((a) => a.sourceId.startsWith("buyer:")) ? "Sold" : statusLabel(d.capitalStatus)}</Badge><b>{usd(d.allocations.reduce((a, x) => a + x.amount, 0))}</b></span></li>)}</ul>
        </Section>
      </div>
    </div>
  );
}

// In-house routing reads the source with this id, so the first fund takes it.
const IN_HOUSE_ID = "gt-main";

function SourceForm({ source, taken, onClose }: { source?: CapitalSource; taken: CapitalSource[]; onClose: () => void }) {
  const { dispatch } = useStore();
  const [form, setForm] = useState({ name: source?.name ?? "", type: source?.type ?? "gt_balance_sheet", commitment: source?.commitment ?? 0, baseDeployed: source?.baseDeployed ?? 0, baseUnfunded: source?.baseUnfunded ?? 0, lineUndrawn: source?.lineUndrawn ?? 0 });
  const line = form.type === "gt_credit_line";
  const money = (key: "commitment" | "baseDeployed" | "baseUnfunded" | "lineUndrawn", label: string, hint?: string) => (
    <label className="block"><span className="label">{label}</span><input data-testid={`source-${key}`} className="desk-input" inputMode="numeric" value={form[key] ? form[key].toLocaleString("en-US") : ""} placeholder="0" onChange={(event) => setForm({ ...form, [key]: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })} />{hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}</label>
  );
  const save = async () => {
    const id = source?.id ?? (form.type === "gt_balance_sheet" && !taken.some((item) => item.id === IN_HOUSE_ID) ? IN_HOUSE_ID : `source-${crypto.randomUUID()}`);
    const done = await dispatch({ t: "saveSource", source: { id, name: form.name.trim(), type: form.type, commitment: form.commitment, baseDeployed: form.baseDeployed, baseUnfunded: form.baseUnfunded, lineUndrawn: line ? form.lineUndrawn : undefined } });
    if (done) onClose();
  };
  return (
    <div className="mb-4 grid gap-3 rounded-[2px] border border-border p-4 sm:grid-cols-2" data-testid="source-form">
      <label className="block"><span className="label">Name</span><input data-testid="source-name" className="desk-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="block"><span className="label">Type</span><select className="desk-input" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CapitalSource["type"] })}><option value="gt_balance_sheet">Own fund</option><option value="gt_credit_line">Credit line</option></select></label>
      {money("commitment", "Total commitment")}
      {money("baseDeployed", "Already lent out", "Loans made before they were tracked here.")}
      {money("baseUnfunded", "Held back for draws", "For those same older loans.")}
      {line && money("lineUndrawn", "Undrawn on the line")}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="button" className="btn-primary" data-testid="save-source" disabled={!form.name.trim() || form.commitment <= 0} onClick={() => void save()}>Save</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
