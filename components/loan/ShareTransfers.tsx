"use client";
import { useState } from "react";
import { Section, usd } from "@/components/ui";
import { currentBids, transferProblem, transferQuote } from "@/lib/capital-moves";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

/**
 * Moving a partner's share of a funded loan to another partner, or back to LendHous, partway through (lib/capital-moves.ts):
 * at par, plus its part of the holdback still held for draws, plus interest at its rate to the day. Payments from that
 * day go to the new holder, and the team marks it settled once the money has moved.
 */
export function ShareTransfers({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const holders = currentBids(s, deal.id);
  const [from, setFrom] = useState(holders[0]?.partnerId ?? "");
  const [to, setTo] = useState("gt-main");
  const [on, setOn] = useState("");
  const [rate, setRate] = useState("");
  const [settle, setSettle] = useState<Record<string, string>>({});
  if (!SERVICED.includes(deal.status) && !deal.transfers?.length) return null;
  const day = on || today;
  const bid = holders.find((item) => item.partnerId === from);
  const quote = bid && day ? transferQuote(deal, bid, day) : null;
  const problem = bid && day ? transferProblem(s, deal, from, to, day, today) : holders.length ? "Choose whose share moves." : null;
  const name = (id: string) => (id === "gt-main" ? "LendHous" : s.partners.find((partner) => partner.id === id)?.name ?? id);
  const takers = s.partners.filter((partner) => partner.ndaSigned && !holders.some((item) => item.partnerId === partner.id));
  return (
    <Section title="Move a partner's share">
      <div className="space-y-3 text-sm" data-testid="share-transfers">
        {holders.length === 0 && SERVICED.includes(deal.status) && <p className="text-muted-foreground">No partner holds a share of this loan.</p>}
        {holders.length > 0 && SERVICED.includes(deal.status) && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">Whose share</span>
                <select className="desk-input" data-testid="transfer-from" value={from} onChange={(event) => setFrom(event.target.value)}>{holders.map((item) => <option key={item.id} value={item.partnerId}>{name(item.partnerId)} ({item.pct}%)</option>)}</select>
              </label>
              <label className="block"><span className="label">Moves to</span>
                <select className="desk-input" data-testid="transfer-to" value={to} onChange={(event) => setTo(event.target.value)}><option value="gt-main">LendHous (back on our own books)</option>{takers.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select>
              </label>
              <label className="block"><span className="label">On</span><input type="date" className="desk-input" data-testid="transfer-on" min={deal.closingDate} max={today} value={day} onChange={(event) => setOn(event.target.value)} /></label>
              {to !== "gt-main" && <label className="block"><span className="label">The new holder&apos;s rate (% a year)</span><input className="desk-input" data-testid="transfer-rate" inputMode="decimal" placeholder={bid ? bid.lenderRate.toFixed(2) : ""} value={rate} onChange={(event) => setRate(event.target.value.replace(/[^0-9.]/g, ""))} /></label>}
            </div>
            {quote && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[2px] border border-border p-3 sm:grid-cols-4" data-testid="transfer-quote">
                <div><dt className="text-xs text-muted-foreground">Principal out</dt><dd className="tabular-nums">{usd(quote.principal, 2)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Held for draws</dt><dd className="tabular-nums">{usd(quote.holdback, 2)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Interest to the day</dt><dd className="tabular-nums">{usd(quote.accrued, 2)}</dd><dd className="text-[11px] text-muted-foreground">{usd(quote.perDiem, 2)} a day</dd></div>
                <div><dt className="text-xs text-muted-foreground">Price</dt><dd className="font-semibold tabular-nums" data-testid="transfer-price">{usd(quote.price, 2)}</dd></div>
              </dl>
            )}
            {problem && <p className="text-xs text-warn" data-testid="transfer-problem">{problem}</p>}
            <button type="button" className="btn-primary" data-testid="transfer-save" disabled={Boolean(problem) || !quote} onClick={() => void dispatch({ t: "transferShare", dealId: deal.id, from, to, on: day, ...(to !== "gt-main" && rate ? { rate: Number(rate) } : {}), by: viewerName }).then((done) => { if (done) { setOn(""); setRate(""); } })}>Move the share</button>
            <p className="text-xs text-muted-foreground">Payments from that day go to the new holder, who pays the price to {from ? name(from) : "the partner"}. Both are emailed.</p>
          </>
        )}
        {(deal.transfers ?? []).length > 0 && (
          <ul className="divide-y divide-border border-t border-border pt-1">
            {deal.transfers!.map((item) => (
              <li key={item.id} className="py-2" data-testid="transfer-row">
                <p>{name(item.from)}&apos;s {item.pct}% to {name(item.to)} on {shortDay(item.on)} for <b>{usd(item.price, 2)}</b>{item.to !== "gt-main" ? ` at ${item.rate.toFixed(2)}%` : ""}</p>
                {item.settled ? <p className="text-xs text-good">Settled {shortDay(item.settled.on)}{item.settled.reference ? ` (${item.settled.reference})` : ""}</p> : (
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <label className="block min-w-0 flex-1 basis-40"><span className="label">Wire reference</span><input className="desk-input" data-testid="transfer-reference" maxLength={80} value={settle[item.id] ?? ""} onChange={(event) => setSettle({ ...settle, [item.id]: event.target.value })} /></label>
                    <button type="button" className="btn-ghost" data-testid="transfer-settle" onClick={() => void dispatch({ t: "settleTransfer", dealId: deal.id, transferId: item.id, on: today, reference: settle[item.id] ?? "", by: viewerName })}>Mark settled today</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
