"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { matchPartner } from "@/lib/engine";
import { SERVICING_STRIP_PCT, tapeOf } from "@/lib/loan-sale";
import type { LoanBuyer } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
import { Badge, GradeBadge, Stat, ColorDot, k, pct, productLabel, usd } from "@/components/ui";
import { BuyerGate } from "./buyer-gate";

export default function LoansForSale() {
  return <BuyerGate>{(me) => <Market me={me} />}</BuyerGate>;
}

function Market({ me }: { me: LoanBuyer }) {
  const { s } = useStore();
  const [product, setProduct] = useState("all");
  const [sort, setSort] = useState("match");
  const listed = useMemo(() => s.sales.filter((sale) => sale.status === "listed").map((sale) => {
    const deal = s.deals.find((item) => item.id === sale.dealId)!;
    const tape = tapeOf(deal, sale);
    const fit = matchPartner(me.buyBox, { product: tape.product, state: tape.state, noteAmount: tape.balance, ltarv: tape.ratios.find((r) => r.key === "ltarv")?.actual, ltv: tape.ratios.find((r) => r.key === "ltv")?.actual, fico: tape.fico, tier: tape.tier, rate: tape.noteRate });
    return { sale, tape, fit, offer: s.offers.find((item) => item.saleId === sale.id && item.buyerId === me.id) };
  }), [s.sales, s.deals, s.offers, me]);
  const rows = listed
    .filter((row) => product === "all" || row.tape.product === product)
    .sort((a, b) => (sort === "yield" ? b.tape.askYield - a.tape.askYield : sort === "size" ? b.tape.balance - a.tape.balance : b.fit.match - a.fit.match));
  const balance = listed.reduce((sum, row) => sum + row.tape.balance, 0);
  const openOffers = s.offers.filter((offer) => offer.buyerId === me.id && offer.status === "submitted").length;
  const weighted = balance ? listed.reduce((sum, row) => sum + row.tape.askYield * row.tape.balance, 0) / balance : 0;
  return (
    <div className="space-y-4">
      <PageIntro eyebrow={me.name} title="Loans for sale" lede="Funded loans LendHous is selling, serviced by LendHous after you buy. Borrower names and street addresses stay hidden until a sale closes." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Loans available" value={listed.length} /></div>
        <div className="glass p-4"><Stat label="Unpaid balance" value={k(balance)} /></div>
        <div className="glass p-4"><Stat label="Average yield at asking" value={balance ? `${weighted.toFixed(2)}%` : "—"} sub="weighted by balance" /></div>
        <div className="glass p-4"><Stat label="Your open offers" value={openOffers} /></div>
      </div>
      <div className="glass min-w-0 px-3 py-2 text-xs text-muted-foreground">Your buy box: {me.buyBox.products.map((p) => productLabel[p]).join(", ")} · {me.buyBox.states.join("/")} · {usd(me.buyBox.minLoan)}–{usd(me.buyBox.maxLoan)} · min FICO {me.buyBox.minFico} · target yield {me.buyBox.targetYield}%</div>
      <div className="flex flex-wrap gap-2">
        <select className="desk-input w-full sm:w-auto" aria-label="Filter by product" value={product} onChange={(event) => setProduct(event.target.value)}><option value="all">All products</option>{Object.entries(productLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select className="desk-input w-full sm:w-auto" aria-label="Sort loans" value={sort} onChange={(event) => setSort(event.target.value)}><option value="match">Best fit first</option><option value="yield">Highest yield first</option><option value="size">Largest balance first</option></select>
      </div>
      {rows.length === 0 && <div className="glass p-6 text-sm text-muted-foreground">{listed.length === 0 ? "No loans for sale right now." : "No loans match this filter."}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ sale, tape, fit, offer }) => (
          <Link key={sale.id} href={`/admin/buyer/loans/${sale.id}`} className="glass block min-w-0 p-5 transition-colors hover:border-faint" data-testid="loan-for-sale">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="text-xs text-muted-foreground">{tape.tapeId} · {productLabel[tape.product]}</div><div className="text-lg font-semibold">{tape.county} County, {tape.state}</div></div>
              <GradeBadge grade={tape.grade} score={tape.score} />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <div className="min-w-0"><div className="text-2xl font-semibold tracking-tight text-foreground">{usd(tape.balance)}</div><div className="text-xs text-muted-foreground">unpaid balance</div></div>
              <div className="shrink-0 text-right"><div className="text-2xl font-semibold tracking-tight text-good">{tape.askYield.toFixed(2)}%</div><div className="text-xs text-muted-foreground">yield at asking</div></div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
              <Stat label="Asking" value={`${tape.askPct.toFixed(2)}`} sub={usd(tape.askPrice)} />
              <Stat label="Note rate" value={`${tape.noteRate.toFixed(2)}%`} sub={`${tape.netRate.toFixed(2)}% net`} />
              <Stat label="Time left" value={`${tape.monthsLeft} mo`} sub={`FICO ${tape.ficoBand}`} />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">{tape.ratios.map((r) => <span key={r.key} className="inline-flex items-center gap-1"><ColorDot color={r.color} />{r.label} {r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual)}</span>)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {tape.current ? <Badge tone="green">Paying on time</Badge> : <Badge tone="rose">{tape.paymentsLate} payments late</Badge>}
              <Badge tone="blue">fit {fit.match}%</Badge>
              {tape.holdbackLeft > 0 && <Badge tone="amber">{k(tape.holdbackLeft)} still to fund</Badge>}
              {offer && <Badge tone={offer.status === "declined" ? "slate" : "violet"}>{offer.status === "declined" ? "offer declined" : `your offer ${offer.pricePct.toFixed(2)}`}</Badge>}
            </div>
          </Link>
        ))}
      </div>
      <p className="text-xs text-faint">Price is a percent of the unpaid balance: 100 is par, 98 is a 2% discount. Yield assumes the loan pays as agreed to maturity, after the {SERVICING_STRIP_PCT}% servicing fee, before any accrued interest settled at closing. Not an offer of securities.</p>
    </div>
  );
}
