"use client";
import Link from "next/link";
import { InvestorStatements } from "@/components/InvestorStatements";
import { PartnerMoney } from "@/components/PartnerMoney";
import { PortfolioCharts } from "@/components/charts/PortfolioCharts";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, productLabel, shortDate, usd } from "@/components/ui";
import { INVESTOR_STATUS, investorStatus, latestUpdate, STATUS_TONE } from "@/lib/investor-updates";
import { evaluate } from "@/lib/engine";
import { holdingsOf, splitOf } from "@/lib/investor-statements";
import { shortDay } from "@/lib/format";
import { balanceOf, ledger } from "@/lib/servicing";
import { useStore } from "@/lib/store";

/** A partner lender's funded loans (Spec P8): its share, what it earns, what it has been paid, and where each stands. */
export default function PartnerPortfolio() {
  const { s } = useStore();
  const me = s.partners.find((partner) => partner.id === s.partnerId);
  if (!me) return <div className="glass mx-auto max-w-xl p-6 text-center" data-testid="no-partner-org">Your organization isn&apos;t connected yet.</div>;
  const rows = holdingsOf(s, { type: "partner", id: me.id }).map((holding) => {
    // A share handed on to another holder earns nothing more after that day.
    const paidOff = holding.deal.status === "paid_off" || Boolean(holding.until);
    const balance = paidOff ? 0 : holding.share * balanceOf(holding.deal);
    return { holding, balance, funded: holding.share * evaluate(holding.deal.app).noteAmount, drawn: holding.share * (holding.deal.disbursedDraws ?? 0), received: splitOf(holding, () => true), monthly: (balance * holding.investorRate) / 100 / 12, late: paidOff ? 0 : ledger(holding.deal).daysPastDue, paidOff };
  });
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return (
    <div className="space-y-4">
      <PageIntro eyebrow={me.name} title="My portfolio" lede="The loans you funded with LendHous: your share, what you earn, and what's been paid to you." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Committed" value={k(sum((row) => row.funded))} sub={`${rows.length} loan${rows.length === 1 ? "" : "s"}`} /></div>
        <div className="glass p-4" data-testid="portfolio-balance"><Stat label="Your outstanding balance" value={k(sum((row) => row.balance))} /></div>
        <div className="glass p-4" data-testid="portfolio-received"><Stat label="Paid to you so far" value={usd(sum((row) => row.received.net), 2)} sub="after servicing" /></div>
        <div className="glass p-4"><Stat label="Monthly interest to you" value={usd(sum((row) => row.monthly), 2)} sub="at your rate, on today's balance" /></div>
      </div>
      <PortfolioCharts investor={{ type: "partner", id: me.id }} />
      <Section title={`Funded loans (${rows.length})`}>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No funded loans yet. <Link className="text-link underline" href="/admin/partner">See the deal feed</Link>.</p>}
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.holding.deal.id} className="py-3" data-testid="portfolio-loan">
              <Link href={`/admin/partner/teasers/${row.holding.deal.id}`} className="block hover:bg-hover/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 font-medium">{row.holding.deal.loanNumber} · {productLabel[row.holding.deal.app.product]} · {row.holding.deal.address}, {row.holding.deal.city}</span>
                  <span className="flex flex-wrap items-center gap-2">{row.late > 0 && !row.paidOff && <span className="text-xs text-bad">{row.late} days late</span>}{row.holding.until ? <span data-testid="portfolio-moved"><Badge tone="slate">Moved on {shortDay(row.holding.until)}</Badge></span> : <Badge tone={STATUS_TONE[investorStatus(row.holding.deal)]}>{INVESTOR_STATUS[investorStatus(row.holding.deal)]}</Badge>}</span>
                </div>
                {row.holding.since && <p className="mt-1 text-xs text-muted-foreground" data-testid="portfolio-took-over">You took over this share on {shortDay(row.holding.since)}.</p>}
                {(() => { const moved = row.holding.until ? row.holding.deal.transfers?.find((item) => item.from === me.id && item.on === row.holding.until) : undefined; return moved ? <p className="mt-1 text-xs text-muted-foreground">Your share moved on {shortDay(moved.on)} for {usd(moved.price, 2)}{moved.settled ? `, settled ${shortDay(moved.settled.on)}` : ", to be settled"}.</p> : null; })()}
                {latestUpdate(row.holding.deal) && <p className="mt-1 text-sm text-muted-foreground" data-testid="portfolio-update">Update {shortDate(latestUpdate(row.holding.deal)!.at)}: {latestUpdate(row.holding.deal)!.text}</p>}
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Stat label="Your share" value={`${Math.round(row.holding.share * 100)}%`} sub={`${row.holding.investorRate.toFixed(2)}% to you`} />
                  <Stat label="Balance" value={usd(row.balance)} />
                  <Stat label="Draws funded" value={usd(row.drawn)} />
                  <Stat label="Paid to you" value={usd(row.received.net, 2)} sub={`${row.received.payments} payment${row.received.payments === 1 ? "" : "s"}`} />
                  <Stat label="Servicing kept" value={usd(row.received.servicingFee, 2)} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <PartnerMoney partnerId={me.id} />
      <InvestorStatements investor={{ type: "partner", id: me.id }} />
    </div>
  );
}
