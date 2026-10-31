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
  const cap = capitalSummary(s.deals, s.sources).find((r) => r.source.id === "gt-main");
  const pre = s.deals.filter((d) => !["servicing_current", "servicing_delinquent", "paid_off", "funded", "matured", "default"].includes(d.status));
  const counts = pipelineStages.slice(0, 9).map((st) => ({ ...st, n: s.deals.filter((d) => d.status === st.code).length, amt: s.deals.filter((d) => d.status === st.code).reduce((a, d) => a + est(d.app).noteAmount, 0) }));
  const headline = "min-w-0 glass px-3 py-2";
  const figure = "font-heading text-base font-semibold wrap-anywhere sm:text-xl";
  const empty = s.deals.length === 0 ? "No loans in the pipeline yet." : "No loans match this search.";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><PageIntro eyebrow="Underwriting" title="Pipeline" lede="Every ratio is recalculated live from the pricing config. Open a deal to see its workspace." /></div>
        <div className="mb-6 grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-3 sm:text-right">
          <div className={`${headline} col-span-2 sm:col-span-1`}><div className="text-xs text-muted-foreground">Open pipeline</div><div className={figure}>{pre.length} · {k(pre.reduce((a, d) => a + est(d.app).noteAmount, 0))}</div></div>
          <div className={headline}><div className="text-xs text-muted-foreground">Capital available</div><div className={`${figure} text-good`} data-testid="capital-available">{cap ? k(cap.available) : "—"}</div></div>
          <div className={headline}><div className="text-xs text-muted-foreground">Bids waiting</div><div className={`${figure} text-foreground`}>{s.bids.filter((b) => b.status === "submitted").length}</div></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9" data-testid="stage-counts">
        {counts.map((c) => <div key={c.code} className="glass min-w-0 px-2.5 py-2"><div className="min-h-8 text-xs leading-tight text-muted-foreground">{c.label}</div><div className="font-heading text-2xl font-semibold">{c.n}</div><div className="text-xs text-faint">{c.amt ? k(c.amt) : "—"}</div></div>)}
      </div>
      <div className="glass overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <input className="desk-input w-full sm:w-56" placeholder="Search borrower, address, loan #" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="desk-input w-full sm:w-auto" value={product} onChange={(e) => setProduct(e.target.value)}><option value="all">All products</option>{Object.entries(productLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:ml-auto"><span className="flex items-center gap-1"><ColorDot color="green" /> within limit</span><span className="flex items-center gap-1"><ColorDot color="yellow" /> within 2.5 pts</span><span className="flex items-center gap-1"><ColorDot color="red" /> over limit</span></div>
        </div>
        {/* Phones and tablets get one compact card per loan; eleven columns only work on a desktop screen. */}
        <ul className="divide-y divide-border lg:hidden" data-testid="pipeline-cards">
          {rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{empty}</li>}
          {rows.map(({ d, e }) => (
            <li key={d.id}>
              <Link href={`/admin/deals/${d.id}`} className="block p-4 hover:bg-hover/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="text-xs font-semibold text-link">{d.loanNumber}</div><div className="mt-0.5 font-medium wrap-anywhere">{d.borrowerName}</div><div className="text-xs text-muted-foreground">{d.address}, {d.city}</div></div>
                  <div className="shrink-0 text-right"><div className="font-semibold">{usd(e.noteAmount)}</div><div className="text-xs text-muted-foreground">{productLabel[d.app.product]}</div></div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{e.ratios.map((r) => <span key={r.key} className="inline-flex items-center gap-1"><ColorDot color={r.color} />{r.label} {r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual)}</span>)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5"><GradeBadge grade={e.score.grade} score={e.score.score} /><Badge tone="blue">{statusLabel(d.status)}</Badge><Badge tone={capTone(d.capitalStatus)}>{statusLabel(d.capitalStatus)}</Badge>{d.contractorIsGtAffiliate && <Badge tone="rose">Affiliated contractor (COI)</Badge>}</div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1080px] [&_td]:px-3 [&_th]:px-3 [&_th]:whitespace-nowrap" data-testid="pipeline-table">
            <thead className="bg-muted/60"><tr><th>Loan</th><th>Borrower / property</th><th>Product</th><th className="text-right">Amount</th><th>LTV</th><th>LTC</th><th>LTARV</th><th>DSCR</th><th>Score</th><th>Status</th><th>Capital</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-muted-foreground">{empty}</td></tr>}
              {rows.map(({ d, e }) => {
                const r = (key: string) => e.ratios.find((x) => x.key === key);
                const cell = (key: string, mult = false) => { const x = r(key); if (!x) return <span className="text-faint">—</span>; return <span className="inline-flex items-center gap-1.5 font-medium"><ColorDot color={x.color} />{mult ? x.actual.toFixed(2) + "x" : pct(x.actual)}</span>; };
                const ltvCell = r("ltv") ? cell("ltv") : <span className="text-faint" title="Total loan ÷ as-is (rehab loans exceed 100% by design)">{pct(e.noteAmount / d.app.purchasePrice)}</span>;
                return (
                  <tr key={d.id} className="hover:bg-hover/60">
                    <td><Link href={`/admin/deals/${d.id}`} className="whitespace-nowrap font-semibold text-link hover:underline">{d.loanNumber}</Link><div className="text-xs text-faint">{d.daysInStage}d in stage</div></td>
                    <td className="min-w-56"><div className="font-medium whitespace-nowrap">{d.borrowerName}</div><div className="text-xs text-muted-foreground">{d.address}, {d.city} · {d.app.county}</div></td>
                    <td>{productLabel[d.app.product]}{d.contractorIsGtAffiliate && <div><Badge tone="rose">Affiliated contractor (COI)</Badge></div>}</td>
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
      <div className="glass p-4"><div className="eyebrow mb-2">Activity</div><ul className="space-y-1 text-xs text-muted-foreground">{s.audit.length === 0 && <li>No activity yet.</li>}{s.audit.slice(0, 6).map((a, i) => <li key={i}><span className="text-faint">{new Date(a.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT</span> · {a.text}</li>)}</ul></div>
    </div>
  );
}
