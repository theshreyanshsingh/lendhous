"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore, est, capitalSummary } from "@/lib/store";
import { pipelineStages } from "@/lib/mockData";
import { PageIntro } from "@/components/page-intro";
import { Badge, GradeBadge, ColorDot, usd, pct, k, productLabel, statusLabel, capTone } from "@/components/ui";

export default function Pipeline() {
  const { s } = useStore();
  const [product, setProduct] = useState("all"); const [q, setQ] = useState("");
  const rows = useMemo(() => s.deals.map((d) => ({ d, e: est(d.app) })).filter(({ d }) => (product === "all" || d.app.product === product) && (q === "" || (d.borrowerName + d.address + d.loanNumber).toLowerCase().includes(q.toLowerCase()))), [s.deals, product, q]);
  const cap = capitalSummary(s.deals).find((r) => r.source.id === "gt-main")!;
  const pre = s.deals.filter((d) => !["servicing_current", "servicing_delinquent", "paid_off", "funded", "matured", "default"].includes(d.status));
  const counts = pipelineStages.slice(0, 9).map((st) => ({ ...st, n: s.deals.filter((d) => d.status === st.code).length, amt: s.deals.filter((d) => d.status === st.code).reduce((a, d) => a + est(d.app).noteAmount, 0) }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageIntro eyebrow="Underwriting" title="Pipeline" lede="Every ratio is recalculated live from the pricing config. Click a deal to open its workspace." />
        <div className="mb-6 grid grid-cols-3 gap-3 text-right">
          <div className="glass px-3 py-2"><div className="text-xs text-muted-foreground">Open pipeline</div><div className="font-heading text-base font-semibold whitespace-nowrap sm:text-xl">{pre.length} · {k(pre.reduce((a, d) => a + est(d.app).noteAmount, 0))}</div></div>
          <div className="glass px-3 py-2"><div className="text-xs text-muted-foreground">GT available</div><div className="font-heading text-base font-semibold whitespace-nowrap sm:text-xl text-good">{k(cap.available)}</div></div>
          <div className="glass px-3 py-2"><div className="text-xs text-muted-foreground">Bids waiting</div><div className="font-heading text-base font-semibold whitespace-nowrap sm:text-xl text-foreground">{s.bids.filter((b) => b.status === "submitted").length}</div></div>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {counts.map((c) => <div key={c.code} className="glass min-w-[120px] flex-1 px-3 py-2"><div className="text-xs text-muted-foreground">{c.label}</div><div className="font-heading text-2xl font-semibold">{c.n}</div><div className="text-xs text-faint">{c.amt ? k(c.amt) : "—"}</div></div>)}
      </div>
      <div className="glass overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <input className="desk-input w-56" placeholder="Search borrower, address, loan #" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="desk-input w-auto" value={product} onChange={(e) => setProduct(e.target.value)}><option value="all">All products</option>{Object.entries(productLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><ColorDot color="green" /> within limit</span><span className="flex items-center gap-1"><ColorDot color="yellow" /> within 2.5 pts</span><span className="flex items-center gap-1"><ColorDot color="red" /> over limit</span></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] [&_td]:px-3 [&_th]:px-3 [&_th]:whitespace-nowrap" data-testid="pipeline-table">
            <thead className="bg-muted/60"><tr><th>Loan</th><th>Borrower / property</th><th>Product</th><th className="text-right">Amount</th><th>LTV</th><th>LTC</th><th>LTARV</th><th>DSCR</th><th>Score</th><th>Status</th><th>Capital</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ d, e }) => {
                const r = (key: string) => e.ratios.find((x) => x.key === key);
                const cell = (key: string, mult = false) => { const x = r(key); if (!x) return <span className="text-faint">—</span>; return <span className="inline-flex items-center gap-1.5 font-medium"><ColorDot color={x.color} />{mult ? x.actual.toFixed(2) + "x" : pct(x.actual)}</span>; };
                const ltvCell = r("ltv") ? cell("ltv") : <span className="text-faint" title="Total loan ÷ as-is (rehab loans exceed 100% by design)">{pct(e.noteAmount / d.app.purchasePrice)}</span>;
                return (
                  <tr key={d.id} className="hover:bg-hover/60">
                    <td><Link href={`/admin/deals/${d.id}`} className="whitespace-nowrap font-semibold text-link hover:underline">{d.loanNumber}</Link><div className="text-xs text-faint">{d.daysInStage}d in stage</div></td>
                    <td className="min-w-56"><div className="font-medium whitespace-nowrap">{d.borrowerName}</div><div className="text-xs text-muted-foreground">{d.address}, {d.city} · {d.app.county}</div></td>
                    <td>{productLabel[d.app.product]}{d.contractorIsGtAffiliate && <div><Badge tone="rose">GT contractor (COI)</Badge></div>}</td>
                    <td className="text-right font-semibold">{usd(e.noteAmount)}</td>
                    <td>{ltvCell}</td><td>{cell("ltc")}</td><td>{cell("ltarv")}</td><td>{cell("dscr", true)}</td>
                    <td><GradeBadge grade={e.score.grade} score={e.score.score} /></td>
                    <td><Badge tone="blue">{statusLabel(d.status)}</Badge></td>
                    <td><Badge tone={capTone(d.capitalStatus)}>{statusLabel(d.capitalStatus)}</Badge>{d.route && <div className="text-[11px] text-faint">{d.route.replace("_", "-")}</div>}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="glass p-4"><div className="eyebrow mb-2">Activity (audit log, demo)</div><ul className="space-y-1 text-xs text-muted-foreground">{s.audit.slice(0, 6).map((a, i) => <li key={i}><span className="text-faint">{new Date(a.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT</span> · {a.text}</li>)}</ul></div>
    </div>
  );
}
