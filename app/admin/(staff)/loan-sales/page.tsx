"use client";
import Link from "next/link";
import { useState } from "react";
import { pricePaid, tapeOf } from "@/lib/loan-sale";
import { TAPE_STATUSES, tapeRow, type TapeVersion } from "@/lib/loan-tape";
import { serviceDay } from "@/lib/book";
import { TapeDownload } from "@/components/TapeDownload";
import type { Deal, LoanSale } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, productLabel, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";

export default function LoanSales() {
  const { s, dispatch } = useStore();
  const tapeFor = (sale: LoanSale) => tapeOf(s.deals.find((deal) => deal.id === sale.dealId)!, sale);
  const live = s.sales.filter((sale) => sale.status === "listed");
  const sold = s.sales.filter((sale) => sale.status === "sold");
  const eligible = s.deals.filter((deal) => ["funded", "servicing_current", "servicing_delinquent"].includes(deal.status) && !s.sales.some((sale) => sale.dealId === deal.id && sale.status !== "withdrawn"));
  const buyerName = (id?: string) => s.buyers.find((buyer) => buyer.id === id)?.name ?? "Buyer";
  const waiting = s.offers.filter((offer) => offer.status === "submitted").length;
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Money" title="Loan sales" lede="Sell funded loans to buyers. Selling frees capital to lend again, and LendHous keeps servicing the loan for the fee." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Listed" value={live.length} /></div>
        <div className="glass p-4"><Stat label="Balance listed" value={k(live.reduce((sum, sale) => sum + tapeFor(sale).balance, 0))} /></div>
        <div className="glass p-4"><Stat label="Offers waiting" value={waiting} /></div>
        <div className="glass p-4"><Stat label="Sold" value={sold.length} sub={sold.length ? k(sold.reduce((sum, sale) => { const tape = tapeFor(sale); return sum + pricePaid(tape.balance, sale.soldPct ?? 100); }, 0)) + " total" : undefined} /></div>
      </div>
      <TapeSection />
      <Section title={`Listed for sale (${live.length})`}>
        {live.length === 0 && <p className="text-sm text-muted-foreground">Nothing listed. List a funded loan below.</p>}
        <ul className="divide-y divide-border">
          {live.map((sale) => {
            const tape = tapeFor(sale); const deal = s.deals.find((item) => item.id === sale.dealId)!;
            const offers = s.offers.filter((offer) => offer.saleId === sale.id && offer.status === "submitted");
            return (
              <li key={sale.id} className="py-3" data-testid="sale-row">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {productLabel[deal.app.product]} · {deal.borrowerName}</span><div className="text-xs text-muted-foreground">Balance {usd(tape.balance)} · asking {sale.askPct.toFixed(2)} ({usd(tape.askPrice)}) · {tape.askYield.toFixed(2)}% to the buyer</div></div>
                  <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="withdraw-sale" onClick={() => dispatch({ t: "unlistLoan", saleId: sale.id })}>Withdraw</button>
                </div>
                {offers.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {offers.map((offer) => (
                      <li key={offer.id} className="rounded-[2px] border border-border p-3 text-sm" data-testid="offer-row">
                        <div className="flex flex-wrap items-center justify-between gap-2"><b className="min-w-0">{buyerName(offer.buyerId)}</b><Badge tone={offer.pricePct >= sale.askPct ? "green" : "amber"}>{offer.pricePct.toFixed(2)} · {usd(pricePaid(tape.balance, offer.pricePct))}</Badge></div>
                        {offer.note && <p className="mt-1 text-xs text-muted-foreground">{offer.note}</p>}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="accept-offer" onClick={() => dispatch({ t: "decideOffer", offerId: offer.id, accept: true })}>Accept and sell</button>
                          <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="decline-offer" onClick={() => dispatch({ t: "decideOffer", offerId: offer.id, accept: false })}>Decline</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={`Ready to list (${eligible.length})`}>
        {eligible.length === 0 && <p className="text-sm text-muted-foreground">No other funded loans.</p>}
        <ul className="divide-y divide-border">{eligible.map((deal) => <ListRow key={deal.id} deal={deal} onList={(askPct) => dispatch({ t: "listLoan", dealId: deal.id, askPct })} />)}</ul>
      </Section>
      <Section title={`Sold (${sold.length})`}>
        {sold.length === 0 && <p className="text-sm text-muted-foreground">No loans sold yet.</p>}
        <ul className="divide-y divide-border">
          {sold.map((sale) => {
            const tape = tapeFor(sale); const deal = s.deals.find((item) => item.id === sale.dealId)!;
            return <li key={sale.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm" data-testid="sold-row"><span className="min-w-0">{deal.loanNumber} · {buyerName(sale.soldTo)}</span><span className="font-medium">{sale.soldPct?.toFixed(2)} · {usd(pricePaid(tape.balance, sale.soldPct ?? 100))}</span></li>;
          })}
        </ul>
      </Section>
    </div>
  );
}

function ListRow({ deal, onList }: { deal: Deal; onList: (askPct: number) => void }) {
  const [ask, setAsk] = useState(100);
  return (
    <li className="flex flex-wrap items-end justify-between gap-3 py-3" data-testid="eligible-row">
      <div className="min-w-0 flex-1 basis-56"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {productLabel[deal.app.product]} · {deal.borrowerName}</span><div className="text-xs text-muted-foreground">{deal.city} · closed {shortDay(deal.closingDate)}</div></div>
      <div className="flex items-end gap-2">
        <label className="block w-24"><span className="label">Asking</span><input className="desk-input" type="number" inputMode="decimal" step={0.25} min={50} max={120} aria-label={`Asking price for ${deal.loanNumber}`} data-testid="ask-input" value={ask} onChange={(event) => setAsk(Number(event.target.value) || 0)} /></label>
        <button type="button" className="btn-primary" data-testid="list-loan" disabled={ask < 50 || ask > 120} onClick={() => onList(ask)}>List</button>
      </div>
    </li>
  );
}

/**
 * The loan tape to send a buyer: the loans listed for sale or the whole funded book, blind for anyone or full for a buyer
 * under the NDA. The JSON file says what each column means.
 */
function TapeSection() {
  const { s } = useStore();
  const [which, setWhich] = useState<"listed" | "book">("listed");
  const [version, setVersion] = useState<TapeVersion>("blind");
  const day = serviceDay(s);
  const listedFor = (dealId: string) => s.sales.find((sale) => sale.dealId === dealId && sale.status === "listed");
  const deals = which === "listed" ? s.deals.filter((deal) => listedFor(deal.id)) : s.deals.filter((deal) => TAPE_STATUSES.includes(deal.status));
  const rows = deals.map((deal) => tapeRow(deal, version, day, listedFor(deal.id)));
  return (
    <Section title="Loan tape">
      <div className="space-y-3 text-sm" data-testid="tape-section">
        <p className="text-muted-foreground">One row per loan, with the same columns every time, to send a buyer or load into their system. The blind tape names no borrower, guarantor, street or city, but a price, date and county can still be matched to the public deed, so send even that one only to a buyer who has agreed to keep it confidential. The full one goes only to a buyer under the NDA.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="label">Loans</span><select className="desk-input w-auto!" data-testid="tape-which" value={which} onChange={(event) => setWhich(event.target.value as "listed" | "book")}><option value="listed">Listed for sale</option><option value="book">Every funded loan, including paid off</option></select></label>
          <label className="block"><span className="label">Version</span><select className="desk-input w-auto!" data-testid="tape-version" value={version} onChange={(event) => setVersion(event.target.value as TapeVersion)}><option value="blind">Blind: no names or addresses</option><option value="full">Full: for a buyer under NDA</option></select></label>
          <TapeDownload rows={rows} version={version} asOf={day} what={which === "listed" ? "for-sale" : "book"} />
        </div>
      </div>
    </Section>
  );
}
