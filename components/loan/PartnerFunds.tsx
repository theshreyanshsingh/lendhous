"use client";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { maskAccount } from "@/lib/closing";
import type { Deal } from "@/lib/mockData";
import { FUNDING_STAGES } from "@/lib/partner-funding";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

/**
 * A partner lender's share of the money for closing (Spec P7). The partner sees where to send it once the escrow
 * account is verified and says when it's sent; the team confirms it arrived, which funding waits for.
 */
export function PartnerFunds({ deal, side }: { deal: Deal; side: "partner" | "team" }) {
  const { s, dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [sent, setSent] = useState({ on: "", reference: "" });
  const [on, setOn] = useState("");
  const funding = deal.partnerFunding;
  if (!funding) return null;
  const partner = s.partners.find((item) => item.id === funding.partnerId)?.name ?? "The partner";
  const status = funding.received ? <Badge tone="green">Received {shortDay(funding.received.on)}</Badge> : funding.sent ? <Badge tone="blue">Sent {shortDay(funding.sent.on)}</Badge> : <Badge tone="amber">Not sent yet</Badge>;
  const ready = FUNDING_STAGES.includes(deal.status);

  if (side === "partner") {
    const to = funding.sendTo;
    return (
      <Section title="Fund your share" right={status}>
        <div className="space-y-3 text-sm" data-testid="partner-funding">
          <p>Your share for closing is <b data-testid="partner-funding-amount">{usd(funding.amount)}</b>.</p>
          {funding.received ? <p className="text-muted-foreground">LendHous confirmed it arrived in escrow on {shortDay(funding.received.on)}.</p>
            : funding.sent ? <p className="text-muted-foreground">You sent it on {shortDay(funding.sent.on)}{funding.sent.reference ? ` (reference ${funding.sent.reference})` : ""}. LendHous will confirm when it arrives.</p>
            : !ready ? <p className="text-muted-foreground">Where to send it appears here once the loan is clear to close.</p>
            : !to ? <p className="text-muted-foreground">LendHous is verifying the title company&apos;s escrow account by phone. Where to send it appears here once that&apos;s done.</p>
            : (
              <>
                <dl className="grid gap-x-4 gap-y-1 rounded-[2px] border border-border p-3 sm:grid-cols-[auto_1fr]" data-testid="partner-send-to">
                  <dt className="text-muted-foreground">Beneficiary</dt><dd className="wrap-anywhere">{to.beneficiary}</dd>
                  <dt className="text-muted-foreground">Bank</dt><dd>{to.bankName}</dd>
                  <dt className="text-muted-foreground">Routing</dt><dd className="font-mono">{to.routing}</dd>
                  <dt className="text-muted-foreground">Account</dt><dd className="font-mono">{to.account}</dd>
                  <dt className="text-muted-foreground">Reference</dt><dd className="wrap-anywhere">{to.reference}</dd>
                </dl>
                <p className="rounded-md bg-bad/10 p-2 text-xs text-bad">Verified by LendHous by phone on {shortDay(to.verifiedOn)}. Before you wire, call LendHous on a number you already have to confirm them. LendHous never sends wire instructions by email.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block"><span className="label">Sent on</span><input type="date" className="desk-input w-auto!" data-testid="partner-sent-on" max={today} value={sent.on || today} onChange={(event) => setSent({ ...sent, on: event.target.value })} /></label>
                  <label className="block min-w-0 flex-1"><span className="label">Wire reference (optional)</span><input className="desk-input" data-testid="partner-sent-reference" maxLength={80} value={sent.reference} onChange={(event) => setSent({ ...sent, reference: event.target.value })} /></label>
                  <button type="button" className="btn-primary" data-testid="partner-mark-sent" disabled={!(sent.on || today)} onClick={() => void dispatch({ t: "partnerFundsSent", dealId: deal.id, sentOn: sent.on || today, reference: sent.reference, by: viewerName })}>We sent it</button>
                </div>
              </>
            )}
        </div>
      </Section>
    );
  }

  return (
    <Section title="Partner's share" right={status}>
      <div className="space-y-2 text-sm" data-testid="team-partner-funding">
        <p>{partner} funds <b>{usd(funding.amount)}</b> of this loan.{funding.sent ? ` They sent it on ${shortDay(funding.sent.on)}${funding.sent.reference ? ` (reference ${funding.sent.reference})` : ""}.` : ready ? " They see the verified escrow wire on their loan page and say here when it's sent." : ""}</p>
        {funding.received ? <p className="text-muted-foreground">Confirmed in escrow on {shortDay(funding.received.on)} by {funding.received.by}.</p> : ready && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Arrived in escrow on</span><input type="date" className="desk-input w-auto!" data-testid="partner-received-on" max={today} value={on || today} onChange={(event) => setOn(event.target.value)} /></label>
            <button type="button" className="btn-primary" data-testid="partner-mark-received" onClick={() => void dispatch({ t: "partnerFundsReceived", dealId: deal.id, on: on || today, by: viewerName })}>Mark received</button>
            <p className="w-full text-xs text-muted-foreground">Check with the title company, or your bank statement, that it reached the escrow account{deal.wires?.length ? ` (${maskAccount(deal.wires[deal.wires.length - 1].account)})` : ""}. The loan can&apos;t fund until it has.</p>
          </div>
        )}
      </div>
    </Section>
  );
}
