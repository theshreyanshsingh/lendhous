"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { attentionItems } from "@/lib/attention";
import { serviceDay } from "@/lib/book";
import { daysInStage, STUCK_DAYS } from "@/lib/reports";
import { initialsOf, isMine } from "@/lib/loan-team";
import { closureReason, isClosedApplication, PRE_FUNDING } from "@/lib/loan-exits";
import { daysBetween, SERVICED } from "@/lib/servicing";
import type { Deal } from "@/lib/mockData";
import { downloadCsv } from "@/lib/csv";
import { useStore, est } from "@/lib/store";
import { pipelineStages } from "@/lib/mockData";
import { PageIntro } from "@/components/page-intro";
import { WorkQueue } from "@/components/WorkQueue";
import { PipelineBoard } from "@/components/PipelineBoard";
import { Badge, GradeBadge, ColorDot, usd, pct, k, productLabel, statusLabel, capTone } from "@/components/ui";

const TEAM_VIEW = "lendhous-pipeline-team";
const LAYOUT = "lendhous-pipeline-layout";
const VIEWS = { pipeline: "In the pipeline", funded: "Funded", ended: "Declined and withdrawn", all: "Every loan" } as const;
type View = keyof typeof VIEWS;
const inView = (deal: Deal, view: View) => view === "all" || (view === "pipeline" ? PRE_FUNDING.includes(deal.status) : view === "funded" ? deal.status === "paid_off" || SERVICED.includes(deal.status) : isClosedApplication(deal.status));
/** The capital side, only when it says something the stage doesn't. */
const capitalNote = (deal: Deal) => (deal.capitalStatus === "not_started" || (deal.capitalStatus === "funded" && !PRE_FUNDING.includes(deal.status)) ? null : statusLabel(deal.capitalStatus));
/** How long is left on a legal deadline, for Needs attention. */
function dueText(due: string, today: string) {
  if (!today) return { text: `due ${due}`, urgent: false };
  const left = daysBetween(today, due);
  return { text: left < 0 ? `${-left} day${left === -1 ? "" : "s"} late` : left === 0 ? "due today" : `${left} day${left === 1 ? "" : "s"} left`, urgent: left <= 2 };
}

