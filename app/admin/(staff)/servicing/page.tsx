"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageIntro } from "@/components/page-intro";
import { RecordPayment } from "@/components/loan/RecordPayment";
import { RecordPayoff } from "@/components/loan/RecordPayoff";
import { dueLine, PayoffRequestCard } from "@/components/loan/PayoffRequests";
import { Badge, Section, Stat, k, productLabel, statusLabel, usd } from "@/components/ui";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { isDemoBook, serviceDay } from "@/lib/book";
import { downloadCsv } from "@/lib/csv";
import { fundedBalances } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { dueOf, latestLetter, receivedOf, requesterLine, requestState, staleLetter } from "@/lib/payoffs";
import { lienReleaseDaysLeft, lienReleaseDue, lienReleaseOpen, maturityAfter, openExtension } from "@/lib/loan-exits";
import { addDays, balanceOf, ledger, SERVICED } from "@/lib/servicing";
import { est, useStore } from "@/lib/store";

export default function Servicing() {
  const { s, dispatch } = useStore();
  const [paying, setPaying] = useState<{ id: string; payoff: boolean; request?: string } | null>(null);
  // Set after the first render: the server and the browser can disagree about today's date.
  const [today, setToday] = useState("");
  // The demo book keeps its own day, so its deadlines read the same every time.
  useEffect(() => { setToday(serviceDay(s)); }, [s]);
  const loans = s.deals.filter((deal) => SERVICED.includes(deal.status));
  const books = new Map(loans.map((deal) => [deal.id, ledger(deal)]));
  const of = (deal: Deal) => books.get(deal.id)!;
  const late = loans.filter((deal) => deal.paymentsLate);
  const fees = loans.reduce((sum, deal) => sum + of(deal).feesOwed, 0);
  const matured = loans.filter((deal) => of(deal).matured);
  const maturing = loans.filter((deal) => !of(deal).matured && of(deal).daysToMaturity <= 60);
  // Waiting for a letter first, by due date; then letters out, while the loan can still be paid off.
  const payoffs = s.payoffs.filter((payoff) => payoff.status === "requested" || (payoff.status === "sent" && SERVICED.includes(s.deals.find((deal) => deal.id === payoff.dealId)?.status ?? ""))).sort((a, b) => (a.status === b.status ? dueOf(a).localeCompare(dueOf(b)) : a.status === "requested" ? -1 : 1));
  const reviewing = s.payoffs.find((payoff) => payoff.id === paying?.request);
  const monthly = loans.reduce((sum, deal) => sum + fundedBalances(est(deal.app), deal.app, deal.disbursedDraws).nextPayment, 0);
  // The nightly job stamps each loan it checks. If the newest stamp is old, the job has stopped and nothing is going late.
  const checked = isDemoBook(s) ? undefined : loans.map((deal) => deal.servicedThrough).filter(Boolean).sort().pop();
  const stale = Boolean(checked && today && checked < addDays(today, -1));
  const open = loans.find((deal) => deal.id === paying?.id);
  const extensions = loans.filter((deal) => openExtension(deal));
  const releases = s.deals.filter(lienReleaseOpen).sort((a, b) => lienReleaseDue(a)!.localeCompare(lienReleaseDue(b)!));
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Servicing" title="Loan servicing" lede="Every funded loan: what's due, what's late, what's maturing and who's paying off." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="glass p-4"><Stat label="Loans" value={loans.length} /></div>
        <div className="glass p-4"><Stat label="Balance" value={k(loans.reduce((sum, deal) => sum + balanceOf(deal), 0))} /></div>
        <div className="glass p-4"><Stat label="Due each month" value={k(monthly)} /></div>
        <div className="glass p-4"><Stat label="Past due" value={<span className={late.length ? "text-bad" : ""} data-testid="count-past-due">{late.length}</span>} /></div>
        <div className="glass p-4"><Stat label="Late fees owed" value={usd(fees)} /></div>
        <div className="glass p-4"><Stat label="Maturing" value={<span className={matured.length ? "text-bad" : ""}>{matured.length ? `${matured.length} past` : maturing.length}</span>} sub={matured.length ? `${maturing.length} in 60 days` : "in 60 days"} /></div>
      </div>
      {checked && <p className={`text-xs ${stale ? "rounded-md bg-bad/10 p-2 text-bad" : "text-muted-foreground"}`} data-testid="servicing-checked">{stale ? `Late payments and maturity were last checked on ${checked}. The nightly job has stopped: check that lendhous-jobs is running on the server.` : `Late payments and maturity checked through ${checked}.`}</p>}
      <Section title={`Payoff requests (${payoffs.length})`}>
        {payoffs.length === 0 && <p className="text-sm text-muted-foreground">No payoff requests.</p>}
        <ul className="divide-y divide-border">
          {payoffs.map((payoff) => {
            const deal = s.deals.find((item) => item.id === payoff.dealId)!;
            const state = requestState(payoff);
            const letter = latestLetter(payoff);
            const due = dueLine(payoff, today);
            const stale = today ? staleLetter(deal, payoff, today) : null;
            return (
              <li key={payoff.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="payoff-row">
                <div className="min-w-0">
                  <Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm wrap-anywhere">· {requesterLine(payoff)}</span>
                  <div className="text-xs text-muted-foreground">{letter ? `Letter ${letter.number}: ${usd(letter.total, 2)} through ${letter.goodThrough}` : `About ${usd(payoff.total, 2)} through ${payoff.goodThrough}`} · received {receivedOf(payoff)}</div>
                  {payoff.status === "requested" && <div className={`text-xs ${due.tone}`} data-testid="payoff-due">{due.text}. Florida gives 10 days.</div>}
                  {stale && <div className="text-xs text-bad" data-testid="payoff-row-stale">Out of date: now {usd(stale.now.total, 2)}. Send a corrected letter.</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={stale ? "rose" : state.tone}>{stale ? "Correct it" : state.label}</Badge>
                  <button className={`${payoff.status === "requested" || stale ? "btn-primary" : "btn-ghost"} h-9! px-3! text-xs!`} data-testid="open-payoff" onClick={() => setPaying({ id: deal.id, payoff: false, request: payoff.id })}>{payoff.status === "requested" ? "Review and send" : "Open"}</button>
                  {payoff.status === "sent" && SERVICED.includes(deal.status) && <button className="btn-ghost h-9! px-3! text-xs!" data-testid="record-payoff" onClick={() => setPaying({ id: deal.id, payoff: true })}>Record payoff</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
      {extensions.length > 0 && (
        <Section title={`Extension requests (${extensions.length})`}>
          <ul className="divide-y divide-border">
            {extensions.map((deal) => {
              const extension = openExtension(deal)!;
              return (
                <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="extension-row">
                  <div className="min-w-0"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {deal.borrowerName}</span><div className="text-xs text-muted-foreground">{extension.months} more month{extension.months === 1 ? "" : "s"}, {extension.fromMaturity} to {maturityAfter(deal, extension)} · fee {usd(extension.fee, 2)}</div></div>
                  <Badge tone={extension.status === "approved" ? "blue" : "amber"}>{extension.status === "approved" ? "Approved: waiting for signatures" : `${extension.approvers.length} of 2 approvals`}</Badge>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {releases.length > 0 && (
        <Section title={`Mortgage releases to record (${releases.length})`}>
          <ul className="divide-y divide-border">
            {releases.map((deal) => {
              const left = today ? lienReleaseDaysLeft(deal, today) : 0;
              return (
                <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="release-row">
                  <div className="min-w-0"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {deal.borrowerName}</span><div className="text-xs text-muted-foreground">Paid off {deal.paidOff!.receivedOn}{deal.paidOff!.release?.sentOn ? ` · sent for recording ${deal.paidOff!.release.sentOn}` : ""}</div></div>
                  <span className={`text-xs ${left < 0 ? "text-bad" : left <= 14 ? "text-warn" : "text-muted-foreground"}`}>Due out by {lienReleaseDue(deal)}{today ? ` (${left < 0 ? `${-left} days late` : `${left} days left`})` : ""}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <div className="flex justify-end"><button type="button" className="btn-ghost w-full sm:w-auto" data-testid="export-servicing" disabled={loans.length === 0} onClick={() => downloadCsv("lendhous-servicing.csv", loans.map((deal) => { const e = est(deal.app); const l = of(deal); return { Loan: deal.loanNumber, Borrower: deal.borrowerName, Product: productLabel[deal.app.product], Status: statusLabel(deal.status), Balance: balanceOf(deal), Rate: e.rate, Payment: fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment, "Next due": l.nextDue ?? "", "Past due": deal.paymentsLate ?? 0, "Days past due": l.daysPastDue, "Due now": l.amountDue, "Late fees owed": l.feesOwed, "Credit held": l.credit, Maturity: l.maturity, "Checked through": deal.servicedThrough ?? "" }; }))}>Export CSV</button></div>
      <div className="glass overflow-hidden px-4 lg:px-0">
        <table className="stack-table w-full" data-testid="servicing-table">
          <thead><tr className="border-b border-rule"><th>Loan</th><th className="text-right">Balance</th><th className="text-right">Payment</th><th className="text-right">Due now</th><th>Next due</th><th>Matures</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {loans.length === 0 && <tr><td colSpan={8} className="text-muted-foreground">No funded loans yet.</td></tr>}
            {loans.map((deal) => {
              const e = est(deal.app);
              const l = of(deal);
              return (
                <tr key={deal.id} className="border-b border-border last:border-0" data-testid="serviced-loan">
                  <td><Link href={`/admin/deals/${deal.id}`} className="font-semibold text-link hover:underline">{deal.loanNumber}</Link><div className="text-xs text-muted-foreground">{deal.borrowerName} · {productLabel[deal.app.product]} · {e.rate.toFixed(2)}%</div></td>
                  <td data-label="Balance" className="text-right">{usd(balanceOf(deal))}</td>
                  <td data-label="Payment" className="text-right">{usd(fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment)}</td>
                  <td data-label="Due now" className={`text-right ${l.amountDue ? "text-bad" : ""}`} data-testid="serviced-due">{usd(l.amountDue, 2)}</td>
                  <td data-label="Next due" className="whitespace-nowrap" data-testid="serviced-next-due">{l.nextDue ?? "—"}</td>
                  <td data-label="Matures" className={`whitespace-nowrap ${l.matured ? "text-bad" : l.daysToMaturity <= 60 ? "text-warn" : ""}`}>{l.maturity}</td>
                  <td data-label="Status">{deal.status === "default" ? <Badge tone="rose">Default</Badge> : l.matured ? <Badge tone="rose">Matured</Badge> : deal.paymentsLate ? <Badge tone="rose">{deal.paymentsLate} past due</Badge> : <Badge tone="green">Current</Badge>}{l.daysPastDue >= 30 && <div className="mt-1 text-xs text-bad">{l.daysPastDue} days</div>}</td>
                  <td className="text-right"><button className="btn-ghost h-9! w-full px-3! text-xs! lg:w-auto" data-testid="record-payment" onClick={() => setPaying({ id: deal.id, payoff: false })}>Record payment</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (
        <Sheet open onOpenChange={(next) => { if (!next) setPaying(null); }}>
          <SheetContent side="right" className="w-full! gap-0! overflow-y-auto p-0 sm:max-w-lg!">
            <header className="border-b border-border p-5 pr-12">
              <p className="eyebrow">{reviewing ? "Payoff letter" : paying?.payoff ? "Record the payoff" : "Record a payment"}</p>
              <SheetTitle className="mt-2 font-heading text-2xl font-normal text-foreground wrap-anywhere">{open.loanNumber}</SheetTitle>
              <div className="mt-2 text-sm text-muted-foreground">{open.borrowerName} · {of(open).amountDue ? `${usd(of(open).amountDue, 2)} due now` : "current"}</div>
            </header>
            <div className="p-5">
              {reviewing ? <PayoffRequestCard request={reviewing} deal={open} /> : paying?.payoff ? <RecordPayoff deal={open} onDone={() => setPaying(null)} /> : <RecordPayment deal={open} onDone={() => setPaying(null)} />}
              <Link href={`/admin/deals/${open.id}`} className="mt-4 inline-block text-sm text-link hover:underline">Open the loan&apos;s full payment history</Link>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
