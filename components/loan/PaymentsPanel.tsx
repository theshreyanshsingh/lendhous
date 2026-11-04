"use client";
import { useEffect, useState } from "react";
import type { Deal } from "@/lib/mockData";
import { BILL_LABEL, billTone, balanceOf, defaultInterestFrom, defaultRateOf, ledger, METHODS, openDefault, payoffFor, servicingTermsOf, shownRows } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { dueOf, goodThroughProblem, latestLetter, LETTER_DAYS, MAX_GOOD_THROUGH_DAYS, requesterLine, requestState } from "@/lib/payoffs";
import { addDays } from "@/lib/servicing";
import { useServiceDay } from "./use-service-day";
import { Badge, Section, Stat, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";

/** The borrower's servicing view: what's due, what's been paid, and what it takes to pay the loan off. */
export function PaymentsPanel({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName, local } = useStore();
  const today = useServiceDay();
  const l = ledger(deal);
  const { graceDays, lateFeePct, maturityNoticeDays } = servicingTermsOf(deal);
  const next = l.rows.find((row) => row.due === l.nextDue);
  const received = [...(deal.payments ?? [])].reverse();
  // Set after the first render: the server and the browser can disagree about today's date.
  const [goodThrough, setGoodThrough] = useState("");
  useEffect(() => { if (today) setGoodThrough((current) => current || addDays(today, 10)); }, [today]);
  const quote = goodThrough ? payoffFor(deal, goodThrough) : null;
  const dateProblem = goodThrough && today ? goodThroughProblem(goodThrough, today) : null;
  const requests = s.payoffs.filter((payoff) => payoff.dealId === deal.id);
  const [asked, setAsked] = useState(false);
  return (
    <Section title="Payments and payoff" right={openDefault(deal) ? <Badge tone="rose">Default</Badge> : l.matured ? <Badge tone="rose">Matured</Badge> : l.paymentsLate ? <Badge tone="rose">{l.paymentsLate} past due</Badge> : <Badge tone="green">Current</Badge>}>
      {openDefault(deal) ? (
        <p className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad" data-testid="default-notice">Your loan is in default since {openDefault(deal)!.effectiveOn}. Interest runs at the default rate of {defaultRateOf(deal).toFixed(2)}% from {defaultInterestFrom(deal)}. Call your LendHous servicing team to talk about bringing it current.</p>
      ) : l.matured ? (
        <p className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad" data-testid="matured-notice">Your loan matured on {shortDay(l.maturity)}, so the full balance is due. Interest now runs at the default rate of {defaultRateOf(deal).toFixed(2)}%. Ask for a payoff statement below.</p>
      ) : l.amountDue > 0 && l.paymentsLate ? (
        <p className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad" data-testid="late-notice">Your loan is {usd(l.amountDue, 2)} past due{l.feesOwed ? `, including ${usd(l.feesOwed, 2)} in late fees` : ""}. Please pay it as soon as you can.</p>
      ) : l.daysToMaturity <= Math.max(...maturityNoticeDays) ? (
        <p className="mb-3 rounded-md bg-warn/10 p-2 text-sm" data-testid="maturity-notice">Your loan matures in {l.daysToMaturity} days, on {shortDay(l.maturity)}. Plan your payoff, or talk to us before then if you need more time.</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Stat label={l.amountDue ? "Due now" : "Next payment"} value={<span data-testid="next-due">{l.amountDue ? usd(l.amountDue, 2) : l.nextDue ?? "—"}</span>} sub={l.amountDue ? `oldest due ${shortDay(l.nextDue)}` : next ? usd(next.amount, 2) : undefined} />
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
                <div className="flex items-center justify-between gap-2"><span>{shortDay(row.due)}</span><span className="flex items-center gap-2">{usd(row.amount, 2)}<Badge tone={billTone(row.status)}>{BILL_LABEL[row.status]}</Badge></span></div>
                {row.late && <div className="text-xs text-muted-foreground">{row.waived ? "Late fee waived" : `Late fee ${usd(row.fee, 2)}${row.feePaid >= row.fee ? ", paid" : ""}`}</div>}
              </li>
            ))}
          </ul>
          {received.length > 0 && (
            <>
              <p className="mt-3 font-medium">Money received</p>
              <ul className="mt-1 divide-y divide-border" data-testid="payments-received">{received.map((payment) => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className={payment.reversed ? "text-muted-foreground line-through" : ""}>{shortDay(payment.receivedOn)} · {METHODS[payment.method]}</span><span>{usd(payment.amount, 2)}{payment.reversed ? <span className="ml-2 text-xs text-bad">Reversed{payment.reversed.reason ? `: ${payment.reversed.reason}` : ""}</span> : null}</span></li>)}</ul>
            </>
          )}
        </details>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Payments are due on the 1st. One that arrives more than {graceDays} days late owes a late fee of {lateFeePct * 100}% of the payment. Paying online isn&apos;t available yet: contact your LendHous servicing team to make a payment.</p>
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Paying the loan off?</p>
        <p className="mt-1 text-xs text-muted-foreground">An estimate for any date. For the figures to pay, ask for a payoff letter.</p>
        <label className="mt-2 block"><span className="label">Good through</span><input data-testid="payoff-date" type="date" className="desk-input" min={today || undefined} max={today ? addDays(today, MAX_GOOD_THROUGH_DAYS) : undefined} value={goodThrough} onChange={(event) => setGoodThrough(event.target.value)} /></label>
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
        {dateProblem && <p className="mt-2 text-xs text-warn">{dateProblem}</p>}
        <button className="btn-ghost mt-3 w-full" data-testid="request-payoff" disabled={!goodThrough || Boolean(dateProblem) || asked} onClick={async () => { setAsked(true); await dispatch({ t: "requestPayoff", dealId: deal.id, goodThrough, by: viewerName }); setAsked(false); }}>Request a payoff letter</button>
        <p className="mt-2 text-xs text-muted-foreground">We email you an itemized payoff letter within {LETTER_DAYS} days, usually much sooner. A title company closing your sale can ask for one on our <a className="text-link underline" href="/payoff">payoff request page</a> with your signed authorization.</p>
        {requests.length > 0 && (
          <ul className="mt-3 space-y-2 text-xs" data-testid="my-payoffs">
            {requests.map((payoff) => {
              const letter = latestLetter(payoff);
              return (
                <li key={payoff.id} className="rounded-[2px] border border-border p-2">
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{payoff.requester && payoff.requester.kind !== "borrower" ? requesterLine(payoff) : "You"} asked, good through {shortDay(payoff.goodThrough)}</span><Badge tone={requestState(payoff).tone}>{payoff.status === "requested" ? "Being prepared" : requestState(payoff).label}</Badge></div>
                  {payoff.status === "requested" && <p className="mt-1 text-muted-foreground">We&apos;ll send it by {dueOf(payoff)}.</p>}
                  {payoff.refused && <p className="mt-1 text-muted-foreground">We couldn&apos;t send this one: {payoff.refused.reason}</p>}
                  {letter && <p className="mt-1">Letter {letter.number}{letter.replaces ? " (corrected)" : ""}: {usd(letter.total, 2)} if received by {shortDay(letter.goodThrough)}, then {usd(letter.perDiem, 2)} a day. <a className="text-link underline" data-testid="my-letter-pdf" href={local ? "/payoff-letter/demo" : `/api/payoffs/${payoff.id}/letter?n=${letter.number}`} target="_blank" rel="noreferrer">Open the letter</a></p>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 rounded-md bg-bad/10 p-2 text-xs text-bad">Payoffs are paid by wire. We will never email you wire instructions. Always confirm by phone with a number you already have.</p>
      </div>
    </Section>
  );
}