export default function Pipeline() {
  const { s, newLeads, viewer } = useStore();
  const attention = attentionItems(s, newLeads);
  // Set after the first render: the server and the browser can disagree about today's date.
  const [today, setToday] = useState("");
  useEffect(() => { setToday(serviceDay(s)); }, [s]);
  const inStage = (deal: (typeof s.deals)[number]) => (today ? daysInStage(deal, today) : deal.daysInStage);
  const [product, setProduct] = useState("all"); const [q, setQ] = useState(""); const [view, setView] = useState<View>("pipeline");
  // Whose loans: everyone's, or the last choice made in this browser; Needs attention can send you to the unassigned ones.
  const [team, setTeam] = useState<"all" | "mine" | "unassigned">("all");
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("team");
    let saved: string | null = null;
    try { saved = localStorage.getItem(TEAM_VIEW); } catch {}
    const pick = asked ?? saved;
    if (pick === "mine" || pick === "unassigned") setTeam(pick);
  }, []);
  const chooseTeam = (next: typeof team) => { setTeam(next); try { localStorage.setItem(TEAM_VIEW, next); } catch {} };
  // A list or a board of columns by stage, remembered per browser.
  const [layout, setLayout] = useState<"list" | "board">("list");
  useEffect(() => { try { if (localStorage.getItem(LAYOUT) === "board") setLayout("board"); } catch {} }, []);
  const chooseLayout = (next: typeof layout) => { setLayout(next); try { localStorage.setItem(LAYOUT, next); } catch {} };
  const rows = useMemo(() => s.deals.map((d) => ({ d, e: est(d.app) })).filter(({ d }) => inView(d, view) && (product === "all" || d.app.product === product) && (q === "" || (d.borrowerName + d.address + d.loanNumber).toLowerCase().includes(q.toLowerCase())) && (team === "all" || (team === "mine" ? isMine(d, viewer) : !d.team?.officer))), [s.deals, product, q, view, team, viewer]);
  const pre = s.deals.filter((d) => !["servicing_current", "servicing_delinquent", "paid_off", "funded", "matured", "default", "declined", "withdrawn"].includes(d.status));
  const counts = pipelineStages.slice(0, 9).map((st) => ({ ...st, n: s.deals.filter((d) => d.status === st.code).length, amt: s.deals.filter((d) => d.status === st.code).reduce((a, d) => a + est(d.app).noteAmount, 0) }));
  const headline = "min-w-0 glass px-3 py-2";
  const figure = "font-heading text-base font-semibold wrap-anywhere sm:text-xl";
  const empty = s.deals.length === 0 ? "No loans in the pipeline yet." : "No loans match this search.";
  const exportRows = () => downloadCsv("lendhous-pipeline.csv", rows.map(({ d, e }) => ({ Loan: d.loanNumber, Borrower: d.borrowerName, Entity: d.entityName, Address: d.address, City: d.city, County: d.app.county, State: d.app.state, Product: productLabel[d.app.product], Amount: e.noteAmount, Rate: e.rate, Grade: e.score.grade, Score: e.score.score, Status: statusLabel(d.status), "Closed because": d.closure ? closureReason(d.closure) : "", Capital: statusLabel(d.capitalStatus), "Target closing": d.closingDate })));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-80"><PageIntro eyebrow="Underwriting" title="Pipeline" lede="Applications and loans on their way to funding, checked against today's pricing. Open one to work it." /></div>
        <div className="mb-6 flex w-full flex-col gap-3 sm:w-auto">
        <Link href="/admin/new-loan" className="btn-primary sm:self-end" data-testid="new-loan">+ New loan</Link>
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:text-right">
          <div className={headline}><div className="text-xs text-muted-foreground">Open pipeline</div><div className={figure}>{pre.length} · {k(pre.reduce((a, d) => a + est(d.app).noteAmount, 0))}</div></div>
          <div className={headline}><div className="text-xs text-muted-foreground">Bids waiting</div><div className={`${figure} text-foreground`}>{s.bids.filter((b) => b.status === "submitted").length}</div></div>
        </div>
        </div>
      </div>
      <WorkQueue />
      {attention.length > 0 && (
        <section className="glass min-w-0 px-4 py-3" data-testid="attention">
          <h2 className="eyebrow mb-1">Everything waiting, by kind</h2>
          <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
            {attention.map((item) => <li key={item.key} className="border-b border-border last:border-0 sm:border-0"><Link href={item.href} className="flex min-h-9 items-center justify-between gap-3 py-0.5 text-[13px] text-muted-foreground hover:text-foreground hover:underline" data-testid={`attention-${item.key}`}><span className="min-w-0">{item.label}{item.due && (() => { const due = dueText(item.due, today); return <span className={`ml-1.5 text-xs font-medium ${due.urgent ? "text-bad" : "text-warn"}`} data-testid="attention-due">{due.text}</span>; })()}</span><b className="shrink-0">{item.count}</b></Link></li>)}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9" data-testid="stage-counts">
        {counts.map((c) => <div key={c.code} className="glass min-w-0 px-2.5 py-2"><div className="min-h-8 text-xs leading-tight text-muted-foreground">{c.label}</div><div className="font-heading text-2xl font-semibold">{c.n}</div><div className="text-xs text-faint">{c.amt ? k(c.amt) : "—"}</div></div>)}
      </div>
      <div className="glass overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <input className="desk-input w-full sm:w-56" placeholder="Search borrower, address, loan #" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="desk-input w-full sm:w-auto" value={product} onChange={(e) => setProduct(e.target.value)}><option value="all">All products</option>{Object.entries(productLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="desk-input w-full sm:w-auto" data-testid="pipeline-team" aria-label="Whose loans" value={team} onChange={(e) => chooseTeam(e.target.value as typeof team)}><option value="all">Everyone&apos;s loans</option><option value="mine">My loans</option><option value="unassigned">No loan officer</option></select>
          <select className="desk-input w-full sm:w-auto" data-testid="pipeline-ended" aria-label="Which loans" value={view} onChange={(e) => setView(e.target.value as View)}>{(Object.keys(VIEWS) as View[]).map((key) => <option key={key} value={key}>{VIEWS[key]} ({s.deals.filter((d) => inView(d, key)).length})</option>)}</select>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:ml-auto"><span className="flex items-center gap-1"><ColorDot color="green" /> within limit</span><span className="flex items-center gap-1"><ColorDot color="yellow" /> within 2.5 pts</span><span className="flex items-center gap-1"><ColorDot color="red" /> over limit</span></div>
          <div className="flex w-full gap-1 sm:w-auto" role="group" aria-label="Show as">
            {(["list", "board"] as const).map((option) => <button key={option} type="button" aria-pressed={layout === option} data-testid={`layout-${option}`} className={`${layout === option ? "btn-primary" : "btn-ghost"} h-10! flex-1 px-3! text-xs! sm:flex-none`} onClick={() => chooseLayout(option)}>{option === "list" ? "List" : "Board"}</button>)}
          </div>
          <button type="button" className="btn-ghost h-10! w-full sm:w-auto" data-testid="export-pipeline" disabled={rows.length === 0} onClick={exportRows}>Export CSV</button>
        </div>
        {layout === "board" ? <PipelineBoard rows={rows.filter(({ d }) => PRE_FUNDING.includes(d.status))} today={today} inStage={inStage} /> : <>
        {/* Phones and tablets get one compact card per loan; eleven columns only work on a desktop screen. */}
        <ul className="divide-y divide-border xl:hidden" data-testid="pipeline-cards">
          {rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{empty}</li>}
          {rows.map(({ d, e }) => (
            <li key={d.id}>
              <Link href={`/admin/deals/${d.id}`} className="block p-4 hover:bg-hover/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="text-xs font-semibold text-link">{d.loanNumber}</div><div className="mt-0.5 font-medium wrap-anywhere">{d.borrowerName}</div><div className="text-xs text-muted-foreground">{d.address}, {d.city}</div></div>
                  <div className="shrink-0 text-right"><div className="font-semibold">{usd(e.noteAmount)}</div><div className="text-xs text-muted-foreground">{productLabel[d.app.product]}</div></div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{e.ratios.map((r) => <span key={r.key} className="inline-flex items-center gap-1"><ColorDot color={r.color} />{r.label} {r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual)}</span>)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5"><GradeBadge grade={e.score.grade} score={e.score.score} /><Badge tone="blue">{statusLabel(d.status)}</Badge>{capitalNote(d) && <Badge tone={capTone(d.capitalStatus)}>{capitalNote(d)}</Badge>}{d.contractorIsGtAffiliate && <Badge tone="rose">Affiliated contractor (COI)</Badge>}</div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden xl:block">
          <table className="w-full [&_td]:px-2.5 [&_th]:px-2.5 [&_th]:whitespace-nowrap" data-testid="pipeline-table">
            <thead className="bg-muted/60"><tr><th>Loan</th><th>Borrower / property</th><th className="text-right">Amount</th><th title="Loan to value, for loans priced on it">LTV</th><th>LTC</th><th>LTARV</th><th>DSCR</th><th>Score</th><th>Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">{empty}</td></tr>}
              {rows.map(({ d, e }) => {
                const r = (key: string) => e.ratios.find((x) => x.key === key);
                const cell = (key: string, mult = false) => { const x = r(key); if (!x) return <span className="text-faint">—</span>; return <span className="inline-flex items-center gap-1.5 font-medium"><ColorDot color={x.color} />{mult ? x.actual.toFixed(2) + "x" : pct(x.actual)}</span>; };
                return (
                  <tr key={d.id} className="hover:bg-hover/60">
                    <td><Link href={`/admin/deals/${d.id}`} className="whitespace-nowrap font-semibold text-link hover:underline">{d.loanNumber}</Link><div className="text-xs whitespace-nowrap text-muted-foreground">{productLabel[d.app.product]}</div><div className="mt-0.5 text-xs" data-testid="officer">{d.team?.officer ? <span className="inline-flex items-center gap-1 text-muted-foreground" title={`Loan officer: ${d.team.officer.name}`}><span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground" aria-hidden="true">{initialsOf(d.team.officer.name)}</span><span className="sr-only">Loan officer: {d.team.officer.name}</span></span> : <span className="text-faint">No loan officer</span>}</div><div className={`text-xs ${inStage(d) > STUCK_DAYS && pre.includes(d) ? "font-medium text-warn" : "text-faint"}`} data-testid="days-in-stage">{inStage(d)}d in stage</div></td>
                    <td className="min-w-52"><div className="font-medium">{d.borrowerName}</div><div className="text-xs text-muted-foreground">{d.address}, {d.city} · {d.app.county}</div>{d.contractorIsGtAffiliate && <div className="mt-1"><Badge tone="rose">Affiliated contractor (COI)</Badge></div>}</td>
                    <td className="text-right font-semibold">{usd(e.noteAmount)}</td>
                    <td>{cell("ltv")}</td><td>{cell("ltc")}</td><td>{cell("ltarv")}</td><td>{cell("dscr", true)}</td>
                    <td><GradeBadge grade={e.score.grade} score={e.score.score} /></td>
                    <td><div className="flex flex-col items-start gap-1" data-testid="pipeline-status"><Badge tone="blue">{statusLabel(d.status)}</Badge>{capitalNote(d) && <span className="text-xs text-muted-foreground">Capital: {capitalNote(d)}</span>}</div></td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
        </>}
      </div>
      <div className="glass p-4"><div className="eyebrow mb-2">Activity</div><ul className="space-y-1 text-xs text-muted-foreground">{s.audit.length === 0 && <li>No activity yet.</li>}{s.audit.slice(0, 6).map((a, i) => <li key={i}><span className="text-faint">{new Date(a.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT</span> · {a.text}</li>)}</ul></div>
    </div>
  );
}
