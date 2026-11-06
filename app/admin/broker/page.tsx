"use client";
import { EmbedSnippet } from "@/components/EmbedSnippet";
import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrokerOnboarding } from "@/components/BrokerOnboarding";
import Tracker from "@/components/Tracker";
import { PageIntro } from "@/components/page-intro";
import { Badge, Stat, k, points, productLabel, statusLabel, usd } from "@/components/ui";
import type { Deal } from "@/lib/mockData";
import { canSendDeals, FEE_STATE, feeOf, PROTECTION_MONTHS, referralPath } from "@/lib/brokers";
import { est, useStore } from "@/lib/store";

const CLOSED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off"];
// Declined or withdrawn: no longer in process, and never earned a fee.
const ENDED = ["declined", "withdrawn"];
const brokerFee = (deal: Deal) => feeOf(deal).amount;

/** The brokerage's referral link: a borrower who asks for a quote through it is the broker's, for the agreement's protection window. */
function ReferralLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  // The site's address is only known in the browser, so it's added after the page first draws.
  const [origin, setOrigin] = useState("");
  // A phone hands the link to its own share menu (Messages, WhatsApp, email); elsewhere it's copied.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); setCanShare(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches); }, []);
  const url = `${origin}${referralPath(code)}`;
  const share = () => void navigator.share({ title: "Your LendHous loan quote", text: "See indicative terms for your deal on the spot, with no credit check:", url }).catch(() => {});
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-4" data-testid="referral-link">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-base font-medium">Your referral link</h2>
        <p className="text-sm text-muted-foreground">Send it to clients: a quote request through it comes to LendHous as yours, and the borrower stays yours for {PROTECTION_MONTHS} months.</p>
        <p className="mt-1 truncate font-mono text-xs" data-testid="referral-url">{url}</p>
      </div>
      <div className="flex gap-2 max-sm:w-full">
        {canShare && <button type="button" className="btn-primary max-sm:h-11 max-sm:flex-1" data-testid="share-referral" onClick={share}>Share link</button>}
        <button type="button" className="btn-ghost max-sm:h-11 max-sm:flex-1" data-testid="copy-referral" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy link"}</button>
      </div>
    </div>
  );
}

export default function BrokerHome() {
  const { s } = useStore();
  const firm = s.brokers.find((broker) => broker.id === s.brokerId);
  if (!firm) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="no-broker-org">
      <h1 className="text-xl font-normal tracking-tight">Your brokerage isn&apos;t connected yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">Once LendHous connects your brokerage, you can submit deals and track them here.</p>
    </div>);
  // Until an owner approves the brokerage, it signs the agreement here and can't send deals.
  if (!canSendDeals(firm)) return <div className="space-y-4"><PageIntro eyebrow={firm.name} title="Broker agreement" lede="Sign LendHous's broker agreement and send your firm's papers. Once an owner approves it, you can submit deals and share your referral link." /><BrokerOnboarding firm={firm} /></div>;
  const mine = s.deals.filter((deal) => deal.brokerId === firm.id);
  const fees = mine.map(feeOf);
  const total = (state: string) => fees.filter((fee) => fee.state === state).reduce((sum, fee) => sum + fee.amount, 0);
  const open = mine.filter((deal) => !CLOSED.includes(deal.status) && !ENDED.includes(deal.status));
  const funded = mine.filter((deal) => CLOSED.includes(deal.status));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><PageIntro eyebrow={firm.name} title="My deals" lede="Submit a client's deal, follow it to closing and see your fees." /></div>
        <Link href="/admin/broker/new" className="btn-primary mb-6 w-full sm:w-auto" data-testid="submit-deal">+ Submit a deal</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="In process" value={open.length} sub={k(open.reduce((sum, deal) => sum + est(deal.app).noteAmount, 0))} /></div>
        <div className="glass p-4"><Stat label="Funded" value={funded.length} sub={k(funded.reduce((sum, deal) => sum + est(deal.app).noteAmount, 0))} /></div>
        <div className="glass p-4"><Stat label="Fees expected" value={usd(total("expected"))} sub="loans in process" /></div>
        <div className="glass p-4"><Stat label="Fees earned" value={<span className="text-good" data-testid="fees-earned">{usd(total("paid") + total("unpaid"))}</span>} sub={total("unpaid") ? <span className="text-warn" data-testid="fees-unpaid">{usd(total("unpaid"))} not paid yet</span> : "all paid"} /></div>
      </div>
      {firm.referralCode && <ReferralLink code={firm.referralCode} />}
      {firm.referralCode && <EmbedSnippet referral={firm.referralCode} title="A quote on your own website">Paste this into a page on your site. Visitors see LendHous&apos;s terms on their deal there, and a quote they save is yours, the same as through your link.</EmbedSnippet>}
      {mine.length === 0 && <EmptyState>No deals yet. Submit your first one to get an instant estimate.</EmptyState>}
      <div className="grid gap-4 lg:grid-cols-2">
        {mine.map((deal) => {
          const open_ = deal.docs.filter((doc) => doc.status === "requested" || doc.status === "rejected").length;
          return (
            <Link key={deal.id} href={`/admin/broker/deals/${deal.id}`} className="glass block min-w-0 p-5 transition-colors hover:border-faint" data-testid="broker-deal">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-xs text-muted-foreground">{deal.loanNumber} · {productLabel[deal.app.product]}</div><div className="text-lg font-semibold">{deal.borrowerName}</div><div className="text-sm text-muted-foreground">{deal.address}, {deal.city}</div></div>
                <Badge tone={CLOSED.includes(deal.status) ? "green" : ENDED.includes(deal.status) ? "slate" : "blue"}>{statusLabel(deal.status)}</Badge>
              </div>
              <div className="my-4"><Tracker status={deal.status} /></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Loan" value={usd(est(deal.app).noteAmount)} />
                <Stat label="Your fee" value={usd(brokerFee(deal))} sub={<span data-testid="broker-fee-state">{points(deal.brokerPoints)} · {FEE_STATE[feeOf(deal).state]}</span>} />
                <Stat label="Docs needed" value={open_} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
