"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { holdingOf, pricePaid, tapeOf, SERVICING_STRIP_PCT } from "@/lib/loan-sale";
import type { LoanBuyer } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, GradeBadge, RatioPill, Section, Stat, productLabel, ratioGrid, statGrid, usd } from "@/components/ui";
import { BuyerGate } from "../../buyer-gate";

export default function LoanDetail() {
  return <BuyerGate>{(me) => <Detail me={me} />}</BuyerGate>;
}

const STEPS = ["Sign the loan sale agreement", "Wire the purchase price to the title company's escrow account, after confirming the instructions by phone", "LendHous assigns the mortgage and endorses the note to you", "The borrower is told their payments now belong to you. LendHous keeps servicing the loan"];

function Detail({ me }: { me: LoanBuyer }) {
  const { id } = useParams<{ id: string }>();
  const { s, dispatch } = useStore();
  const sale = s.sales.find((item) => item.id === id);
  const deal = s.deals.find((item) => item.id === sale?.dealId);
  const offer = s.offers.find((item) => item.saleId === id && item.buyerId === me.id);
  const [price, setPrice] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const owned = sale?.soldTo === me.id;
  const visible = sale && deal && (sale.status === "listed" || owned || offer);
  if (!visible) return <div className="glass p-6">This loan isn&apos;t available. <Link className="underline" href="/admin/buyer">Back to loans for sale</Link></div>;
  const tape = tapeOf(deal, sale);
  const chosen = price ?? sale.soldPct ?? offer?.pricePct ?? tape.askPct;
  const atChosen = holdingOf(tape, chosen);
  const gain = tape.balance - atChosen.paid;
  const canOffer = sale.status === "listed" && (!offer || offer.status === "declined");
  return (
    <div className="space-y-4">
      <Link href="/admin/buyer" className="text-sm text-link">← Loans for sale</Link>
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{tape.tapeId} · {productLabel[tape.product]} · {tape.propertyType.toUpperCase().replace("_", "–")}</div>
            <h1 className="text-xl font-normal tracking-tight" data-testid="loan-heading">{owned ? `${deal.address}, ${deal.city} ${deal.zip}` : `${tape.county} County, ${tape.state} · ZIP ${tape.zip3}`}</h1>
            <div className="text-sm text-muted-foreground">{owned ? `${deal.borrowerName} · ${deal.entityName}` : "Borrower identity hidden until the sale closes"}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2"><GradeBadge grade={tape.grade} score={tape.score} />{tape.current ? <Badge tone="green">Paying on time</Badge> : <Badge tone="rose">{tape.paymentsLate} payments late</Badge>}{owned && <Badge tone="green">You own this loan</Badge>}</div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Section title="The loan">
            <div className={statGrid}>
              <Stat label="Unpaid balance" value={usd(tape.balance)} sub={`of ${usd(tape.noteAmount)} note`} />
              <Stat label="Note rate" value={`${tape.noteRate.toFixed(2)}%`} sub={`${tape.netRate.toFixed(2)}% after servicing`} />
              <Stat label="Maturity" value={tape.maturity} sub={`${tape.monthsLeft} of ${tape.termMonths} months left`} />
              <Stat label="Monthly to you" value={usd(tape.monthlyIncome)} sub={tape.product === "dscr" ? "principal + interest" : "interest only"} />
              <Stat label="FICO band" value={tape.ficoBand} />
              <Stat label="Experience" value={`Tier ${tape.tier}`} />
              <Stat label="Exit" value={tape.exit} />
              <Stat label="Payments" value={`${tape.paymentsMade} made`} sub={tape.paymentsLate ? `${tape.paymentsLate} late` : "none late"} />
            </div>
            <div className={`mt-4 ${ratioGrid(tape.ratios.length)}`}>{tape.ratios.map((r) => <RatioPill key={r.key} label={r.label} value={r.actual} limit={r.limit} color={r.color} kind={r.kind} isMultiple={r.key === "dscr"} />)}</div>
            {tape.holdbackLeft > 0 && <p className="mt-3 rounded-md bg-warn/12 p-3 text-sm text-warn" data-testid="holdback-warning"><b>{usd(tape.holdbackLeft)} still to fund.</b> This loan has rehab or construction draws left. Whoever owns it pays them as the work is inspected, so plan for this on top of the purchase price.</p>}
            {tape.affiliatedContractor && <p className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">Disclosure: the contractor on this project is affiliated with the originator. Independent third-party inspections apply.</p>}
          </Section>
          <Section title="Payment history">
            <ol className="flex flex-wrap gap-1.5" aria-label={`${tape.paymentsMade} payments made, ${tape.paymentsLate} late`} data-testid="payment-history">
              {Array.from({ length: tape.paymentsMade }, (_, index) => <li key={index} title={`Payment ${index + 1}`} className="size-5 rounded-[2px] bg-good/70" />)}
              {Array.from({ length: tape.paymentsLate }, (_, index) => <li key={index} title="Late" className="size-5 rounded-[2px] bg-bad" />)}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">Green is paid on time, red is past due.{tape.paymentsLate ? " Yields here assume the borrower catches up, which is not guaranteed." : ""}</p>
          </Section>
          <Section title={owned ? "The file (unlocked)" : "The file (locked)"}>
            {owned ? (
              <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="file-open">{deal.docs.filter((doc) => doc.status === "accepted").map((doc) => <li key={doc.id}>{doc.name}</li>)}<li>Note, mortgage and assignment</li><li>Title policy and pay history</li></ul>
            ) : (
              <p className="text-sm text-muted-foreground">🔒 The note, mortgage, title policy, appraisal and full pay history open once LendHous accepts your offer and you sign the loan sale agreement.</p>
            )}
          </Section>
        </div>
        <div className="min-w-0 space-y-4">
          <Section title={owned ? "What you paid" : "Price this loan"}>
            {!owned && (
              <label className="block">
                <span className="label">Your price (percent of balance)</span>
                <input data-testid="price-input" className="desk-input" type="number" inputMode="decimal" step={0.25} min={50} max={120} value={chosen} disabled={!canOffer} onChange={(event) => setPrice(Number(event.target.value) || 0)} />
                <input aria-label="Price slider" className="mt-3 w-full" type="range" min={85} max={105} step={0.25} value={chosen} disabled={!canOffer} onChange={(event) => setPrice(Number(event.target.value))} />
              </label>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label={owned ? "Price paid" : "You'd pay"} value={<span data-testid="price-dollars">{usd(pricePaid(tape.balance, chosen))}</span>} sub={`${chosen.toFixed(2)} of par`} />
              <Stat label="Your yield" value={<span className="text-good" data-testid="price-yield">{chosen > 0 ? `${atChosen.yield.toFixed(2)}%` : "—"}</span>} sub={`asking gives ${tape.askYield.toFixed(2)}%`} />
              <Stat label={gain >= 0 ? "Gain at payoff" : "Premium paid"} value={usd(Math.abs(gain))} />
              <Stat label="Monthly to you" value={usd(tape.monthlyIncome)} />
            </div>
            {canOffer && (
              <div className="mt-4 space-y-3">
                <label className="block"><span className="label">Conditions (optional)</span><input className="desk-input" data-testid="offer-note" placeholder="e.g. subject to title review" value={note} onChange={(event) => setNote(event.target.value)} /></label>
                <div className="flex flex-col gap-2">
                  <button className="btn-primary w-full" data-testid="send-offer" disabled={chosen < 50} onClick={() => dispatch({ t: "offerLoan", saleId: sale.id, buyerId: me.id, pricePct: chosen, note, atAsk: chosen === tape.askPct })}>Send offer at {chosen.toFixed(2)}</button>
                  <button className="btn-ghost w-full" data-testid="buy-at-ask" onClick={() => dispatch({ t: "offerLoan", saleId: sale.id, buyerId: me.id, pricePct: tape.askPct, note: "", atAsk: true })}>Buy at asking ({tape.askPct.toFixed(2)})</button>
                </div>
                <p className="text-xs text-faint">An offer isn&apos;t binding until LendHous accepts it and you both sign the loan sale agreement.</p>
              </div>
            )}
            {offer && !canOffer && !owned && (
              <p className="mt-4 rounded-md bg-muted p-3 text-sm" data-testid="my-offer"><Badge tone="violet">{offer.status === "submitted" ? "Offer sent" : offer.status}</Badge> <span className="mt-1 block text-muted-foreground">{offer.pricePct.toFixed(2)} of par{offer.note ? ` · ${offer.note}` : ""}. LendHous reviews every offer and replies here.</span></p>
            )}
            {sale.status === "withdrawn" && !owned && <p className="mt-4 text-sm text-muted-foreground">LendHous has taken this loan off the market.</p>}
            {sale.status === "sold" && !owned && <p className="mt-4 text-sm text-muted-foreground">This loan has been sold to another buyer.</p>}
          </Section>
          <Section title={owned ? "Closing steps" : "What happens if you buy"}>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">{STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
            <p className="mt-3 rounded-md bg-bad/10 p-2 text-xs text-bad">Wire-fraud warning: we will never email you wire instructions. Always confirm by phone with a number you already have.</p>
            <p className="mt-3 text-xs text-faint">LendHous keeps a {SERVICING_STRIP_PCT}% servicing fee and sends you the rest each month.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
