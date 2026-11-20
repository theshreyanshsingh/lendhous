"use client";
import { PageIntro } from "@/components/page-intro";
import { Section, Stat, k, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { shareOf, SMALL_GROUP, type TrackRecord, type TrackRow } from "@/lib/track-record";

const pct = (value: number | null) => (value === null ? "None ended yet" : `${value.toFixed(2)}%`);

function RecordTable({ title, rows, label, testid }: { title: string; rows: TrackRow[]; label: string; testid: string }) {
  return (
    <Section title={title}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No funded loans yet.</p> : (
        <table className="stack-table w-full text-sm" data-testid={testid}>
          <thead><tr><th>{label}</th><th className="text-right">Loans</th><th className="text-right">Funded</th><th className="text-right">Paid off</th><th className="text-right">Realized yield</th><th className="text-right">Days to payoff</th><th className="text-right">Extended</th><th className="text-right">Modified</th><th className="text-right">Defaulted</th><th className="text-right">Foreclosed</th><th className="text-right">Losses</th><th className="text-right">Recovered</th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key} data-testid="track-row">
                <td className="font-medium">{row.label}{row.small && <span className="block text-[11px] font-normal text-muted-foreground">Only {row.funded} loan{row.funded === 1 ? "" : "s"}</span>}</td>
                <td data-label="Loans" className="text-right tabular-nums">{row.funded}</td>
                <td data-label="Funded" className="text-right tabular-nums">{k(row.amount)}</td>
                <td data-label="Paid off" className="text-right tabular-nums">{row.paidOff}{row.open ? <span className="text-muted-foreground"> · {row.open} open</span> : null}</td>
                <td data-label="Realized yield" className="text-right tabular-nums">{row.realizedYield === null ? "–" : `${row.realizedYield.toFixed(2)}%`}</td>
                <td data-label="Days to payoff" className="text-right tabular-nums">{row.medianDays ?? "–"}</td>
                <td data-label="Extended" className="text-right tabular-nums">{row.extended} <span className="text-muted-foreground">({shareOf(row.extended, row.funded)})</span></td>
                <td data-label="Modified" className="text-right tabular-nums">{row.modified}</td>
                <td data-label="Defaulted" className="text-right tabular-nums">{row.defaults}</td>
                <td data-label="Foreclosed" className="text-right tabular-nums">{row.foreclosures}</td>
                <td data-label="Losses" className="text-right tabular-nums">{usd(row.losses)}</td>
                <td data-label="Recovered" className="text-right tabular-nums">{usd(row.recoveries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/**
 * The whole book's record, for partners and buyers under the NDA and for the team (rank 17): every loan LendHous has
 * funded, the bad ones too, in totals with no loan named.
 */
export function TrackRecordView({ record, intro = true }: { record: TrackRecord; intro?: boolean }) {
  const all = record.overall;
  return (
    <div className="space-y-4" data-testid="track-record">
      {intro && <PageIntro eyebrow="Under your NDA" title="Track record" lede="Every loan LendHous has funded, by the year it funded and by program: what paid off, what it earned, and what went wrong. The loans that went badly are counted too." />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4" data-testid="track-funded"><Stat label="Loans funded" value={String(all.funded)} sub={k(all.amount)} /></div>
        <div className="glass p-4" data-testid="track-paid-off"><Stat label="Paid off" value={String(all.paidOff)} sub={all.medianDays !== null ? `median ${all.medianDays} days` : `${all.open} still open`} /></div>
        <div className="glass p-4" data-testid="track-yield"><Stat label="Realized yield" value={pct(all.realizedYield)} sub="a year, after losses" /></div>
        <div className="glass p-4" data-testid="track-losses"><Stat label="Losses" value={usd(all.losses)} sub={`${all.defaults} defaulted · ${all.foreclosures} foreclosed`} /></div>
      </div>
      {all.small && <p className="glass p-4 text-sm" data-testid="track-small">These figures come from {all.funded} loan{all.funded === 1 ? "" : "s"}, fewer than {SMALL_GROUP}. One loan moves them a lot, so read them as a start, not a pattern.</p>}
      <RecordTable title="By the year it funded" rows={record.byVintage} label="Year" testid="track-by-year" />
      <RecordTable title="By program" rows={record.byProgram} label="Program" testid="track-by-program" />
      <Section title="How these are counted">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Every loan LendHous funded, whoever holds it now. Nothing is left out for going badly.</li>
          <li>Realized yield is only for loans that have ended (paid off, or their property sold after a foreclosure): the interest collected less any loss, as a yearly rate on the money lent. It&apos;s before origination points and fees, and before the servicing LendHous keeps from a partner&apos;s or buyer&apos;s share.</li>
          <li>Days to payoff is the median from funding to the day it ended. Extended, modified and defaulted count loans that ever were; {all.lateNow ? `${all.lateNow} ${all.lateNow === 1 ? "is" : "are"} behind on payments today.` : "none is behind on payments today."}</li>
          <li>A loss is principal not recovered, plus foreclosure and holding costs a sale didn&apos;t cover.</li>
          <li>As of {shortDay(record.asOf)}. Past results don&apos;t promise future ones. Please keep this to your firm, as the NDA asks.</li>
        </ul>
      </Section>
    </div>
  );
}

/** Shown to a firm that hasn't signed the NDA yet. */
export function TrackRecordGate({ firm }: { firm?: string }) {
  return (
    <div className="glass mx-auto max-w-xl p-6 text-center" data-testid="track-record-gate">
      <h1 className="text-xl font-normal tracking-tight">Sign the NDA to see LendHous&apos;s track record</h1>
      <p className="mt-2 text-sm text-muted-foreground">{firm ? `${firm} hasn't signed yet.` : "Your firm isn't connected yet."} Once it has, every loan LendHous has funded shows here in totals.</p>
    </div>
  );
}
