"use client";
import Link from "next/link";
import { holdingOf, tapeOf } from "@/lib/loan-sale";
import type { LoanBuyer } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, productLabel, usd } from "@/components/ui";
import { BuyerGate } from "../buyer-gate";

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
  return (
    <div className="space-y-4">
      <PageIntro eyebrow={me.name} title="My loans & offers" lede="The loans you own, what they pay you, and where your offers stand." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Invested" value={k(invested)} /></div>
        <div className="glass p-4"><Stat label="Unpaid balance" value={k(balance)} /></div>
        <div className="glass p-4"><Stat label="Monthly income" value={usd(income)} /></div>
        <div className="glass p-4"><Stat label="Average yield" value={invested ? `${weighted.toFixed(2)}%` : "—"} sub="weighted by price paid" /></div>
      </div>
      <Section title={`Loans you own (${owned.length})`}>
        {owned.length === 0 && <p className="text-sm text-muted-foreground">No loans yet. <Link className="text-link underline" href="/admin/buyer">See what&apos;s for sale</Link>.</p>}
        <ul className="divide-y divide-border">
          {owned.map(({ sale, tape, holding }) => (
            <li key={sale.id} data-testid="owned-loan">
              <Link href={`/admin/buyer/loans/${sale.id}`} className="block py-3 hover:bg-hover/60">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{tape.tapeId} · {productLabel[tape.product]} · {tape.county}, {tape.state}</span>{tape.current ? <Badge tone="green">Paying on time</Badge> : <Badge tone="rose">{tape.paymentsLate} late</Badge>}</div>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Balance" value={usd(tape.balance)} />
                  <Stat label="You paid" value={usd(holding.paid)} sub={`${sale.soldPct?.toFixed(2)} on ${sale.soldAt}`} />
                  <Stat label="Yield" value={`${holding.yield.toFixed(2)}%`} />
                  <Stat label="Monthly" value={usd(holding.monthlyIncome)} sub={`matures ${tape.maturity}`} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
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
