"use client";
import { useEffect, useState } from "react";
import { serviceDay } from "@/lib/book";
import type { Deal, PaymentMethod } from "@/lib/mockData";
import { ledger, METHODS, previewPayment } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { usd } from "@/components/ui";

const amountOf = (text: string) => Math.round((Number(text.replace(/[^0-9.]/g, "")) || 0) * 100) / 100;

/**
 * Records money received on a loan. It starts at what brings the loan current (or the next payment, when nothing is due),
 * and says where the money will go before anything is saved.
 */
export function RecordPayment({ deal, onDone }: { deal: Deal; onDone?: () => void }) {
  const { s, dispatch, viewerName } = useStore();
  const l = ledger(deal);
  const suggested = l.amountDue || l.rows.find((row) => row.status === "upcoming")?.amount || 0;
  const [amount, setAmount] = useState(suggested ? suggested.toFixed(2) : "");
  const [method, setMethod] = useState<PaymentMethod>("wire");
  const [reference, setReference] = useState("");
  // Set after the first render: the server and the browser can disagree about today's date.
  const [today, setToday] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const day = serviceDay(s) > deal.closingDate ? serviceDay(s) : deal.closingDate;
    setToday(day);
    setReceivedOn((current) => current || day);
  }, [s, deal.closingDate]);
  const value = amountOf(amount);
  const preview = value > 0 && receivedOn ? previewPayment(deal, value, receivedOn, today || receivedOn) : null;
  const save = async () => {
    setSaving(true);
    const done = await dispatch({ t: "recordPayment", dealId: deal.id, amount: value, receivedOn, method, reference, by: viewerName });
    setSaving(false);
    if (done) {
      setReference("");
      onDone?.();
    }
  };
  return (
    <div className="space-y-3" data-testid="record-payment-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Amount received ($)</span><input className="desk-input" data-testid="payment-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="block"><span className="label">Received on</span><input className="desk-input" data-testid="payment-date" type="date" min={deal.closingDate} max={today || undefined} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} /></label>
        <label className="block"><span className="label">How it was paid</span><select className="desk-input" data-testid="payment-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block"><span className="label">Reference (optional)</span><input className="desk-input" data-testid="payment-reference" maxLength={120} placeholder={method === "check" ? "Check number" : "Confirmation number"} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      </div>
      {preview && (
        <div className="rounded-[2px] border border-border bg-muted/40 p-3 text-sm" data-testid="payment-preview">
          <p className="font-medium">Where it goes</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {preview.pays.map((row) => <li key={row.due}>{row.due > (today || receivedOn) ? "Pays ahead" : "Pays"} the {row.due} payment: {usd(row.amount, 2)}</li>)}
            {preview.fees > 0 && <li>Late fees: {usd(preview.fees, 2)}</li>}
            {preview.credit > 0 && <li data-testid="preview-credit">Held as a credit until it covers a whole payment: {usd(preview.credit, 2)}</li>}
          </ul>
          <p className="mt-2 text-xs">{preview.after.amountDue > 0 ? `Still past due afterwards: ${usd(preview.after.amountDue, 2)}` : "The loan is current afterwards."}</p>
        </div>
      )}
      <button type="button" className="btn-primary w-full sm:w-auto" data-testid="save-payment" disabled={saving || value <= 0 || !receivedOn} onClick={save}>{saving ? "Saving…" : `Record ${value > 0 ? usd(value, 2) : "payment"}`}</button>
    </div>
  );
}
