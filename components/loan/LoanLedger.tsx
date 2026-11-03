"use client";
import { useState } from "react";
import type { Deal } from "@/lib/mockData";
import { BILL_LABEL, billTone, ledger, METHODS, servicingTermsOf, shownRows } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, Stat, shortDate, statGrid, usd } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { Extensions } from "./Extensions";
import { LoanDefault } from "./LoanDefault";
import { PaidOff } from "./PaidOff";
import { RecordPayment } from "./RecordPayment";
import { RecordPayoff } from "./RecordPayoff";

/** The servicing team's view of one loan: what's owed, every payment due and how it was paid, and the money received. */
export function LoanLedger({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const l = ledger(deal);
  const { graceDays, lateFeePct } = servicingTermsOf(deal);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [all, setAll] = useState(false);
  const rows = [...shownRows(l)].reverse();
  const [payingOff, setPayingOff] = useState(false);
  const close = () => { setWaiving(null); setReversing(null); setReason(""); };
  const paidOff = deal.status === "paid_off";
  const waive = async (due: string) => { if (await dispatch({ t: "waiveLateFee", dealId: deal.id, due, reason, by: viewerName })) close(); };
  const reverse = async (paymentId: string) => { if (await dispatch({ t: "reversePayment", dealId: deal.id, paymentId, reason, by: viewerName })) close(); };
  const reasonField = (onSave: () => void, label: string) => (
    <span className="mt-2 flex flex-wrap items-end gap-2">
      <label className="block min-w-0 flex-1 basis-48"><span className="label">Reason</span><input className="desk-input" data-testid="servicing-reason" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="confirm-servicing" disabled={!reason.trim()} onClick={onSave}>{label}</button>
      <button type="button" className="btn-ghost h-10! px-3! text-xs!" onClick={close}>Cancel</button>
    </span>
  );
  return (
    <div className="space-y-4" data-testid="loan-ledger">
      {paidOff ? <PaidOff deal={deal} side="team" /> : (
        <>
          <Section title="Servicing" right={deal.status === "default" ? <Badge tone="rose">Default</Badge> : l.matured ? <Badge tone="rose">Matured</Badge> : l.paymentsLate ? <Badge tone="rose">{l.paymentsLate} past due</Badge> : <Badge tone="green">Current</Badge>}>
            <div className={statGrid}>
              <Stat label="Due now" value={<span className={l.amountDue ? "text-bad" : ""} data-testid="ledger-due">{usd(l.amountDue, 2)}</span>} sub={l.daysPastDue ? `${l.daysPastDue} days past due` : undefined} />
              <Stat label="Next payment" value={l.nextDue ?? "—"} sub={l.rows.find((row) => row.due === l.nextDue) ? usd(l.rows.find((row) => row.due === l.nextDue)!.amount, 2) : undefined} />
              <Stat label="Late fees owed" value={<span data-testid="ledger-fees">{usd(l.feesOwed, 2)}</span>} sub={l.credit ? `${usd(l.credit, 2)} credit held` : undefined} />
              <Stat label="Matures" value={<span data-testid="ledger-maturity">{l.maturity}</span>} sub={l.matured ? `${-l.daysToMaturity} days ago` : `in ${l.daysToMaturity} days`} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">A payment is late {graceDays} days after it&apos;s due and then owes a {lateFeePct * 100}% late fee. {deal.servicedThrough ? `Checked through ${deal.servicedThrough}.` : "Not checked by the nightly job yet."}</p>
          </Section>
          <Section title="Record a payment">
            {/* Starts over whenever what's owed changes, so the suggested amount is never out of date. */}
            <RecordPayment key={`${deal.payments?.length ?? 0}:${l.amountDue}`} deal={deal} />
          </Section>
          <Extensions deal={deal} side="team" />
          <LoanDefault deal={deal} />
          <Section title="Payoff">
            {!payingOff && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="min-w-0 flex-1 basis-60 text-muted-foreground">When the payoff arrives, record it here to close the loan.</p>
                <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="start-payoff" onClick={() => setPayingOff(true)}>Record the payoff</button>
              </div>
            )}
            <Reveal open={payingOff}><RecordPayoff deal={deal} onDone={() => setPayingOff(false)} /></Reveal>
          </Section>
        </>
      )}
      {!paidOff && <Section title="Payments due">
        <ul className="divide-y divide-border text-sm" data-testid="ledger-rows">
          {(all ? rows : rows.slice(0, 12)).map((row) => (
            <li key={row.due} className="py-2" data-testid="ledger-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.due}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {usd(row.amount, 2)}
                  <Badge tone={billTone(row.status)}>{BILL_LABEL[row.status]}</Badge>
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{row.paidOn ? `Paid ${row.paidOn}` : row.status === "boarded" ? "Paid before payments were recorded here" : row.status === "late" ? `Late since ${row.lateOn}` : `Late from ${row.lateOn} if unpaid`}</span>
                {row.late && (
                  <span className="flex flex-wrap items-center gap-2">
                    {row.waived ? <span data-testid="fee-waived">Late fee waived</span> : <span>Late fee {usd(row.fee, 2)}{row.feePaid >= row.fee ? " (paid)" : ""}</span>}
                    {!row.waived && row.feePaid < row.fee && waiving !== row.due && <button type="button" className="text-link hover:underline" data-testid="waive-fee" onClick={() => { close(); setWaiving(row.due); }}>Waive</button>}
                  </span>
                )}
              </div>
              {waiving === row.due && reasonField(() => waive(row.due), "Waive the fee")}
            </li>
          ))}
        </ul>
        {rows.length > 12 && <button type="button" className="btn-ghost mt-2" onClick={() => setAll(!all)}>{all ? "Show the last 12" : `Show all ${rows.length}`}</button>}
      </Section>}
      <Section title={`Money received (${(deal.payments ?? []).length})`}>
        {!(deal.payments ?? []).length && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
        <ul className="divide-y divide-border text-sm" data-testid="ledger-payments">
          {[...(deal.payments ?? [])].reverse().map((payment) => (
            <li key={payment.id} className="py-2" data-testid="ledger-payment">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={payment.reversed ? "text-muted-foreground line-through" : "font-medium"}>{usd(payment.amount, 2)} · {payment.receivedOn}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {METHODS[payment.method]}{payment.reference ? ` ${payment.reference}` : ""}
                  {!payment.reversed && !paidOff && reversing !== payment.id && <button type="button" className="text-link hover:underline" data-testid="reverse-payment" onClick={() => { close(); setReversing(payment.id); }}>Reverse</button>}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Recorded by {payment.by || "the team"} on {shortDate(payment.at)}{payment.reversed ? `. Reversed by ${payment.reversed.by} on ${shortDate(payment.reversed.at)}: ${payment.reversed.reason}` : ""}</p>
              {reversing === payment.id && reasonField(() => reverse(payment.id), "Reverse it")}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
