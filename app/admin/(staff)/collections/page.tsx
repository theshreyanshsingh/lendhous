"use client";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageIntro } from "@/components/page-intro";
import { useServiceDay } from "@/components/loan/use-service-day";
import { Badge, Section, Stat, k, shortDate, usd } from "@/components/ui";
import { lastContact, latestPromise, nextAction, promiseState, STAGE_LABEL, stageOf, type Stage } from "@/lib/collections";
import { downloadCsv } from "@/lib/csv";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { balanceOf, ledgerOf } from "@/lib/servicing";
import { useStore } from "@/lib/store";

const ORDER: Stage[] = ["reo", "bankruptcy", "foreclosure", "default", "matured", "delinquent", "late"];
const tone = (stage: Stage) => (stage === "late" || stage === "matured" ? "amber" : "rose") as "rose";

/**
 * Collections (lib/collections.ts): every loan behind or past maturity, in default, in bankruptcy, in foreclosure or bank-owned,
 * worst first, with what's owed, the last contact, the latest promise and the next thing to do. Each opens the loan's
 * Servicing tab, where the calls, notices and the case are kept.
 */
export default function Collections() {
  const { s } = useStore();
  const today = useServiceDay();
  const [stage, setStage] = useState<Stage | "">("");
  if (!today) return null;
  const rows = s.deals.flatMap((deal) => { const at = stageOf(deal, today); return at ? [{ deal, stage: at, ledger: ledgerOf(deal, today) }] : []; })
    .sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage) || b.ledger.daysPastDue - a.ledger.daysPastDue);
  const shown = stage ? rows.filter((row) => row.stage === stage) : rows;
  const count = (which: Stage) => rows.filter((row) => row.stage === which).length;
  const promised = (deal: Deal) => { const promise = latestPromise(deal); return promise ? { promise, ...promiseState(deal, promise, today) } : null; };
  const exportRows = () => downloadCsv("lendhous-collections.csv", rows.map(({ deal, stage: at, ledger: l }) => ({ Loan: deal.loanNumber, Borrower: deal.borrowerName, Stage: STAGE_LABEL[at], Balance: at === "reo" ? deal.reo?.owed.principal ?? 0 : balanceOf(deal), "Due now": l.amountDue, "Days past due": l.daysPastDue, "Last contact": lastContact(deal)?.on ?? "", Promise: promised(deal) ? `${promised(deal)!.promise.amount} by ${promised(deal)!.promise.dueBy} (${promised(deal)!.state})` : "", "Next step": nextAction(deal, today) })));
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Servicing" title="Collections" lede="Every loan behind, past maturity, in default, in bankruptcy, in foreclosure or bank-owned, worst first. Calls, promises, notices and the foreclosure case are kept on each loan's Servicing tab." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="collections-counts">
        {ORDER.map((which) => (
          <button key={which} type="button" className={`glass p-4 text-left ${stage === which ? "ring-2 ring-link" : ""}`} aria-pressed={stage === which} data-testid={`stage-${which}`} onClick={() => setStage(stage === which ? "" : which)}><Stat label={STAGE_LABEL[which]} value={count(which)} /></button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{rows.length ? `${k(rows.reduce((sum, row) => sum + row.ledger.amountDue, 0))} behind across ${rows.length} loan${rows.length === 1 ? "" : "s"}.` : ""}{stage ? <> Showing {STAGE_LABEL[stage].toLowerCase()} only. <button type="button" className="text-link underline underline-offset-2" onClick={() => setStage("")}>Show all</button></> : null}</p>
        <button type="button" className="btn-ghost w-full sm:w-auto" data-testid="export-collections" disabled={!rows.length} onClick={exportRows}>Export CSV</button>
      </div>
      {!rows.length ? <EmptyState>No loan is behind. Everything is paid as agreed.</EmptyState> : (
        <Section title={`Loans (${shown.length})`}>
          <table className="stack-table w-full text-sm" data-testid="collections-table">
            <thead><tr className="border-b border-rule"><th>Loan</th><th>Stage</th><th className="text-right">Due now</th><th>Last contact</th><th>Promise</th><th>Next</th></tr></thead>
            <tbody>
              {shown.map(({ deal, stage: at, ledger: l }) => {
                const contact = lastContact(deal);
                const promise = promised(deal);
                return (
                  <tr key={deal.id} className="border-b border-border last:border-0" data-testid="collections-row">
                    <td><Link href={`/admin/deals/${deal.id}?tab=Servicing`} className="font-semibold text-link hover:underline">{deal.loanNumber}</Link><small className="block text-xs text-muted-foreground">{deal.borrowerName} · {deal.city}</small></td>
                    <td data-label="Stage"><Badge tone={tone(at)}>{STAGE_LABEL[at]}</Badge>{l.daysPastDue ? <small className="block text-xs text-muted-foreground">{l.daysPastDue} days past due</small> : null}</td>
                    <td data-label="Due now" className="text-right tabular-nums">{at === "reo" ? "—" : usd(l.amountDue, 2)}</td>
                    <td data-label="Last contact">{contact ? <>{shortDay(contact.on)}<small className="block text-xs text-muted-foreground">{contact.outcome.replace(/_/g, " ")}</small></> : <span className="text-muted-foreground">None</span>}</td>
                    <td data-label="Promise">{promise ? <>{usd(promise.promise.amount, 2)} by {shortDay(promise.promise.dueBy)} <Badge tone={promise.state === "kept" ? "green" : promise.state === "broken" ? "rose" : promise.state === "open" ? "amber" : "slate"}>{promise.state}</Badge></> : <span className="text-muted-foreground">None</span>}</td>
                    <td data-label="Next" data-testid="collections-next-step">{nextAction(deal, today)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
      <p className="text-xs text-muted-foreground">Updated {shortDate(new Date().toISOString())}. A bankruptcy pauses collection on its loan until the case ends.</p>
    </div>
  );
}
