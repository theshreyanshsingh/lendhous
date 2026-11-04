"use client";
import { useEffect, useState } from "react";
import { payoffError, payoffOn } from "@/lib/loan-exits";
import { letterCovers, requesterLine } from "@/lib/payoffs";
import type { Deal, PaymentMethod } from "@/lib/mockData";
import { METHODS } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";

const amountOf = (text: string) => Math.round((Number(text.replace(/[^0-9.]/g, "")) || 0) * 100) / 100;

/**
 * Records the money that pays a loan off. It shows the payoff on the day the money arrived and won't take less: a short
 * amount is a payment, not a payoff, unless it was paid on a payoff letter that said so. Anything over is owed back to
 * the borrower.
 */
export function RecordPayoff({ deal, onDone }: { deal: Deal; onDone?: () => void }) {
  const { s, dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [onLetter, setOnLetter] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("wire");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (today) setReceivedOn((current) => current || today); }, [today]);
  const quote = receivedOn ? payoffOn(deal, receivedOn).quote : null;
  // Starts at the payoff for the day chosen, until someone types an amount.
  const value = amount ? amountOf(amount) : quote?.total ?? 0;
  // Letters good through the day it arrived that the money covers. Paid on one, it's a payoff even if the letter came up short.
  const letters = receivedOn ? s.payoffs.filter((payoff) => payoff.dealId === deal.id).flatMap((payoff) => (payoff.letters ?? []).filter((letter) => letterCovers(letter, value, receivedOn)).map((letter) => ({ payoff, letter }))) : [];
  const short = quote ? quote.total - value >= 0.005 : false;
  const chosen = short ? letters.find((item) => `${item.payoff.id}:${item.letter.number}` === onLetter) : undefined;
  const refused = receivedOn && today ? payoffError(deal, value, receivedOn, today, chosen?.letter) : null;
  const over = quote ? value - quote.total : 0;
  const save = async () => {
    setSaving(true);
    const done = await dispatch({ t: "recordPayoff", dealId: deal.id, amount: value, receivedOn, method, reference, by: viewerName, ...(chosen ? { onLetter: { payoffId: chosen.payoff.id, number: chosen.letter.number } } : {}) });
    setSaving(false);
    if (done) onDone?.();
  };
  return (
    <div className="space-y-3" data-testid="record-payoff-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Received on</span><input className="desk-input" data-testid="payoff-received-on" type="date" min={deal.closingDate} max={today || undefined} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} /></label>
        <label className="block"><span className="label">Amount received ($)</span><input className="desk-input" data-testid="payoff-amount" inputMode="decimal" placeholder={quote ? quote.total.toFixed(2) : ""} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="block"><span className="label">How it was paid</span><select className="desk-input" data-testid="payoff-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block"><span className="label">Reference (optional)</span><input className="desk-input" data-testid="payoff-reference" maxLength={120} placeholder="Wire confirmation or title company file" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      </div>
      {quote && (
        <dl className="space-y-1 rounded-[2px] border border-border bg-muted/40 p-3 text-sm" data-testid="payoff-owed">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Principal</dt><dd>{usd(quote.principal, 2)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Interest since the last payment</dt><dd>{usd(quote.accrued, 2)}</dd></div>
          {quote.defaultAccrued > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Default interest</dt><dd>{usd(quote.defaultAccrued, 2)}</dd></div>}
          {quote.fees > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Late fees</dt><dd>{usd(quote.fees, 2)}</dd></div>}
          {quote.credit > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Credit held</dt><dd>{usd(-quote.credit, 2)}</dd></div>}
          <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>Payoff on {receivedOn}</dt><dd data-testid="payoff-owed-total">{usd(quote.total, 2)}</dd></div>
          {over >= 0.01 && <p className="text-xs text-warn" data-testid="payoff-over">{usd(over, 2)} more than the payoff: refund it to the borrower.</p>}
        </dl>
      )}
      {short && letters.length > 0 && (
        <fieldset className="space-y-1 rounded-[2px] border border-border p-3 text-xs" data-testid="payoff-on-letter">
          <legend className="px-1 font-medium">Paid on a payoff letter?</legend>
          <p className="text-muted-foreground">Florida holds us to a letter we sent. If this was paid on one of these, it&apos;s a payoff: the mortgage is released, and what the letter left out is still owed by the borrower.</p>
          {letters.map(({ payoff, letter }) => {
            const key = `${payoff.id}:${letter.number}`;
            return <label key={key} className="flex items-start gap-2"><input type="radio" name="on-letter" className="mt-0.5" data-testid="payoff-letter-choice" checked={onLetter === key} onChange={() => setOnLetter(key)} /><span>Letter {letter.number} to {requesterLine(payoff)}: {usd(letter.total, 2)} through {shortDay(letter.goodThrough)}</span></label>;
          })}
          {onLetter && <button type="button" className="text-link underline" onClick={() => setOnLetter("")}>Not paid on a letter</button>}
        </fieldset>
      )}
      {chosen && quote && <p className="text-xs text-warn" data-testid="payoff-shortfall">{usd(quote.total - value, 2)} stays owed by the borrower and guarantors after the release. The team is told.</p>}
      {refused && <p className="text-xs text-warn" data-testid="payoff-short">{refused}</p>}
      <p className="text-xs text-muted-foreground">This closes the loan: its capital is freed, open draws and extensions end, and a listing for sale is withdrawn.</p>
      <button type="button" className="btn-primary w-full sm:w-auto" data-testid="save-payoff" disabled={saving || !receivedOn || value <= 0 || Boolean(refused)} onClick={save}>{saving ? "Saving…" : `Record the payoff of ${usd(value, 2)}`}</button>
    </div>
  );
}
