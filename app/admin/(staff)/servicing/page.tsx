"use client";
import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, productLabel, statusLabel, usd } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { fundedBalances, maturityDate } from "@/lib/engine";
import { balanceOf } from "@/lib/servicing";
import { est, useStore } from "@/lib/store";

const SERVICED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];

export default function Servicing() {
  const { s, dispatch } = useStore();
  const loans = s.deals.filter((deal) => SERVICED.includes(deal.status));
  const late = loans.filter((deal) => deal.paymentsLate);
  const payoffs = s.payoffs.filter((payoff) => payoff.status !== "paid");
  const monthly = loans.reduce((sum, deal) => sum + fundedBalances(est(deal.app), deal.app, deal.disbursedDraws).nextPayment, 0);
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Servicing" title="Loan servicing" lede="Every funded loan: what's due, what's late and who's paying off." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Loans" value={loans.length} /></div>
        <div className="glass p-4"><Stat label="Balance" value={k(loans.reduce((sum, deal) => sum + balanceOf(deal), 0))} /></div>
        <div className="glass p-4"><Stat label="Due each month" value={k(monthly)} /></div>
        <div className="glass p-4"><Stat label="Past due" value={<span className={late.length ? "text-bad" : ""}>{late.length}</span>} /></div>
      </div>
      <Section title={`Payoff requests (${payoffs.length})`}>
        {payoffs.length === 0 && <p className="text-sm text-muted-foreground">No payoff requests.</p>}
        <ul className="divide-y divide-border">
          {payoffs.map((payoff) => {
            const deal = s.deals.find((item) => item.id === payoff.dealId)!;
            return (
              <li key={payoff.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="payoff-row">
                <div className="min-w-0"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {payoff.by}</span><div className="text-xs text-muted-foreground">{usd(payoff.total, 2)} good through {payoff.goodThrough} · {usd(payoff.perDiem, 2)} a day after that</div></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={payoff.status === "sent" ? "blue" : "amber"}>{statusLabel(payoff.status)}</Badge>
                  {payoff.status === "requested" && <button className="btn-primary h-9! px-3! text-xs!" data-testid="send-payoff" onClick={() => dispatch({ t: "sendPayoff", payoffId: payoff.id })}>Mark statement sent</button>}
                  {payoff.status === "sent" && <button className="btn-primary h-9! px-3! text-xs!" data-testid="mark-paid-off" onClick={() => dispatch({ t: "markPaidOff", payoffId: payoff.id })}>Mark paid off</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
      <div className="flex justify-end"><button type="button" className="btn-ghost w-full sm:w-auto" data-testid="export-servicing" disabled={loans.length === 0} onClick={() => downloadCsv("lendhous-servicing.csv", loans.map((deal) => { const e = est(deal.app); return { Loan: deal.loanNumber, Borrower: deal.borrowerName, Product: productLabel[deal.app.product], Balance: balanceOf(deal), Rate: e.rate, Payment: fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment, "Next due": deal.nextPaymentDue ?? "", "Past due": deal.paymentsLate ?? 0, Maturity: maturityDate(deal.closingDate, e.termMonths) }; }))}>Export CSV</button></div>
      <div className="glass overflow-hidden px-4 lg:px-0">
        <table className="stack-table w-full" data-testid="servicing-table">
          <thead><tr className="border-b border-rule"><th>Loan</th><th className="text-right">Balance</th><th className="text-right">Rate</th><th className="text-right">Payment</th><th>Next due</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {loans.length === 0 && <tr><td colSpan={7} className="text-muted-foreground">No funded loans yet.</td></tr>}
            {loans.map((deal) => {
              const e = est(deal.app);
              return (
                <tr key={deal.id} className="border-b border-border last:border-0" data-testid="serviced-loan">
                  <td><Link href={`/admin/deals/${deal.id}`} className="font-semibold text-link hover:underline">{deal.loanNumber}</Link><div className="text-xs text-muted-foreground">{deal.borrowerName} · {productLabel[deal.app.product]}</div></td>
                  <td data-label="Balance" className="text-right">{usd(balanceOf(deal))}</td>
                  <td data-label="Rate" className="text-right">{e.rate.toFixed(2)}%</td>
                  <td data-label="Payment" className="text-right">{usd(fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment)}</td>
                  <td data-label="Next due" className="whitespace-nowrap" data-testid="serviced-next-due">{deal.nextPaymentDue ?? "—"}</td>
                  <td data-label="Status">{deal.paymentsLate ? <Badge tone="rose">{deal.paymentsLate} past due</Badge> : <Badge tone="green">Current</Badge>}</td>
                  <td className="text-right"><button className="btn-ghost h-9! w-full px-3! text-xs! lg:w-auto" data-testid="record-payment" onClick={() => dispatch({ t: "recordPayment", dealId: deal.id })}>Record payment</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
