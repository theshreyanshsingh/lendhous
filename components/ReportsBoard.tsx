"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Section, Stat, k as compact, productLabel, statGrid, statusLabel, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { downloadCsv } from "@/lib/csv";
import type { Product } from "@/lib/engine";
import { businessReport, daysFrom, reportRows, STUCK_DAYS, summaryRows, type Period } from "@/lib/reports";
import { addDays } from "@/lib/servicing";
import { useStore } from "@/lib/store";

const RANGES = [
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "This year" },
  { key: "custom", label: "Custom" },
] as const;
type Range = (typeof RANGES)[number]["key"];

function periodFor(range: Range, today: string, custom: Period): Period {
  const monthStart = `${today.slice(0, 8)}01`;
  if (range === "30d") return { from: addDays(today, -29), to: today };
  if (range === "month") return { from: monthStart, to: today };
  if (range === "last-month") { const end = addDays(monthStart, -1); return { from: `${end.slice(0, 8)}01`, to: end }; }
  if (range === "90d") return { from: addDays(today, -89), to: today };
  if (range === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return custom.from && custom.to && custom.from <= custom.to ? custom : { from: addDays(today, -29), to: today };
}

// "$0" rather than "$0k".
const k = (amount: number) => (Math.round(amount) ? compact(amount) : "$0");
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
const days = (value: number | null) => (value === null ? "–" : `${value} day${value === 1 ? "" : "s"}`);
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * One series of horizontal bars, longest first is up to the caller. The value sits in its own column so the numbers
 * line up; hovering or focusing a bar shows its note.
 */
function Bars({ rows, format, testid }: { rows: { label: string; value: number; note?: string }[]; format: (value: number) => string; testid?: string }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in this period.</p>;
  return (
    <ul className="space-y-2" data-testid={testid}>
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]" data-testid={testid && `${testid}-row`}>
          <span className="truncate text-muted-foreground" title={row.label}>{row.label}</span>
          <span className="group relative flex h-6 items-center outline-none" tabIndex={0} aria-label={`${row.label}: ${format(row.value)}${row.note ? `, ${row.note}` : ""}`}>
            <span className="h-3 rounded-r-[4px] bg-link transition-opacity group-hover:opacity-75 group-focus-visible:opacity-75" style={{ width: max ? `${(row.value / max) * 100}%` : 0, minWidth: row.value ? 3 : 0 }} />
            {row.note && <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden rounded-[2px] border border-border bg-card px-2 py-1 text-xs whitespace-nowrap shadow-[var(--shadow)] group-hover:block group-focus-visible:block"><b className="font-semibold text-foreground">{format(row.value)}</b> <span className="text-muted-foreground">{row.note}</span></span>}
          </span>
          <span className="text-right text-foreground tabular-nums">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReportsBoard() {
  const { s } = useStore();
  // Set after the first render: the server and the browser can disagree about today's date.
  const [today, setToday] = useState("");
  useEffect(() => { setToday(serviceDay(s)); }, [s]);
  const [range, setRange] = useState<Range>("90d");
  const [custom, setCustom] = useState<Period>({ from: "", to: "" });
  const period = today ? periodFor(range, today, custom) : null;
  const from = period?.from ?? "";
  const to = period?.to ?? "";
  const report = useMemo(() => (from ? businessReport(s, { from, to }, today) : null), [s, from, to, today]);
  if (!report || !period) return <div className="glass p-5 text-sm text-muted-foreground">Working out the numbers…</div>;
  const { pipeline, capital, portfolio } = report;
  const pull = pipeline.pullThrough;
  const late = portfolio.buckets.filter((bucket) => bucket.key !== "current").reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <div className="space-y-4" data-testid="reports">
      <div className="glass flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dates">
            {RANGES.map((item) => <button key={item.key} type="button" aria-pressed={range === item.key} data-testid={`range-${item.key}`} className={`${range === item.key ? "btn-primary" : "btn-ghost"} h-9! px-3! text-xs!`} onClick={() => { setRange(item.key); if (item.key === "custom" && !custom.from) setCustom(periodFor("30d", today, custom)); }}>{item.label}</button>)}
          </div>
          {range === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2"><span className="text-muted-foreground">From</span><input type="date" className="desk-input h-9! w-auto!" data-testid="range-from" value={custom.from} max={custom.to || today} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
              <label className="flex items-center gap-2"><span className="text-muted-foreground">to</span><input type="date" className="desk-input h-9! w-auto!" data-testid="range-to" value={custom.to} min={custom.from} max={today} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
            </div>
          ) : <p className="text-sm text-muted-foreground" data-testid="range-dates">{shortDay(period.from)} to {shortDay(period.to)} · {daysFrom(period.from, period.to) + 1} days</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost h-9! text-xs!" data-testid="export-summary" onClick={() => downloadCsv(`lendhous-report-${period.from}-to-${period.to}.csv`, summaryRows(report))}>Download summary</button>
          <button type="button" className="btn-ghost h-9! text-xs!" data-testid="export-loans" disabled={!s.deals.length} onClick={() => downloadCsv(`lendhous-loans-${today}.csv`, reportRows(s, today))}>Download every loan</button>
        </div>
      </div>

      <Section title="Pipeline in this period">
        <div className={statGrid}>
          <div data-testid="kpi-applications"><Stat label="Applications" value={pipeline.applications.count} sub={k(pipeline.applications.amount)} /></div>
          <div data-testid="kpi-term-sheets"><Stat label="Term sheets sent" value={pipeline.termSheets.count} sub={`${k(pipeline.termSheets.amount)} · ${pipeline.accepted.count} accepted`} /></div>
          <div data-testid="kpi-funded"><Stat label="Loans funded" value={pipeline.funded.count} sub={k(pipeline.funded.amount)} /></div>
          <div data-testid="kpi-lost"><Stat label="Declined or withdrawn" value={pipeline.declined.count + pipeline.withdrawn.count} sub={`${pipeline.declined.count} declined · ${pipeline.withdrawn.count} withdrawn`} /></div>
        </div>
        {pipeline.undated > 0 && <p className="mt-3 text-xs text-faint" data-testid="reports-undated">{pipeline.undated} loan{pipeline.undated === 1 ? " was" : "s were"} started before LendHous kept each loan&apos;s history, so {pipeline.undated === 1 ? "it isn't" : "they aren't"} counted as applications or in the timings. Their fundings and term sheets still count.</p>}

        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">What happened to this period&apos;s applications</h3>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Of the {pull.applied} that came in, how far each has got so far.</p>
            <Bars testid="pull-through" format={(value) => String(value)} rows={pull.applied ? [
              { label: "Applied", value: pull.applied },
              { label: "Got a term sheet", value: pull.termSheet, note: `${share(pull.termSheet, pull.applied)} of applications` },
              { label: "Funded", value: pull.funded, note: `${share(pull.funded, pull.applied)} of applications` },
              { label: "Still open", value: pull.open, note: `${share(pull.open, pull.applied)} of applications` },
              { label: "Declined or withdrawn", value: pull.lost, note: `${share(pull.lost, pull.applied)} of applications` },
            ] : []} />
          </div>
          <div>
            <h3 className="text-sm font-medium">How long it takes</h3>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Middle value (median) for loans that reached the step in this period.</p>
            <div className="grid grid-cols-3 gap-3" data-testid="cycle-times">
              <Stat label="Application to term sheet" value={days(pipeline.cycleTimes.toTermSheet.days)} sub={`${pipeline.cycleTimes.toTermSheet.loans} loans`} />
              <Stat label="Term sheet to funding" value={days(pipeline.cycleTimes.termSheetToFunding.days)} sub={`${pipeline.cycleTimes.termSheetToFunding.loans} loans`} />
              <Stat label="Application to funding" value={days(pipeline.cycleTimes.toFunding.days)} sub={`${pipeline.cycleTimes.toFunding.loans} loans`} />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Where loans come from</h3>
          {pipeline.bySource.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in this period.</p> : (
            <table className="stack-table w-full text-sm" data-testid="by-source">
              <thead><tr><th>Source</th><th className="text-right">Applications</th><th className="text-right">Term sheets</th><th className="text-right">Funded</th><th className="text-right">Funded amount</th></tr></thead>
              <tbody className="divide-y divide-border">{pipeline.bySource.map((row) => <tr key={row.source}><td className="font-medium">{row.label}</td><td data-label="Applications" className="text-right tabular-nums">{row.applications}</td><td data-label="Term sheets" className="text-right tabular-nums">{row.termSheets}</td><td data-label="Funded" className="text-right tabular-nums">{row.funded}</td><td data-label="Funded amount" className="text-right tabular-nums">{usd(row.fundedAmount)}</td></tr>)}</tbody>
            </table>
          )}
        </div>

        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">By loan officer</h3>
          {pipeline.byOfficer.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in this period.</p> : (
            <table className="stack-table w-full text-sm" data-testid="by-officer">
              <thead><tr><th>Loan officer</th><th className="text-right">Applications</th><th className="text-right">Term sheets</th><th className="text-right">Funded</th><th className="text-right">Funded amount</th></tr></thead>
              <tbody className="divide-y divide-border">{pipeline.byOfficer.map((row) => <tr key={row.name}><td className="font-medium">{row.name}</td><td data-label="Applications" className="text-right tabular-nums">{row.applications}</td><td data-label="Term sheets" className="text-right tabular-nums">{row.termSheets}</td><td data-label="Funded" className="text-right tabular-nums">{row.funded}</td><td data-label="Funded amount" className="text-right tabular-nums">{usd(row.fundedAmount)}</td></tr>)}</tbody>
            </table>
          )}
        </div>

        {pipeline.byBroker.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium">By broker</h3>
            <table className="stack-table w-full text-sm" data-testid="by-broker">
              <thead><tr><th>Brokerage</th><th className="text-right">Applications</th><th className="text-right">By referral link</th><th className="text-right">Funded</th><th className="text-right">Funded amount</th><th className="text-right">Their fees</th></tr></thead>
              <tbody className="divide-y divide-border">{pipeline.byBroker.map((row) => <tr key={row.name}><td className="font-medium">{row.name}</td><td data-label="Applications" className="text-right tabular-nums">{row.applications}</td><td data-label="By referral link" className="text-right tabular-nums">{row.referred}</td><td data-label="Funded" className="text-right tabular-nums">{row.funded}</td><td data-label="Funded amount" className="text-right tabular-nums">{usd(row.fundedAmount)}</td><td data-label="Their fees" className="text-right tabular-nums">{usd(row.fees)}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">In one stage for over {STUCK_DAYS} days</h3>
            <p className="mt-0.5 mb-2 text-xs text-muted-foreground">Open applications today, longest first.</p>
            {pipeline.stuck.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="stuck-none">None. Every open application moved within {STUCK_DAYS} days.</p> : (
              <ul className="divide-y divide-border text-sm" data-testid="stuck">
                {pipeline.stuck.map((row) => <li key={row.deal.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2" data-testid="stuck-row"><span><Link href={`/admin/deals/${row.deal.id}`} className="font-semibold text-link hover:underline">{row.deal.loanNumber}</Link> <span className="text-muted-foreground">· {statusLabel(row.deal.status)} · {k(row.amount)}</span></span><span className="font-medium text-warn tabular-nums">{row.days} days</span></li>)}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">Why applications ended</h3>
            <p className="mt-0.5 mb-2 text-xs text-muted-foreground">Declines and withdrawals in this period, by reason.</p>
            {pipeline.closures.length === 0 ? <p className="text-sm text-muted-foreground">None in this period.</p> : (
              <ul className="divide-y divide-border text-sm" data-testid="closures">
                {pipeline.closures.map((row) => <li key={row.key} className="flex justify-between gap-3 py-2"><span className="min-w-0 first-letter:uppercase">{row.key}</span><span className="shrink-0 text-muted-foreground tabular-nums">{row.count} · {k(row.amount)}</span></li>)}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section title="Capital today">
        <div className={statGrid}>
          <Stat label="Committed to lend" value={k(capital.commitment)} />
          <Stat label="Deployed" value={k(capital.deployed)} sub={share(capital.deployed, capital.commitment) + " of commitments"} />
          <Stat label="Unfunded holdbacks" value={k(capital.unfunded)} sub={`${k(capital.reserved + capital.committed)} reserved or committed`} />
          <div data-testid="kpi-available"><Stat label="Available now" value={<span className="text-good">{k(capital.available)}</span>} /></div>
        </div>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-medium">Available by source</h3>
            {capital.sources.length === 0 ? <p className="text-sm text-muted-foreground">No capital sources yet. Add one on the Capital page.</p> : <Bars testid="capital-sources" format={k} rows={capital.sources.map((source) => ({ label: source.name, value: source.available, note: `of ${k(source.commitment)}, ${k(source.deployed)} deployed` }))} />}
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium">How this period&apos;s loans were funded</h3>
            <Bars testid="routing" format={k} rows={capital.routing.map((row) => ({ label: row.key === "in_house" ? "In-house" : row.key === "partner" ? "Partner lender" : row.key === "split" ? "Split with a partner" : "Not recorded", value: row.amount, note: `${row.count} loan${row.count === 1 ? "" : "s"}` }))} />
          </div>
        </div>
      </Section>

      <Section title="Funded portfolio today">
        <div className={statGrid}>
          <div data-testid="kpi-outstanding"><Stat label="Outstanding" value={k(portfolio.outstanding)} sub={`${portfolio.loans} loan${portfolio.loans === 1 ? "" : "s"}`} /></div>
          <Stat label="Average rate" value={portfolio.loans ? `${portfolio.averageRate.toFixed(2)}%` : "–"} sub="weighted by balance" />
          <div data-testid="kpi-late"><Stat label="Past due" value={<span className={late ? "text-bad" : ""}>{late}</span>} sub={late ? usd(portfolio.buckets.filter((bucket) => bucket.key !== "current").reduce((sum, bucket) => sum + bucket.balance, 0)) + " balance" : "every loan current"} /></div>
          <Stat label="Ever extended" value={share(portfolio.extensions.extended, portfolio.extensions.funded)} sub={`${portfolio.extensions.extended} of ${portfolio.extensions.funded} funded loans`} />
        </div>
        {portfolio.loans === 0 ? <p className="mt-4 text-sm text-muted-foreground">No funded loans yet.</p> : (
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-medium">Balance by days late</h3>
              <Bars testid="delinquency" format={k} rows={portfolio.buckets.map((bucket) => ({ label: bucket.label, value: bucket.balance, note: `${bucket.count} loan${bucket.count === 1 ? "" : "s"}` }))} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-medium">Coming due</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="maturities">
                {portfolio.maturing.map((row) => <Stat key={row.days} label={`Within ${row.days} days`} value={row.count} sub={k(row.balance)} />)}
                <Stat label="Past maturity" value={<span className={portfolio.pastMaturity ? "text-bad" : ""}>{portfolio.pastMaturity}</span>} />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-medium">Largest borrowers</h3>
              <Bars testid="by-borrower" format={k} rows={portfolio.byBorrower.map((row) => ({ label: row.key, value: row.amount, note: `${share(row.amount, portfolio.outstanding)} of the portfolio` }))} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-medium">By county and loan type</h3>
              <Bars testid="by-county" format={k} rows={[...portfolio.byCounty.map((row) => ({ label: row.key, value: row.amount, note: `${share(row.amount, portfolio.outstanding)} of the portfolio` }))]} />
              <div className="mt-4"><Bars testid="by-product" format={k} rows={portfolio.byProduct.map((row) => ({ label: productLabel[row.key as Product] ?? row.key, value: row.amount, note: `${row.count} loan${row.count === 1 ? "" : "s"}, ${share(row.amount, portfolio.outstanding)}` }))} /></div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
