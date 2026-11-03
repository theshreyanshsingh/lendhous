"use client";
import { useEffect, useState } from "react";
import type { Deal } from "@/lib/mockData";
import { BILL_LABEL, billTone, balanceOf, defaultInterestFrom, defaultRateOf, ledger, METHODS, openDefault, payoffFor, servicingTermsOf, shownRows } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, Stat, statusLabel, usd } from "@/components/ui";

/** The borrower's servicing view: what's due, what's been paid, and what it takes to pay the loan off. */
export function PaymentsPanel({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const l = ledger(deal);
  const { graceDays, lateFeePct, maturityNoticeDays } = servicingTermsOf(deal);
  const next = l.rows.find((row) => row.due === l.nextDue);
  const received = [...(deal.payments ?? [])].reverse();
  // Set after the first render: the server and the browser can disagree about today's date.
  const [goodThrough, setGoodThrough] = useState("");
  useEffect(() => { setGoodThrough(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)); }, []);
  const quote = goodThrough ? payoffFor(deal, goodThrough) : null;
  const requests = s.payoffs.filter((payoff) => payoff.dealId === deal.id);
  return (
    <Section title="Payments and payoff" right={openDefault(deal) ? <Badge tone="rose">Default</Badge> : l.matured ? <Badge tone="rose">Matured</Badge> : l.paymentsLate ? <Badge tone="rose">{l.paymentsLate} past due</Badge> : <Badge tone="green">Current</Badge>}>
      {openDefault(deal) ? (
        <p className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad" data-testid="default-notice">Your loan is in default since {openDefault(deal)!.effectiveOn}. Interest runs at the default rate of {defaultRateOf(deal).toFixed(2)}% from {defaultInterestFrom(deal)}. Call your LendHous servicing team to talk about bringing it current.</p>
      ) : l.matured ? (
        <p className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad" data-testid="matured-notice">Your loan matured on {l.maturity}, so the full balance is due. Interest now runs at the default rate of {defaultRateOf(deal).toFixed(2)}%. Ask for a payoff statement below.</p>
      ) : l.amountDue > 0 && l.paymentsLate ? (
        <p className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad" data-testid="late-notice">Your loan is {usd(l.amountDue, 2)} past due{l.feesOwed ? `, including ${usd(l.feesOwed, 2)} in late fees` : ""}. Please pay it as soon as you can.</p>
      ) : l.daysToMaturity <= Math.max(...maturityNoticeDays) ? (
        <p className="mb-3 rounded-md bg-warn/10 p-2 text-sm" data-testid="maturity-notice">Your loan matures in {l.daysToMaturity} days, on {l.maturity}. Plan your payoff, or talk to us before then if you need more time.</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Stat label={l.amountDue ? "Due now" : "Next payment"} value={<span data-testid="next-due">{l.amountDue ? usd(l.amountDue, 2) : l.nextDue ?? "—"}</span>} sub={l.amountDue ? `oldest due ${l.nextDue}` : next ? usd(next.amount, 2) : undefined} />
        <Stat label="Maturity" value={l.maturity} />
        <Stat label="Balance" value={usd(balanceOf(deal))} />
        <Stat label="Payments made" value={l.paymentsMade} sub={l.credit ? `${usd(l.credit, 2)} credit held` : undefined} />
      </div>
      {l.rows.some((row) => row.status !== "upcoming") && (
        <details className="mt-3 text-sm" data-testid="payment-rows">
          <summary className="cursor-pointer text-link">Payment history</summary>
          <ul className="mt-2 divide-y divide-border">
            {[...shownRows(l)].reverse().map((row) => (
              <li key={row.due} className="py-1.5">
                <div className="flex items-center justify-between gap-2"><span>{row.due}</span><span className="flex items-center gap-2">{usd(row.amount, 2)}<Badge tone={billTone(row.status)}>{BILL_LABEL[row.status]}</Badge></span></div>
                {row.late && <div className="text-xs text-muted-foreground">{row.waived ? "Late fee waived" : `Late fee ${usd(row.fee, 2)}${row.feePaid >= row.fee ? ", paid" : ""}`}</div>}
              </li>
            ))}
          </ul>
          {received.length > 0 && (
            <>
              <p className="mt-3 font-medium">Money received</p>
              <ul className="mt-1 divide-y divide-border" data-testid="payments-received">{received.map((payment) => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className={payment.reversed ? "text-muted-foreground line-through" : ""}>{payment.receivedOn} · {METHODS[payment.method]}</span><span>{usd(payment.amount, 2)}{payment.reversed ? <span className="ml-2 text-xs text-bad">Reversed{payment.reversed.reason ? `: ${payment.reversed.reason}` : ""}</span> : null}</span></li>)}</ul>
            </>
          )}
        </details>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Payments are due on the 1st. One that arrives more than {graceDays} days late owes a late fee of {lateFeePct * 100}% of the payment. Paying online isn&apos;t available yet: contact your LendHous servicing team to make a payment.</p>
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Paying the loan off?</p>
        <label className="mt-2 block"><span className="label">Good through</span><input data-testid="payoff-date" type="date" className="desk-input" value={goodThrough} onChange={(event) => setGoodThrough(event.target.value)} /></label>
        {quote && (
          <dl className="mt-3 space-y-1 text-sm" data-testid="payoff-quote">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Principal</dt><dd>{usd(quote.principal, 2)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Interest since last payment</dt><dd>{usd(quote.accrued, 2)}</dd></div>
            {quote.defaultAccrued > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Default interest</dt><dd>{usd(quote.defaultAccrued, 2)}</dd></div>}
            {quote.fees > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Late fees</dt><dd>{usd(quote.fees, 2)}</dd></div>}
            {quote.credit > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Credit held</dt><dd>{usd(-quote.credit, 2)}</dd></div>}
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
