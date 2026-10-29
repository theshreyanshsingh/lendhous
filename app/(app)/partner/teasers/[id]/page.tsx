"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { teaserOf } from "@/lib/teaser";
import { Badge, GradeBadge, RatioPill, Section, Stat, usd, productLabel } from "@/components/ui";

export default function TeaserDetail() {
  const { id } = useParams<{ id: string }>(); const { s, dispatch } = useStore();
  const me = s.partners.find((p) => p.id === s.partnerId);
  const d = s.deals.find((x) => x.id === id);
  const [form, setForm] = useState({ pct: 100, lenderRate: 0, lenderPoints: 0.5, conditions: "" });
  if (!me || !d || !me.ndaSigned || !d.teaserSentTo.includes(me.id)) return <div className="glass p-6">This deal isn&apos;t available to {me?.name ?? "your organization"}. <Link className="underline" href="/partner">Back to feed</Link></div>;
  const t = teaserOf(d);
  const myBid = s.bids.find((b) => b.dealId === d.id && b.partnerId === me.id);
  const won = myBid?.status === "accepted";
  const rate = form.lenderRate || Number(t.lenderYieldOffered.toFixed(2));
  return (
    <div className="space-y-4">
      <Link href="/partner" className="text-sm text-link">← Deal feed</Link>
      <div className="glass p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-muted-foreground">{t.teaserId} · {productLabel[t.product]} · closing target {t.closingDate}</div><h1 className="text-xl font-semibold tracking-tight">{won ? `${d.address}, ${d.city} ${d.zip}` : `${t.county} County · ZIP ${t.zip3}`}</h1><div className="text-sm text-muted-foreground">{won ? `${d.borrowerName} · ${d.entityName}` : "Borrower identity hidden until a binding commitment"}</div></div><GradeBadge grade={t.grade} score={t.score} /></div></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Section title="Blind summary">
            <div className="grid gap-3 sm:grid-cols-4"><Stat label="Loan amount" value={usd(t.noteAmount)} /><Stat label="Borrower rate" value={`${t.rate.toFixed(2)}%`} /><Stat label="Yield offered" value={`${t.lenderYieldOffered.toFixed(2)}%`} sub="after 1% servicing" /><Stat label="Term" value={`${t.termMonths} mo`} /><Stat label="FICO band" value={t.ficoBand} /><Stat label="Experience" value={`Tier ${t.tier}`} /><Stat label="Exit" value={t.exit} /><Stat label="Property" value={t.propertyType.toUpperCase().replace("_", "–")} /></div>
            <div className={`mt-4 grid gap-2 ${t.ratios.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>{t.ratios.map((r) => <RatioPill key={r.key} label={r.label} value={r.actual} limit={r.limit} color={r.color} kind={r.kind} isMultiple={r.key === "dscr"} />)}</div>
            {t.affiliatedContractor && <p className="mt-3 rounded-md bg-bad/10 p-2 text-xs text-bad">Disclosure: the contractor on this project is affiliated with the originator. Independent third-party inspections apply.</p>}
          </Section>
          <Section title={won ? "Full deal room (unlocked)" : "Full deal room (locked)"}>
            {won ? <div data-testid="deal-room-open" className="space-y-2 text-sm"><p>Address, borrower identity, appraisal, title and documents are now visible to {me.name}. Every view is logged and downloads are watermarked “{me.name} · {new Date().toLocaleDateString("en-US")}”.</p><ul className="list-disc pl-5 text-muted-foreground">{d.docs.filter((x) => x.status === "accepted").map((x) => <li key={x.id}>{x.name} <span className="text-faint">(view-only, watermarked)</span></li>)}</ul></div>
              : <p className="text-sm text-muted-foreground">🔒 Opens only after GT accepts your bid and you e-sign the binding commitment. NDA on file: ✔.</p>}
          </Section>
        </div>
        <div className="space-y-4">
          {myBid ? (
            <Section title="Your response"><div className="text-sm" data-testid="my-bid"><Badge tone={won ? "green" : myBid.status === "declined" ? "slate" : "violet"}>{won ? "accepted: commitment issued" : myBid.status}</Badge><p className="mt-2 text-muted-foreground">{myBid.type === "accept_as_offered" ? "Accepted as offered" : "Bid"}: {myBid.pct}% · {myBid.lenderRate}% yield · {myBid.lenderPoints} pts</p>{won && <p className="mt-2 rounded-md bg-good/10 p-2 text-good">Next: wire funds to the verified title escrow account by the funding deadline. Confirm by phone call-back before sending.</p>}</div></Section>
          ) : (
            <Section title="Place a bid">
              <div className="space-y-3">
                <label className="block"><span className="label">% of loan</span><input className="desk-input" type="number" min={10} max={100} value={form.pct} onChange={(e) => setForm({ ...form, pct: Number(e.target.value) })} /><span className="text-[11px] text-faint">100% is the whole loan. Under 100% creates a split with GT.</span></label>
                <label className="block"><span className="label">Your yield (rate to lender) %</span><input className="desk-input" type="number" step={0.125} value={rate} onChange={(e) => setForm({ ...form, lenderRate: Number(e.target.value) })} /></label>
                <label className="block"><span className="label">Points to lender</span><input className="desk-input" type="number" step={0.25} value={form.lenderPoints} onChange={(e) => setForm({ ...form, lenderPoints: Number(e.target.value) })} /></label>
                <label className="block"><span className="label">Conditions</span><input className="desk-input" placeholder="e.g. desk review of appraisal" value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} /></label>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" data-testid="place-bid" onClick={() => dispatch({ t: "bid", bid: { dealId: d.id, partnerId: me.id, pct: form.pct, lenderRate: rate, lenderPoints: form.lenderPoints, conditions: form.conditions, type: "bid" } })}>Submit bid</button>
                  <button className="btn-ghost" data-testid="accept-as-offered" onClick={() => dispatch({ t: "bid", bid: { dealId: d.id, partnerId: me.id, pct: 100, lenderRate: Number(t.lenderYieldOffered.toFixed(2)), lenderPoints: Number((t.points / 4).toFixed(2)), conditions: "", type: "accept_as_offered" } })}>Accept as offered</button>
                </div>
                <p className="text-[11px] text-faint">Questions go through the platform. Borrower contact info is masked.</p>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
