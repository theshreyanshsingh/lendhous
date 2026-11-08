"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import { useServiceDay } from "@/components/loan/use-service-day";
import { creditOf, openDrawCalls, proceedsToSend, ROLLOVER, unsettledTransfers } from "@/lib/capital-moves";
import { shortDay } from "@/lib/format";
import { useStore } from "@/lib/store";

/**
 * What the team owes partners and is owed by them between loans (lib/capital-moves.ts): payoff money to send, partners'
 * shares of released draws to confirm, shares moved mid-loan to settle, and rolled-over money waiting for a next loan.
 */
export function CapitalDesk() {
  const { s, dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [sent, setSent] = useState<Record<string, { on: string; reference: string }>>({});
  const proceeds = proceedsToSend(s.partners);
  const calls = s.deals.flatMap((deal) => openDrawCalls(deal).map((call) => ({ deal, call })));
  const transfers = unsettledTransfers(s.deals);
  const waiting = s.partners.map((partner) => ({ partner, credit: creditOf(s, partner.id) })).filter((row) => row.credit > 0);
  const name = (id: string) => (id === "gt-main" ? "LendHous" : s.partners.find((partner) => partner.id === id)?.name ?? id);
  const empty = !proceeds.length && !calls.length && !transfers.length && !waiting.length;
  return (
    <Section title="Partners' money between loans" right={empty ? <Badge tone="green">Nothing owed</Badge> : <Badge tone="amber">{proceeds.length + calls.length + transfers.length} to do</Badge>}>
      <div className="space-y-4 text-sm" data-testid="capital-desk">
        {empty && <p className="text-muted-foreground">No payoff money to send, no partner's share of a draw to come in, and nothing rolled over waiting.</p>}
        {proceeds.length > 0 && (
          <div>
            <h3 className="font-medium">Payoff money to send</h3>
            <ul className="mt-1 divide-y divide-border">
              {proceeds.map(({ partner, proceeds: item }) => {
                const draft = sent[item.id] ?? { on: "", reference: "" };
                return (
                  <li key={item.id} className="py-2" data-testid="proceeds-due">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="min-w-0">{partner.name} · {item.loanNumber} paid off {shortDay(item.on)}<small className="block text-xs text-muted-foreground">{ROLLOVER[item.choice].label}{item.rolled ? ` · ${usd(item.rolled, 2)} rolled over` : ""}</small></span><b className="tabular-nums">{usd(item.toSend, 2)}</b></div>
                    <div className="mt-1 flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Sent on</span><input type="date" className="desk-input w-auto!" data-testid="proceeds-sent-on" max={today} value={draft.on || today} onChange={(event) => setSent({ ...sent, [item.id]: { ...draft, on: event.target.value } })} /></label>
                      <label className="block min-w-0 flex-1 basis-40"><span className="label">Wire reference</span><input className="desk-input" data-testid="proceeds-reference" maxLength={80} value={draft.reference} onChange={(event) => setSent({ ...sent, [item.id]: { ...draft, reference: event.target.value } })} /></label>
                      <button type="button" className="btn-ghost" data-testid="mark-proceeds-sent" onClick={() => void dispatch({ t: "sendProceeds", partnerId: partner.id, proceedsId: item.id, on: draft.on || today, reference: draft.reference, by: viewerName })}>Mark sent</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {calls.length > 0 && (
          <div>
            <h3 className="font-medium">Partners&apos; shares of draws</h3>
            <ul className="mt-1 divide-y divide-border">
              {calls.map(({ deal, call }) => (
                <li key={call.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="draw-call-due">
                  <span className="min-w-0">{name(call.partnerId)} · {deal.loanNumber} · {usd(call.amount, 2)}<small className={`block text-xs ${!call.sent && today && call.dueOn < today ? "text-bad" : "text-muted-foreground"}`}>{call.sent ? `Sent ${shortDay(call.sent.on)}${call.sent.reference ? ` (${call.sent.reference})` : ""}` : `Due by ${shortDay(call.dueOn)}${today && call.dueOn < today ? ", late" : ""}`}</small></span>
                  <button type="button" className="btn-ghost" data-testid="mark-draw-call-received" onClick={() => void dispatch({ t: "drawCallReceived", dealId: deal.id, callId: call.id, on: today, by: viewerName })}>Mark received today</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {transfers.length > 0 && (
          <div>
            <h3 className="font-medium">Shares moved, to settle</h3>
            <ul className="mt-1 divide-y divide-border">
              {transfers.map(({ deal, transfer }) => <li key={transfer.id} className="py-2" data-testid="transfer-due"><Link className="text-link underline underline-offset-2" href={`/admin/deals/${deal.id}?tab=Capital%20Routing`}>{deal.loanNumber}</Link>: {name(transfer.from)} to {name(transfer.to)} on {shortDay(transfer.on)}, {usd(transfer.price, 2)}</li>)}
            </ul>
          </div>
        )}
        {waiting.length > 0 && (
          <div>
            <h3 className="font-medium">Rolled over, waiting for a next loan</h3>
            <ul className="mt-1 divide-y divide-border">{waiting.map(({ partner, credit }) => <li key={partner.id} className="flex justify-between gap-2 py-2" data-testid="credit-waiting"><span className="min-w-0">{partner.name}</span><b className="tabular-nums">{usd(credit, 2)}</b></li>)}</ul>
            <p className="mt-1 text-xs text-muted-foreground">It goes toward the partner&apos;s share at the closing of the next loan it wins.</p>
          </div>
        )}
      </div>
    </Section>
  );
}
