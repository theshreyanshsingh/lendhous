"use client";
import { useEffect, useState } from "react";
import { maturityDate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { balanceOf, paymentHistory, payoffFor } from "@/lib/servicing";
import { est, useStore } from "@/lib/store";
import { Badge, Section, Stat, statusLabel, usd } from "@/components/ui";

/** The borrower's servicing view: what's due, what's been paid, and what it takes to pay the loan off. */
export function PaymentsPanel({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const e = est(deal.app);
  const history = paymentHistory(deal);
  const late = history.filter((row) => row.status === "late").length;
  const amount = history[0]?.amount ?? 0;
  // Set after the first render: the server and the browser can disagree about today's date.
  const [goodThrough, setGoodThrough] = useState("");
  useEffect(() => { setGoodThrough(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)); }, []);
  const quote = goodThrough ? payoffFor(deal, goodThrough) : null;
  const requests = s.payoffs.filter((payoff) => payoff.dealId === deal.id);
  return (
    <Section title="Payments and payoff" right={late ? <Badge tone="rose">{late} past due</Badge> : <Badge tone="green">Current</Badge>}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Next payment" value={<span data-testid="next-due">{deal.nextPaymentDue ?? "—"}</span>} sub={amount ? usd(amount) : undefined} />
        <Stat label="Maturity" value={maturityDate(deal.closingDate, e.termMonths)} />
        <Stat label="Balance" value={usd(balanceOf(deal))} />
        <Stat label="Payments made" value={history.filter((row) => row.status === "paid").length} />
      </div>
      {history.length > 0 && (
        <details className="mt-3 text-sm" data-testid="payment-rows">
          <summary className="cursor-pointer text-link">Payment history</summary>
          <ul className="mt-2 divide-y divide-border">{[...history].reverse().map((row) => <li key={row.due} className="flex items-center justify-between gap-2 py-1.5"><span>{row.due}</span><span className="flex items-center gap-2">{usd(row.amount)}<Badge tone={row.status === "paid" ? "green" : "rose"}>{row.status === "paid" ? "Paid" : "Late"}</Badge></span></li>)}</ul>
        </details>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Paying online isn&apos;t available yet. Contact your LendHous servicing team to make a payment.</p>
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Paying the loan off?</p>
        <label className="mt-2 block"><span className="label">Good through</span><input data-testid="payoff-date" type="date" className="desk-input" value={goodThrough} onChange={(event) => setGoodThrough(event.target.value)} /></label>
        {quote && (
          <dl className="mt-3 space-y-1 text-sm" data-testid="payoff-quote">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Principal</dt><dd>{usd(quote.principal, 2)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Interest since last payment</dt><dd>{usd(quote.accrued, 2)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>Estimated payoff</dt><dd data-testid="payoff-total">{usd(quote.total, 2)}</dd></div>
            <div className="flex justify-between gap-3 text-xs text-muted-foreground"><dt>Each extra day</dt><dd>{usd(quote.perDiem, 2)}</dd></div>
          </dl>
        )}
        <button className="btn-ghost mt-3 w-full" data-testid="request-payoff" disabled={!goodThrough} onClick={() => dispatch({ t: "requestPayoff", dealId: deal.id, goodThrough, by: viewerName })}>Request a payoff statement</button>
        {requests.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="my-payoffs">{requests.map((payoff) => <li key={payoff.id} className="flex flex-wrap justify-between gap-2"><span>{usd(payoff.total, 2)}, good through {payoff.goodThrough}</span><span>{statusLabel(payoff.status)}</span></li>)}</ul>
        )}
        <p className="mt-3 rounded-md bg-bad/10 p-2 text-xs text-bad">Payoffs are paid by wire. We will never email you wire instructions. Always confirm by phone with a number you already have.</p>
      </div>
    </Section>
  );
}
