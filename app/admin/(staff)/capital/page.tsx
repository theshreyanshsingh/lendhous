"use client";
import Link from "next/link";
import { useStore, est, capitalSummary } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
import { Section, Stat, usd, k, pct, productLabel, statusLabel, Badge } from "@/components/ui";

export default function Capital() {
  const { s } = useStore();
  const rows = capitalSummary(s.deals, s.sources);
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
        <div className="glass p-4"><Stat label="Available now" value={<span className="text-good">{k(tot.av)}</span>} /></div>
      </div>
      <Section title="Sources">
        <table className="stack-table w-full"><thead><tr><th>Source</th><th className="text-right">Commitment</th><th className="text-right">Reserved</th><th className="text-right">Committed</th><th className="text-right">Deployed</th><th className="text-right">Unfunded</th><th className="text-right">Available</th></tr></thead>
          <tbody className="divide-y divide-border">{rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No capital sources yet.</td></tr>}{rows.map((r) => <tr key={r.source.id}><td className="font-medium">{r.source.name}{r.source.lineUndrawn !== undefined && <div className="text-[11px] text-faint">capped by undrawn line {usd(r.source.lineUndrawn)}</div>}</td><td data-label="Commitment" className="text-right">{usd(r.source.commitment)}</td><td data-label="Reserved" className="text-right">{usd(r.reserved)}</td><td data-label="Committed" className="text-right">{usd(r.committed)}</td><td data-label="Deployed" className="text-right">{usd(r.deployed)}</td><td data-label="Unfunded" className="text-right">{usd(r.unfunded)}</td><td data-label="Available" className="text-right font-semibold text-good">{usd(r.available)}</td></tr>)}</tbody></table>
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
