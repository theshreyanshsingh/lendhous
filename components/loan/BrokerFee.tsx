"use client";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { FEE_STATE, feeOf, feePaidProblem } from "@/lib/brokers";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const IN_REVIEW = ["submitted", "initial_review", "underwriting"];

/** The broker on a loan: their fee in points until the term sheet goes out, then expected, unpaid or paid (lib/brokers.ts). */
export function BrokerFee({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const broker = s.brokers.find((item) => item.id === deal.brokerId);
  const fee = feeOf(deal);
  const today = serviceDay(s);
  const [points, setPoints] = useState(String(deal.brokerPoints ?? 0));
  const [paid, setPaid] = useState({ amount: String(fee.amount || ""), on: today, reference: "" });
  if (!deal.brokerId) return null;
  const problem = feePaidProblem(deal, Number(paid.amount), paid.on, today);
  return (
    <Section title="Broker" right={<Badge tone={fee.state === "paid" ? "green" : fee.state === "unpaid" ? "amber" : "slate"}>{FEE_STATE[fee.state]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="broker-fee">
        <p>{broker?.name ?? "A broker"}{deal.referredBy ? ` · referred the borrower on ${shortDay(deal.referredBy.on)}` : ""} · {deal.brokerPoints ?? 0} points ({usd(fee.amount, 2)})</p>
        {deal.brokerFeePaid && <p className="text-good" data-testid="broker-fee-paid">Paid {usd(deal.brokerFeePaid.amount, 2)} on {shortDay(deal.brokerFeePaid.on)}{deal.brokerFeePaid.reference ? ` (${deal.brokerFeePaid.reference})` : ""}, recorded by {deal.brokerFeePaid.by}.</p>}
        {IN_REVIEW.includes(deal.status) && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Broker&apos;s fee (points)</span><input className="desk-input w-28!" type="number" inputMode="decimal" min={0} max={5} step={0.25} data-testid="broker-points" value={points} onChange={(event) => setPoints(event.target.value)} /></label>
            <button type="button" className="btn-ghost" data-testid="broker-points-save" disabled={Number(points) === (deal.brokerPoints ?? 0)} onClick={() => void dispatch({ t: "setBrokerPoints", dealId: deal.id, points: Number(points) })}>Save</button>
            <p className="w-full text-xs text-muted-foreground">Set before the term sheet goes out: it&apos;s shown there, and counted in the usury check.</p>
          </div>
        )}
        {fee.state === "unpaid" && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="block"><span className="label">Amount paid</span><input className="desk-input w-32!" inputMode="decimal" data-testid="broker-paid-amount" value={paid.amount} onChange={(event) => setPaid({ ...paid, amount: event.target.value })} /></label>
            <label className="block"><span className="label">Paid on</span><input className="desk-input w-auto!" type="date" data-testid="broker-paid-on" value={paid.on} onChange={(event) => setPaid({ ...paid, on: event.target.value })} /></label>
            <label className="block min-w-0 flex-1 basis-40"><span className="label">Reference (optional)</span><input className="desk-input" maxLength={160} placeholder="Settlement statement line, wire" value={paid.reference} onChange={(event) => setPaid({ ...paid, reference: event.target.value })} /></label>
            <button type="button" className="btn-primary" data-testid="broker-paid-save" disabled={Boolean(problem)} title={problem ?? undefined} onClick={() => void dispatch({ t: "brokerFeePaid", dealId: deal.id, amount: Number(paid.amount), on: paid.on, reference: paid.reference, by: viewerName })}>Record it paid</button>
            <p className="w-full text-xs text-muted-foreground">Usually paid by the title company from the settlement. It counts toward the broker&apos;s 1099-NEC in the year it&apos;s paid.</p>
          </div>
        )}
      </div>
    </Section>
  );
}
