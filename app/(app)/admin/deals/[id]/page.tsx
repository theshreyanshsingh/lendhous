"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore, est, inHouseAvailable, capitalSummary } from "@/lib/store";
import { evaluate, recommendRoute, matchPartner, fullBoatReserve, dutchReserve, evenDraws, type Application } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing-config";
import { teaserOf } from "@/lib/teaser";
import { Badge, GradeBadge, RatioPill, Section, Stat, usd, pct, k, productLabel, statusLabel, capTone } from "@/components/ui";

const tabs = ["Numbers & Ratios", "Score & Flags", "Capital Routing", "Documents"] as const;

export default function DealWorkspace() {
  const { id } = useParams<{ id: string }>(); const { s, dispatch } = useStore();
  const d = s.deals.find((x) => x.id === id);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Numbers & Ratios");
  const [ov, setOv] = useState<Partial<Application>>({});
  const [routeSel, setRouteSel] = useState<"in_house" | "partner" | "split" | null>(null);
  const [splitAmt, setSplitAmt] = useState<number | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const uwApp = useMemo(() => (d ? { ...d.app, ...ov } : null), [d, ov]);
  if (!d || !uwApp) return <div className="glass p-6">Deal not found. <Link href="/admin" className="underline">Back</Link></div>;
  const e = evaluate(uwApp); const orig = est(d.app);
  const avail = inHouseAvailable(s.deals, s.sources, d.id);
  const rec = recommendRoute({ product: d.app.product, noteAmount: e.noteAmount, grade: e.score.grade, location: e.location, inHouseAvailable: avail });
  const cap = capitalSummary(s.deals, s.sources);
  const route = routeSel ?? d.route ?? (rec.route === "IN_HOUSE" ? "in_house" : rec.route === "SPLIT" ? "split" : "partner");
  const savedGt = d.route === "split" ? d.allocations.find((a) => a.sourceId === "gt-main")?.amount : undefined;
  const gtShare = splitAmt ?? savedGt ?? Math.min(Math.round(e.noteAmount / 2 / 5000) * 5000, Math.max(0, Math.floor(avail / 5000) * 5000));
  const bids = s.bids.filter((b) => b.dealId === d.id);
  const teaser = teaserOf(d);
  const matches = s.partners.map((p) => ({ p, m: matchPartner(p.buyBox, { product: d.app.product, state: d.app.state, noteAmount: e.noteAmount, ltarv: e.ratios.find((r) => r.key === "ltarv")?.actual, ltv: e.ratios.find((r) => r.key === "ltv")?.actual, fico: d.app.fico, tier: e.tier, rate: e.rate }) })).sort((a, b) => b.m.match - a.m.match);
  const num = (key: keyof Application, label: string) => (
    <label className="block"><span className="label">{label}</span>
      <input className="desk-input" inputMode="numeric" value={Number(uwApp[key] ?? 0).toLocaleString("en-US")} onChange={(ev) => setOv({ ...ov, [key]: Number(ev.target.value.replace(/[^0-9.]/g, "") || 0) })} />
      {ov[key] !== undefined && ov[key] !== d.app[key] && <span className="text-[11px] text-warn">borrower said {Number(d.app[key] ?? 0).toLocaleString()}</span>}
    </label>);
  const holdMonths = pricingConfig.assumptions.holdMonths;

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-link">← Pipeline</Link>
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]} · source: {d.source.replace("_", " ")}</div>
            <h1 className="text-xl font-semibold tracking-tight">{d.address}, {d.city} {d.zip} <span className="font-normal text-faint">({d.app.county})</span></h1>
            <div className="text-sm text-muted-foreground">{d.borrowerName} · {d.entityName} · FICO {d.app.fico} · Tier {e.tier}</div></div>
          <div className="flex flex-wrap items-center gap-2"><GradeBadge grade={e.score.grade} score={e.score.score} /><Badge tone="blue">{statusLabel(d.status)}</Badge><Badge tone={capTone(d.capitalStatus)}>capital: {statusLabel(d.capitalStatus)}</Badge></div>
        </div>
        {d.contractorIsGtAffiliate && <div className="mt-3 rounded-lg bg-bad/10 p-3 text-sm text-bad" data-testid="coi-banner"><b>Conflict of interest:</b> GT&apos;s construction company is the contractor. Draw inspections must be by an independent third party, a second approver outside the construction company is required, and partners must be told.</div>}
        <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((t) => <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>)}
        </div>
      </div>

      {tab === "Numbers & Ratios" && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Section title="Underwritten inputs" right={Object.keys(ov).length > 0 ? <button className="text-xs text-link underline" onClick={() => setOv({})}>reset</button> : undefined}>
            <div className="space-y-3">
              {num("purchasePrice", d.app.product === "ground_up" ? "Land value" : "Purchase / as-is")}
              {num("appraisedAsIs", "Appraised as-is (optional)")}
              {d.app.product !== "bridge" && d.app.product !== "dscr" && <>{num("rehab", "Rehab / construction budget")}{num("arv", "ARV (selected valuation)")}</>}
              {d.app.product === "dscr" && <>{num("monthlyRent", "Qualifying rent / mo")}{num("taxesAnnual", "Taxes / yr")}{num("insuranceAnnual", "Insurance / yr")}</>}
              {num("fico", "FICO (pulled)")}{num("verifiedDeals", "Verified deals (36 mo)")}{num("liquidity", "Verified liquidity")}
              <p className="text-[11px] text-faint">Edits are a live what-if. Original application values are kept.</p>
            </div>
          </Section>
          <div className="space-y-4">
            <Section title="Ratios vs. matrix limits">
              <div className={`grid gap-2 ${e.ratios.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>{e.ratios.map((r) => <RatioPill key={r.key} label={r.label} value={r.actual} limit={r.limit} color={r.color} kind={r.kind} isMultiple={r.key === "dscr"} />)}</div>
              {d.app.product !== "bridge" && d.app.product !== "dscr" && <div className="mt-2 text-xs text-muted-foreground">Total loan ÷ as-is = {pct(e.noteAmount / uwApp.purchasePrice)} (normal for rehab loans; the holdback is released by draws).</div>}
            </Section>
            <Section title="Loan sizing">
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Note amount" value={usd(e.noteAmount)} sub={orig.noteAmount !== e.noteAmount ? `application: ${usd(orig.noteAmount)}` : undefined} />
                <Stat label="Binding constraint" value={e.binding} />
                <Stat label="Initial advance" value={usd(e.initialAdvance)} />
                <Stat label="Holdback" value={usd(e.holdback)} />
              </div>
              {e.sizingCandidates && <table className="mt-3 w-full text-sm"><tbody>{Object.entries(e.sizingCandidates).map(([kk, v]) => <tr key={kk} className={kk === e.binding ? "font-semibold text-foreground" : "text-muted-foreground"}><td className="px-0">{kk}</td><td className="text-right">{usd(v)}</td></tr>)}
                {!(e.binding in e.sizingCandidates) && <tr className="font-semibold text-foreground"><td className="px-0">{e.binding}</td><td className="text-right">{usd(e.noteAmount)}</td></tr>}</tbody></table>}
            </Section>
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Pricing & cash">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Rate" value={`${e.rate.toFixed(3)}%`} sub={`matrix ${e.rateRange.join("–")}%`} />
                  <Stat label="Points" value={usd(e.points)} sub={`${e.pointsPct}%`} />
                  <Stat label="Cash to close" value={usd(e.cashToClose)} />
                  <Stat label="All-in annualized" value={pct(e.allIn, 2)} sub={`flag at ${pct(pricingConfig.allInCostFlagCeiling, 0)}`} />
                  {d.app.product !== "dscr" && <><Stat label={`Reserve full-boat ${e.termMonths}m`} value={usd(fullBoatReserve(e.noteAmount, e.rate, e.termMonths))} /><Stat label={`Reserve Dutch ${e.termMonths}m`} value={usd(dutchReserve(e.noteAmount - e.holdback, evenDraws(e.holdback, 4), e.rate, e.termMonths))} /></>}
                  {d.app.product === "dscr" && <><Stat label="Monthly P&I" value={usd(e.monthlyPayment, 2)} /><Stat label="DSCR" value={(e.dscr ?? 0).toFixed(2) + "x"} /></>}
                </div>
              </Section>
              {e.flip && <Section title={`Deal economics (${holdMonths}-mo hold)`}>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Total project cost" value={usd(e.flip.tpc)} /><Stat label="Profit" value={usd(e.flip.profit)} />
                  <Stat label="Margin" value={pct(e.flip.margin)} sub={e.flip.margin < pricingConfig.minProfitMargin ? "below minimum" : "ok"} /><Stat label="ROI on cash" value={pct(e.flip.roi, 0)} sub={`cash in ${usd(e.flip.cashInvested)}`} />
                </div>
              </Section>}
            </div>
          </div>
        </div>
      )}

      {tab === "Score & Flags" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={`Deal score ${e.score.score}/100 · grade ${e.score.grade}`}>
            <ul className="space-y-2">{Object.entries(e.score.factors).map(([f, v]) => { const w = pricingConfig.score.weights[f as keyof typeof pricingConfig.score.weights]; return (
              <li key={f}><div className="flex justify-between text-sm"><span className="capitalize">{f.replace(/([A-Z])/g, " $1")}</span><span className="font-semibold">{v.toFixed(1)} / {w}</span></div><div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(v / w) * 100}%` }} /></div></li>); })}</ul>
            <p className="mt-3 text-[11px] text-faint">Grades: A ≥ 85 · B 70–84 · C 55–69 · D 40–54 · E &lt; 40. An underwriter override needs a logged reason.</p>
          </Section>
          <Section title="Automated flags & hard stops">
            {e.hardStops.length + e.flags.length === 0 ? <p className="text-sm text-good">No flags.</p> : <ul className="space-y-1 text-sm">{e.hardStops.map((h) => <li key={h} className="rounded-md bg-bad/10 px-2 py-1 text-bad">⛔ {h}</li>)}{e.flags.map((f) => <li key={f} className="rounded-md bg-warn/12 px-2 py-1 text-warn">⚠ {f}</li>)}</ul>}
          </Section>
        </div>
      )}

      {tab === "Capital Routing" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Section title="Recommendation">
              <div className="flex items-center gap-2" data-testid="route-rec"><Badge tone={rec.route === "IN_HOUSE" ? "green" : rec.route === "SPLIT" ? "violet" : "amber"}>{rec.route.replace(/_/g, " ")}</Badge><span className="text-sm text-muted-foreground">because: {rec.reasons.join("; ")}</span></div>
              <p className="mt-1 text-[11px] text-faint">First matching rule wins. A human always confirms.</p>
            </Section>
            <Section title="Capital availability">
              <div className="space-y-3">{cap.map((c) => { const used = c.reserved + c.committed + c.deployed + c.unfunded; return (
                <div key={c.source.id}><div className="flex justify-between text-sm"><span className="font-medium">{c.source.name}</span><span className="font-semibold text-good">{k(c.available)} available</span></div>
                  <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-muted">{[[c.deployed, "bg-primary"], [c.unfunded, "bg-primary/35"], [c.committed, "bg-link"], [c.reserved, "bg-warn"]].map(([v, cl], i) => <div key={i} className={cl as string} style={{ width: `${((v as number) / c.source.commitment) * 100}%` }} />)}</div>
                  <div className="mt-0.5 text-[11px] text-faint">commitment {k(c.source.commitment)} · used {k(used)}</div></div>); })}</div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">{([["bg-primary", "deployed"], ["bg-primary/35", "unfunded holdbacks"], ["bg-link", "committed"], ["bg-warn", "reserved"]] as const).map(([cl, l]) => <span key={l} className="inline-flex items-center gap-1"><span className={`size-2 rounded-xs ${cl}`} />{l}</span>)}</div>
            </Section>
            <Section title="Route this deal">
              <div className="grid grid-cols-3 gap-2">{(["in_house", "partner", "split"] as const).map((r) => <button key={r} data-testid={`route-${r}`} onClick={() => setRouteSel(r)} className={`rounded-lg border p-2 text-sm font-semibold ${route === r ? "border-primary bg-active text-foreground" : "border-border"}`}>{r === "in_house" ? "In-house" : r === "partner" ? "Partner" : "Split"}</button>)}</div>
              {route === "in_house" && avail < e.noteAmount && <p className="mt-2 text-xs text-bad">In-house available {usd(avail)} is less than the note amount {usd(e.noteAmount)}.</p>}
              {route === "split" && <div className="mt-3"><label className="label">GT share: {usd(gtShare)} ({pct(gtShare / e.noteAmount, 0)}) · partners: {usd(e.noteAmount - gtShare)}</label><input type="range" className="w-full" min={0} max={e.noteAmount} step={5000} value={gtShare} onChange={(ev) => setSplitAmt(Number(ev.target.value))} /><p className="text-[11px] text-faint">Allocations must total 100% of the note before clear to close. Split participations need securities sign-off.</p></div>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary" data-testid="apply-route" onClick={() => dispatch({ t: "route", dealId: d.id, route, inHouseAmount: gtShare })}>Apply route</button>
                {d.capitalStatus === "reserved" && <button className="btn-ghost" data-testid="commit" onClick={() => dispatch({ t: "commit", dealId: d.id })}>Commit capital</button>}
              </div>
              {d.allocations.length > 0 && <ul className="mt-3 text-sm">{d.allocations.map((a) => <li key={a.sourceId} className="flex justify-between"><span>{a.sourceId.startsWith("partner:") ? s.partners.find((p) => "partner:" + p.id === a.sourceId)?.name : cap.find((c) => c.source.id === a.sourceId)?.source.name}</span><b>{usd(a.amount)}</b></li>)}<li className="flex justify-between border-t pt-1 text-xs text-muted-foreground"><span>Total vs note</span><span>{pct(d.allocations.reduce((x, a) => x + a.amount, 0) / e.noteAmount, 0)}</span></li></ul>}
            </Section>
          </div>
          <div className="space-y-4">
            <Section title="Matched partners (buy box)">
              <ul className="divide-y divide-border">{matches.map(({ p, m }) => (
                <li key={p.id} className="flex items-start gap-2 py-2">
                  <input type="checkbox" className="mt-1" disabled={!p.ndaSigned || m.match === 0 || d.teaserSentTo.includes(p.id)} checked={sel.includes(p.id) || d.teaserSentTo.includes(p.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                  <div className="flex-1"><div className="flex justify-between text-sm"><span className="font-medium">{p.name}</span><span className="font-semibold">{m.match}%</span></div><div className="text-[11px] text-muted-foreground">{!p.ndaSigned ? "NDA not signed: can't receive teasers" : m.reasons.join(" · ")}{d.teaserSentTo.includes(p.id) && " · teaser sent"}</div></div>
                </li>))}</ul>
              <button className="btn-primary mt-2" data-testid="send-teaser" disabled={sel.length === 0} onClick={() => { dispatch({ t: "sendTeaser", dealId: d.id, partnerIds: sel }); setSel([]); }}>Send blind teaser to {sel.length || "…"}</button>
            </Section>
            <Section title="Teaser preview (what partners see)">
              <div className="grid grid-cols-2 gap-2 text-sm"><div>Product: <b>{productLabel[teaser.product]}</b></div><div>Location: <b>{teaser.county}, {teaser.zip3}</b></div><div>Amount: <b>{usd(teaser.noteAmount)}</b></div><div>FICO band: <b>{teaser.ficoBand}</b></div><div>Experience: <b>Tier {teaser.tier}</b></div><div>Lender yield: <b>{teaser.lenderYieldOffered.toFixed(2)}%</b></div></div>
              <p className="mt-2 text-[11px] text-faint">No street address, borrower name or entity name. Photos stripped of metadata.</p>
            </Section>
            <Section title={`Bids received (${bids.length})`}>
              {bids.length === 0 ? <p className="text-sm text-muted-foreground">No bids yet.</p> : <ul className="space-y-2">{bids.map((b) => (
                <li key={b.id} className="rounded-lg border border-border p-3 text-sm" data-testid="bid-row"><div className="flex justify-between"><b>{s.partners.find((p) => p.id === b.partnerId)?.name}</b><Badge tone={b.status === "accepted" ? "green" : b.status === "declined" ? "slate" : "violet"}>{b.status}</Badge></div>
                  <div className="text-muted-foreground">{b.type === "accept_as_offered" ? "Accept as offered" : "Bid"} · {b.pct}% of loan · lender yield {b.lenderRate}% · {b.lenderPoints} pts{b.conditions && ` · ${b.conditions}`}</div>
                  {b.status === "submitted" && <button className="btn-primary mt-2 py-1 text-xs" data-testid="accept-bid" onClick={() => dispatch({ t: "acceptBid", bidId: b.id })}>Accept &amp; issue commitment</button>}</li>))}</ul>}
            </Section>
          </div>
        </div>
      )}

      {tab === "Documents" && (
        <Section title="Documents">
          <ul className="divide-y divide-border">{d.docs.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><div className="text-sm font-medium">{x.name}</div><div className="text-xs text-muted-foreground">{x.category}{x.fileName && ` · ${x.fileName}`}</div></div>
              <div className="flex items-center gap-2"><Badge>{statusLabel(x.status)}</Badge>{(x.status === "uploaded" || x.status === "in_review") && <><button className="btn-ghost py-1 text-xs" onClick={() => dispatch({ t: "docStatus", dealId: d.id, docId: x.id, status: "accepted" })}>Accept</button><button className="btn-ghost py-1 text-xs" onClick={() => dispatch({ t: "docStatus", dealId: d.id, docId: x.id, status: "rejected" })}>Reject</button></>}</div></li>))}</ul>
        </Section>
      )}
    </div>
  );
}
