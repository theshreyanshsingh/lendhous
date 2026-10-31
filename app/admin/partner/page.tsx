"use client";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { teaserOf } from "@/lib/teaser";
import { matchPartner } from "@/lib/engine";
import { PageIntro } from "@/components/page-intro";
import { Badge, GradeBadge, ColorDot, usd, pct, productLabel } from "@/components/ui";

export default function PartnerFeed() {
  const { s, dispatch } = useStore();
  const me = s.partners.find((p) => p.id === s.partnerId);
  if (!me) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="no-partner-org">
      <h1 className="text-xl font-normal tracking-tight">Your organization isn&apos;t connected yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">Once LendHous connects your organization and its buy box, matching deals appear here.</p>
    </div>);
  if (!me.ndaSigned) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="nda-gate">
      <h1 className="text-xl font-normal tracking-tight">Sign the Master Agreement + NDA / Non-Circumvention to see deals</h1>
      <p className="mt-2 text-sm text-muted-foreground">{me.name} has not signed yet. No teaser is visible until the organization signs.</p>
      <button className="btn-primary mt-4" onClick={() => dispatch({ t: "signNda", partnerId: me.id })}>E-sign agreement</button>
    </div>);
  const feed = s.deals.filter((d) => d.teaserSentTo.includes(me.id));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><PageIntro eyebrow={me.name} title="Deal feed" lede="Blind teasers routed to you, sorted by buy-box match." />
        <div className="glass mb-6 px-3 py-2 text-xs text-muted-foreground">Buy box: {me.buyBox.products.map((p) => productLabel[p]).join(", ")} · {me.buyBox.states.join("/")} · {usd(me.buyBox.minLoan)}–{usd(me.buyBox.maxLoan)} · min FICO {me.buyBox.minFico}</div></div>
      {feed.length === 0 && <div className="glass p-6 text-sm text-muted-foreground">No teasers yet. Switch to Admin and send one from a deal&apos;s Capital Routing tab.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {feed.map((d) => {
          const t = teaserOf(d); const myBid = s.bids.find((b) => b.dealId === d.id && b.partnerId === me.id);
          const won = myBid?.status === "accepted"; const lost = !won && s.bids.some((b) => b.dealId === d.id && b.status === "accepted");
          const m = matchPartner(me.buyBox, { product: d.app.product, state: d.app.state, noteAmount: t.noteAmount, ltarv: t.ratios.find((r) => r.key === "ltarv")?.actual, ltv: t.ratios.find((r) => r.key === "ltv")?.actual, fico: d.app.fico, tier: t.tier, rate: t.rate });
          return (
            <Link key={d.id} href={`/admin/partner/teasers/${d.id}`} className="glass block p-5 transition-colors hover:border-faint" data-testid="teaser-card">
              <div className="flex items-start justify-between"><div><div className="text-xs text-muted-foreground">{t.teaserId} · {productLabel[t.product]}</div><div className="text-lg font-semibold">{t.county} County · ZIP {t.zip3}</div></div><GradeBadge grade={t.grade} score={t.score} /></div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{usd(t.noteAmount)}</div>
              <div className="text-sm text-muted-foreground">Lender yield {t.lenderYieldOffered.toFixed(2)}% · {t.termMonths} mo · exit: {t.exit}</div>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">{t.ratios.map((r) => <span key={r.key} className="inline-flex items-center gap-1"><ColorDot color={r.color} />{r.label} {r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual)}</span>)}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone="blue">match {m.match}%</Badge><Badge>FICO {t.ficoBand}</Badge><Badge>Tier {t.tier}</Badge>{t.affiliatedContractor && <Badge tone="rose">GT-affiliated contractor</Badge>}{won ? <Badge tone="green">WON</Badge> : lost ? <Badge>lost</Badge> : myBid ? <Badge tone="violet">bid placed</Badge> : <Badge tone="amber">new</Badge>}</div>
            </Link>);
        })}
      </div>
    </div>
  );
}
