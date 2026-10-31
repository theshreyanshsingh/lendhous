"use client";
import Link from "next/link";
import Tracker from "@/components/Tracker";
import { PageIntro } from "@/components/page-intro";
import { Badge, Stat, k, points, productLabel, statusLabel, usd } from "@/components/ui";
import type { Deal } from "@/lib/mockData";
import { est, useStore } from "@/lib/store";

const CLOSED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off"];
const brokerFee = (deal: Deal) => (est(deal.app).noteAmount * (deal.brokerPoints ?? 0)) / 100;

export default function BrokerHome() {
  const { s } = useStore();
  const firm = s.brokers.find((broker) => broker.id === s.brokerId);
  if (!firm) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="no-broker-org">
      <h1 className="text-xl font-normal tracking-tight">Your brokerage isn&apos;t connected yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">Once LendHous connects your brokerage, you can submit deals and track them here.</p>
    </div>);
  const mine = s.deals.filter((deal) => deal.brokerId === firm.id);
  const open = mine.filter((deal) => !CLOSED.includes(deal.status));
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
        <div className="glass p-4"><Stat label="Fees in process" value={usd(open.reduce((sum, deal) => sum + brokerFee(deal), 0))} /></div>
        <div className="glass p-4"><Stat label="Fees earned" value={<span className="text-good" data-testid="fees-earned">{usd(funded.reduce((sum, deal) => sum + brokerFee(deal), 0))}</span>} sub="paid at closing" /></div>
      </div>
      {mine.length === 0 && <div className="glass p-6 text-sm text-muted-foreground">No deals yet. Submit your first one to get an instant estimate.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {mine.map((deal) => {
          const open_ = deal.docs.filter((doc) => doc.status === "requested" || doc.status === "rejected").length;
          return (
            <Link key={deal.id} href={`/admin/broker/deals/${deal.id}`} className="glass block min-w-0 p-5 transition-colors hover:border-faint" data-testid="broker-deal">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-xs text-muted-foreground">{deal.loanNumber} · {productLabel[deal.app.product]}</div><div className="text-lg font-semibold">{deal.borrowerName}</div><div className="text-sm text-muted-foreground">{deal.address}, {deal.city}</div></div>
                <Badge tone={CLOSED.includes(deal.status) ? "green" : "blue"}>{statusLabel(deal.status)}</Badge>
              </div>
              <div className="my-4"><Tracker status={deal.status} /></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Loan" value={usd(est(deal.app).noteAmount)} />
                <Stat label="Your fee" value={usd(brokerFee(deal))} sub={points(deal.brokerPoints)} />
                <Stat label="Docs needed" value={open_} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
