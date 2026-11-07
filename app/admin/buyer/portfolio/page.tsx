"use client";
import Link from "next/link";
import { holdingOf, tapeOf } from "@/lib/loan-sale";
import type { LoanBuyer } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, productLabel, usd } from "@/components/ui";
import { INVESTOR_STATUS, investorStatus, latestUpdate, STATUS_TONE } from "@/lib/investor-updates";
import { BuyerGate } from "../buyer-gate";
import { shortDay } from "@/lib/format";
import { InvestorStatements } from "@/components/InvestorStatements";
import { PortfolioCharts } from "@/components/charts/PortfolioCharts";
import { holdingsOf, splitOf } from "@/lib/investor-statements";

export default function Portfolio() {
  return <BuyerGate>{(me) => <Holdings me={me} />}</BuyerGate>;
}

function Holdings({ me }: { me: LoanBuyer }) {
  const { s } = useStore();
  const bySale = (saleId: string) => { const sale = s.sales.find((item) => item.id === saleId)!; return { sale, tape: tapeOf(s.deals.find((deal) => deal.id === sale.dealId)!, sale) }; };
  const owned = s.sales.filter((sale) => sale.soldTo === me.id).map((sale) => { const { tape } = bySale(sale.id); return { sale, tape, holding: holdingOf(tape, sale.soldPct ?? 100) }; });
  const offers = s.offers.filter((offer) => offer.buyerId === me.id && offer.status !== "accepted").map((offer) => ({ offer, ...bySale(offer.saleId) }));
  const invested = owned.reduce((sum, row) => sum + row.holding.paid, 0);
  const balance = owned.reduce((sum, row) => sum + row.tape.balance, 0);
  const income = owned.reduce((sum, row) => sum + row.holding.monthlyIncome, 0);
  const weighted = invested ? owned.reduce((sum, row) => sum + row.holding.yield * row.holding.paid, 0) / invested : 0;
  const receivedOn = new Map(holdingsOf(s, { type: "buyer", id: me.id }).map((holding) => [holding.deal.id, splitOf(holding, () => true)]));
  const received = [...receivedOn.values()].reduce((sum, split) => sum + split.net, 0);
  return (
    <div className="space-y-4">
      <PageIntro eyebrow={me.name} title="My loans & offers" lede="The loans you own, what they pay you, and where your offers stand." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Invested" value={k(invested)} /></div>
        <div className="glass p-4"><Stat label="Unpaid balance" value={k(balance)} /></div>
        <div className="glass p-4"><Stat label="Monthly income" value={usd(income)} /></div>
        <div className="glass p-4"><Stat label="Average yield" value={invested ? `${weighted.toFixed(2)}%` : "—"} sub="weighted by price paid" /></div>
      </div>
      <div className="glass p-4" data-testid="buyer-received"><Stat label="Paid to you so far" value={usd(received, 2)} sub="since you bought each loan, after servicing" /></div>
      <PortfolioCharts investor={{ type: "buyer", id: me.id }} />
      <Section title={`Loans you own (${owned.length})`}>
        {owned.length === 0 && <p className="text-sm text-muted-foreground">No loans yet. <Link className="text-link underline" href="/admin/buyer">See what&apos;s for sale</Link>.</p>}
        <ul className="divide-y divide-border">
          {owned.map(({ sale, tape, holding }) => (
            <li key={sale.id} data-testid="owned-loan">
              <Link href={`/admin/buyer/loans/${sale.id}`} className="block py-3 hover:bg-hover/60">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{tape.tapeId} · {productLabel[tape.product]} · {tape.county}, {tape.state}</span>{(() => { const deal = s.deals.find((item) => item.id === sale.dealId); const status = deal ? investorStatus(deal) : tape.current ? "current" : "late"; return <Badge tone={STATUS_TONE[status]}>{status === "late" ? `${INVESTOR_STATUS.late}: ${tape.paymentsLate} payment${tape.paymentsLate === 1 ? "" : "s"}` : INVESTOR_STATUS[status]}</Badge>; })()}</div>
                {(() => { const deal = s.deals.find((item) => item.id === sale.dealId); const update = deal && latestUpdate(deal); return update ? <p className="mt-1 text-sm text-muted-foreground" data-testid="portfolio-update">Update {shortDay(update.at.slice(0, 10))}: {update.text}</p> : null; })()}
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Balance" value={usd(tape.balance)} />
                  <Stat label="You paid" value={usd(holding.paid)} sub={`${sale.soldPct?.toFixed(2)} on ${sale.soldAt}`} />
                  <Stat label="Yield" value={`${holding.yield.toFixed(2)}%`} />
                  <Stat label="Monthly" value={usd(holding.monthlyIncome)} sub={`matures ${shortDay(tape.maturity)}`} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <InvestorStatements investor={{ type: "buyer", id: me.id }} />
      <Section title={`Your offers (${offers.length})`}>
        {offers.length === 0 && <p className="text-sm text-muted-foreground">No open offers.</p>}
        <ul className="divide-y divide-border">
          {offers.map(({ offer, tape, sale }) => (
            <li key={offer.id} data-testid="my-offer-row">
              <Link href={`/admin/buyer/loans/${sale.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-hover/60">
                <span className="min-w-0"><span className="block font-medium">{tape.tapeId} · {productLabel[tape.product]} · {tape.county}, {tape.state}</span><span className="block text-xs text-muted-foreground">Offered {offer.pricePct.toFixed(2)} · asking {tape.askPct.toFixed(2)}{offer.note ? ` · ${offer.note}` : ""}</span></span>
                <Badge tone={offer.status === "submitted" ? "violet" : "slate"}>{offer.status === "submitted" ? "Waiting for LendHous" : "Declined"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
