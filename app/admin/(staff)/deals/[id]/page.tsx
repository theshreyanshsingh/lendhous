"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useStore, est, inHouseAvailable, capitalSummary } from "@/lib/store";
import { evaluate, recommendRoute, matchPartner, fullBoatReserve, dutchReserve, evenDraws, qualifyingRent, shortTermFactor, type Application } from "@/lib/engine";
import { currentPricing, pricingFor } from "@/lib/pricing-versions";
import { activeWire, maskAccount, wireVerified } from "@/lib/closing";
import { PRE_FUNDING } from "@/lib/loan-exits";
import { canAdvance, nextStage } from "@/lib/loan-stages";
import { SERVICED } from "@/lib/servicing";
import { teaserOf } from "@/lib/teaser";
import { inviteBorrower } from "@/actions/book";
import { ApplicationOnFile } from "@/components/loan/ApplicationOnFile";
import { ApplicationRecord } from "@/components/loan/AdverseAction";
import { CloseApplication } from "@/components/loan/CloseApplication";
import { ClosingPanel } from "@/components/loan/ClosingPanel";
import { OfacPanel } from "@/components/loan/OfacPanel";
import { CreditReview } from "@/components/loan/CreditReview";
import { DocUpload } from "@/components/loan/DocUpload";
import { LoanLedger } from "@/components/loan/LoanLedger";
import { LoanMessages } from "@/components/loan/LoanMessages";
import { PhotoRequests } from "@/components/loan/PhotoRequests";
import { ScopeOfWork } from "@/components/loan/ScopeOfWork";
import { TermSheetBuilder } from "@/components/loan/TermSheetBuilder";
import { ConditionsPanel } from "@/components/loan/ConditionsPanel";
import { LienProtection } from "@/components/loan/LienProtection";
import { InsurancePanel } from "@/components/loan/InsurancePanel";
import { BudgetControls } from "@/components/loan/BudgetControls";
import { InvestorUpdates } from "@/components/loan/InvestorUpdates";
import { INSURED } from "@/lib/insurance";
import { PropertyPhotos } from "@/components/loan/PropertyPhotos";
import { LoanTeam } from "@/components/loan/LoanTeam";
import { closingIn, ratePercent, shortDay } from "@/lib/format";
import { TermSheetCard } from "@/components/loan/TermSheetCard";
import { useServiceDay } from "@/components/loan/use-service-day";
import { Badge, GradeBadge, RatioPill, Section, Stat, usd, pct, k, productLabel, statusLabel, capTone, points, ratioGrid, statGrid } from "@/components/ui";
import { BrokerFee } from "@/components/loan/BrokerFee";
import { ReferralBonus } from "@/components/loan/ReferralBonus";
import { LoanTimeline } from "@/components/loan/LoanTimeline";
import { PropertyPicture } from "@/components/PropertyPicture";
import { Showcase } from "@/components/loan/Showcase";
import { TeamLoanStatements } from "@/components/loan/LoanStatements";
import { ExitPlanCard } from "@/components/loan/ExitPlanCard";

// Closing starts once the term sheet is accepted, and stays as the record of how the money went out.
const CLOSING_TAB = ["term_sheet_accepted", "conditions", "clear_to_close", "closing", "funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off"];
const allTabs = ["Numbers & Ratios", "Credit review", "Score & Flags", "Term sheet", "Conditions", "Capital Routing", "Documents", "Closing", "Messages", "Servicing"] as const;
// Conditions start in underwriting; before that there's nothing to set yet.
const BEFORE_UNDERWRITING = ["submitted", "initial_review"];
type Tab = (typeof allTabs)[number];

export default function DealWorkspace() {
  const { id } = useParams<{ id: string }>(); const { s, dispatch, applyReply, local, viewerName } = useStore();
  const d = s.deals.find((x) => x.id === id);
  const [invite, setInvite] = useState("");
  const [request, setRequest] = useState({ name: "", category: "Property" });
  // Sending a document back says what's still needed, which the borrower sees on it.
  const [sendBack, setSendBack] = useState<{ docId: string; note: string } | null>(null);
  const [tab, setTab] = useState<Tab>("Numbers & Ratios");
  // The work queue links straight to the tab where its item is done (?tab=Documents).
  useEffect(() => { const asked = new URLSearchParams(window.location.search).get("tab"); if (asked && (allTabs as readonly string[]).includes(asked)) setTab(asked as Tab); }, []);
  // Opening a tab from far down the page starts it at its top, just under the tab row, and brings the tab itself into view.
  const openTab = (next: Tab, button: HTMLElement) => {
    setTab(next);
    // Sideways only: scrollIntoView would also move the page to where the pinned row started.
    const row = button.parentElement;
    if (row) row.scrollTo({ left: button.offsetLeft - (row.clientWidth - button.offsetWidth) / 2, behavior: "smooth" });
    const bar = button.closest<HTMLElement>("[data-testid='deal-tabs']");
    const stuck = bar && bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top) + 1;
    if (!bar || !stuck) return;
    // The new tab renders after this click; then put its top just under the row.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const content = bar.nextElementSibling;
      if (content) window.scrollBy({ top: content.getBoundingClientRect().top - bar.getBoundingClientRect().bottom - 12, behavior: "instant" });
    }));
  };
  const today = useServiceDay();
  const [ov, setOv] = useState<Partial<Application>>({});
  const [routeSel, setRouteSel] = useState<"in_house" | "partner" | "split" | null>(null);
  const [splitAmt, setSplitAmt] = useState<number | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const uwApp = useMemo(() => (d ? { ...d.app, ...ov } : null), [d, ov]);
  if (!d || !uwApp) return <div className="glass p-6">Deal not found. <Link href="/admin" className="underline">Back</Link></div>;
  const e = evaluate(uwApp); const orig = est(d.app);
  // The loan's own pricing: its limits and assumptions, not whatever was published since.
  const pricingConfig = pricingFor(d.app.pricingVersion);
  // The servicing tab only means something once there's money out.
  const tabs = allTabs.filter((t) => (t !== "Servicing" || SERVICED.includes(d.status) || d.status === "paid_off") && (t !== "Closing" || CLOSING_TAB.includes(d.status)) && (t !== "Term sheet" || ["underwriting", "term_sheet_issued"].includes(d.status) || Boolean(d.termSheets?.length || d.pricingException)) && (t !== "Conditions" || !BEFORE_UNDERWRITING.includes(d.status) || Boolean(d.conditions?.length)));
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
      <input className="desk-input" inputMode="numeric" value={uwApp[key] || !label.includes("optional") ? Number(uwApp[key] ?? 0).toLocaleString("en-US") : ""} placeholder="Not given" onChange={(ev) => setOv({ ...ov, [key]: Number(ev.target.value.replace(/[^0-9.]/g, "") || 0) })} />
      {ov[key] !== undefined && ov[key] !== d.app[key] && <span className="text-[11px] text-warn">borrower said {Number(d.app[key] ?? 0).toLocaleString()}</span>}
    </label>);
  const holdMonths = pricingConfig.assumptions.holdMonths;
  const stage = nextStage(d, orig, today || undefined);
  const funding = stage?.to === "funded";
  const unlinked = !local && d.borrowerId.startsWith("client-");
  const locked = !["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions"].includes(d.status);
  const broker = s.brokers.find((item) => item.id === d.brokerId);
  // An application still in review that was priced before the latest pricing came out can move onto it; nothing later can.
  const repricable = ["submitted", "initial_review", "underwriting"].includes(d.status) && Boolean(d.app.pricingVersion) && d.app.pricingVersion !== currentPricing().version;
  const repriced = repricable ? evaluate({ ...d.app, pricingVersion: currentPricing().version }) : null;

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-link">← Pipeline</Link>
      <div className="glass p-5">
        <div className="flex items-start gap-3 sm:gap-4">
        <PropertyPicture deal={d} variant="header" />
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]} · source: {d.source.replace("_", " ")}</div>
            <h1 className="text-xl font-normal tracking-tight">{d.address}, {d.city} {d.zip} <span className="font-normal text-faint">({d.app.county})</span></h1>
            <div className="text-sm text-muted-foreground">{d.borrowerName} · {d.entityName} · FICO {d.app.fico} · Tier {e.tier}</div>
            {d.app.repeat && <div className="text-sm text-muted-foreground" data-testid="deal-repeat">{d.app.repeat.pausedBy ? <span className="text-warn">Repeat borrower, pricing paused: a late payment on {d.app.repeat.pausedBy} in the 24 months before {shortDay(d.app.repeat.asOf)}</span> : <>Repeat borrower: {d.app.repeat.loans} LendHous loan{d.app.repeat.loans === 1 ? "" : "s"} paid as agreed ({d.app.repeat.counted.join(", ")}) when it was submitted</>}</div>}
            {broker && <div className="text-sm text-muted-foreground" data-testid="deal-broker">Broker: {broker.name} · {points(d.brokerPoints)} ({usd((orig.noteAmount * (d.brokerPoints ?? 0)) / 100)})</div>}
            {PRE_FUNDING.includes(d.status) && <div className="mt-1 text-sm text-muted-foreground" data-testid="loan-facts">Target closing <b className="font-medium text-foreground">{shortDay(d.closingDate)}</b>{today && <> · {closingIn(d.closingDate, today)}</>}</div>}
            <Showcase deal={d} side="team" />
            <div className="mt-2"><LoanTeam deal={d} /></div></div>
          <div className="flex flex-wrap items-center gap-2"><GradeBadge grade={e.score.grade} score={e.score.score} /><Badge tone="blue">{statusLabel(d.status)}</Badge><Badge tone={capTone(d.capitalStatus)}>Capital: {statusLabel(d.capitalStatus).toLowerCase()}</Badge></div>
        </div>
        </div>
        <LoanTimeline deal={d} side="team" />
        {d.contractorIsGtAffiliate && <div className="mt-3 rounded-lg bg-bad/10 p-3 text-sm text-bad" data-testid="coi-banner"><b>Conflict of interest:</b> LendHous&apos;s affiliated construction company is the contractor. Draw inspections must be by an independent third party, a second approver outside the construction company is required, and partners must be told.</div>}
        {unlinked && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-[2px] border border-border p-3" data-testid="invite-borrower">
            <label className="block min-w-0 flex-1 basis-56"><span className="label">{d.borrowerName} has no portal account. Invite them to follow this loan:</span><input type="email" data-testid="invite-email" className="desk-input" placeholder="Their email" value={invite} onChange={(ev) => setInvite(ev.target.value)} /></label>
            <button className="btn-ghost" data-testid="send-invite" disabled={!invite.trim()} onClick={async () => { applyReply(await inviteBorrower(d.id, invite)); setInvite(""); }}>Send invitation</button>
          </div>
        )}
        {stage && (
          <div className="mt-4 rounded-[2px] border border-border p-3" data-testid="stage-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm" data-testid="next-step"><span className="text-muted-foreground">Next:</span> <b>{stage.next}</b></div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {funding && wireVerified(d) && !d.fundingApprovers?.includes(viewerName) && (d.fundingApprovers?.length ?? 0) < 2 && <button className="btn-ghost flex-1 sm:flex-none" data-testid="approve-funding" onClick={() => dispatch({ t: "approveFunding", dealId: d.id, by: viewerName })}>Approve funding</button>}
                {stage.to === "term_sheet_issued" ? <button className="btn-primary flex-1 sm:flex-none" data-testid="build-term-sheet" onClick={() => setTab("Term sheet")}>Build the term sheet</button>
                  : !stage.borrowerStep && <button className="btn-primary flex-1 sm:flex-none" data-testid="advance-loan" disabled={!canAdvance(stage)} onClick={() => dispatch({ t: "advanceLoan", dealId: d.id })}>{stage.action}</button>}
              </div>
            </div>
            {funding && wireVerified(d) && <p className="mt-1 text-xs text-muted-foreground" data-testid="funding-wire">Funds go to {activeWire(d)!.beneficiary}, {activeWire(d)!.bankName}, account {maskAccount(activeWire(d)!.account)}, verified by call-back.</p>}
            {funding && d.fundingApprovers?.length ? <p className="mt-1 text-xs text-muted-foreground" data-testid="funding-approvers">Approved by {d.fundingApprovers.join(" and ")}.</p> : null}
            {stage.blockers.length > 0 && <div className="mt-2 text-xs" data-testid="stage-blockers"><p className="text-muted-foreground">Before that:</p><ul className="mt-1 space-y-0.5 text-warn">{stage.blockers.map((blocker) => <li key={blocker} className="flex gap-1.5"><span aria-hidden="true">○</span><span>{blocker}</span></li>)}</ul></div>}
            {PRE_FUNDING.includes(d.status) && <div className="mt-3 border-t border-border pt-3"><CloseApplication deal={d} side="team" /></div>}
          </div>
        )}
        {d.closure && <CloseApplication deal={d} side="team" />}
        {repriced && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-border p-3 text-sm" data-testid="pricing-outdated">
            <span className="min-w-0 flex-1 basis-60">Priced on {d.app.pricingVersion}. On the current pricing ({currentPricing().version}) it would be {repriced.rate.toFixed(3)}% and {repriced.pointsPct} points on {usd(repriced.noteAmount)}{repriced.eligible ? "" : `, and not eligible: ${repriced.hardStops[0]}`}.</span>
            <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="reprice-loan" disabled={!repriced.eligible} onClick={() => dispatch({ t: "repriceLoan", dealId: d.id, by: viewerName })}>Reprice on current pricing</button>
          </div>
        )}
      </div>
      {/* One row that stays under the top bar while the tab scrolls; on a phone it slides sideways, the open tab in view. */}
      <div className="sticky top-14 z-20 -mx-4 -mt-1 border-b border-border bg-background/95 px-4 backdrop-blur md:-mx-[22px] md:px-[22px] lg:top-0" data-testid="deal-tabs">
        <div role="tablist" aria-label="Loan" data-scroll-row className="flex gap-1 overflow-x-auto [scrollbar-width:none] max-xl:snap-x [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`tab-${t}`} onClick={(event) => openTab(t, event.currentTarget)} className={`min-h-11 shrink-0 snap-start border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>)}
        </div>
      </div>

      {tab === "Numbers & Ratios" && (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Section title="Underwritten inputs" right={Object.keys(ov).length > 0 ? <span className="flex items-center gap-3">{!locked && <button className="text-xs font-semibold text-link underline" data-testid="save-numbers" onClick={async () => { if (await dispatch({ t: "updateDealNumbers", dealId: d.id, changes: ov })) setOv({}); }}>Save</button>}<button className="text-xs text-link underline" onClick={() => setOv({})}>reset</button></span> : undefined}>
            <div className="space-y-3">
              {num("purchasePrice", d.app.product === "ground_up" ? "Land value" : "Purchase / as-is")}
              {num("appraisedAsIs", "Appraised as-is (optional)")}
              {d.app.product !== "bridge" && d.app.product !== "dscr" && <>{num("rehab", "Rehab / construction budget")}{num("arv", "ARV (selected valuation)")}</>}
              {d.app.product === "dscr" && uwApp && <>
                <label className="block"><span className="label">How it&apos;s rented</span><select className="desk-input" data-testid="uw-rental-type" value={uwApp.rentalType ?? "long_term"} onChange={(ev) => setOv({ ...ov, rentalType: ev.target.value as "long_term" | "short_term", ...(ev.target.value === "short_term" && !uwApp.strIncomeSource ? { strIncomeSource: "payouts" as const } : {}) })}><option value="long_term">On a lease</option><option value="short_term">By the night (Airbnb, VRBO)</option></select></label>
                {uwApp.rentalType === "short_term" ? <>
                  <label className="block"><span className="label">Income from</span><select className="desk-input" data-testid="uw-str-source" value={uwApp.strIncomeSource ?? "payouts"} onChange={(ev) => setOv({ ...ov, strIncomeSource: ev.target.value as "payouts" | "projection" })}><option value="payouts">12 months of payouts</option><option value="projection">A projection</option></select></label>
                  {num("strAnnualIncome", uwApp.strIncomeSource === "projection" ? "Projected income / yr" : "Payouts, last 12 months")}
                  <p className="text-[11px] text-faint" data-testid="uw-str-rent">Counted at {Math.round(shortTermFactor(uwApp, pricingConfig) * 100)}%: {usd(qualifyingRent(uwApp, pricingConfig))} a month for the DSCR.</p>
                </> : num("monthlyRent", "Qualifying rent / mo")}
                {num("taxesAnnual", "Taxes / yr")}{num("insuranceAnnual", "Insurance / yr")}
              </>}
              {num("fico", "FICO (pulled)")}{num("verifiedDeals", "Verified deals (36 mo)")}{num("liquidity", "Verified liquidity")}
              <p className="text-[11px] text-faint">{locked ? "Edits are a live what-if. These numbers are locked once a loan clears to close." : "Edits are a live what-if until you save them."}</p>
            </div>
          </Section>
          <div className="min-w-0 space-y-4">
            <Section title="Ratios vs. matrix limits">
              <div className={ratioGrid(e.ratios.length)}>{e.ratios.map((r) => <RatioPill key={r.key} label={r.label} value={r.actual} limit={r.limit} color={r.color} kind={r.kind} isMultiple={r.key === "dscr"} />)}</div>
              {d.app.product !== "bridge" && d.app.product !== "dscr" && <div className="mt-2 text-xs text-muted-foreground">Total loan ÷ as-is = {pct(e.noteAmount / uwApp.purchasePrice)} (normal for rehab loans; the holdback is released by draws).</div>}
            </Section>
            <Section title="Loan sizing">
              <div className={statGrid}>
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
                  <Stat label="Rate" value={ratePercent(e.rate)} sub={`matrix ${e.rateRange.join("–")}% · pricing ${d.app.pricingVersion ?? currentPricing().version}`} />
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
          <div className="min-w-0 space-y-4">
            <BrokerFee deal={d} />
            <ReferralBonus deal={d} />
            <Section title="Recommendation">
              <div className="flex flex-wrap items-center gap-2" data-testid="route-rec"><Badge tone={rec.route === "IN_HOUSE" ? "green" : rec.route === "SPLIT" ? "violet" : "amber"}>{rec.route.replace(/_/g, " ")}</Badge><span className="text-sm text-muted-foreground">because: {rec.reasons.join("; ")}</span></div>
              <p className="mt-1 text-[11px] text-faint">First matching rule wins. A human always confirms.</p>
            </Section>
            <Section title="Capital availability">
              <div className="space-y-3">{cap.map((c) => { const used = c.reserved + c.committed + c.deployed + c.unfunded; return (
                <div key={c.source.id}><div className="flex flex-wrap justify-between gap-x-3 text-sm"><span className="font-medium">{c.source.name}</span><span className="font-semibold text-good">{k(c.available)} available</span></div>
                  <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-muted">{[[c.deployed, "bg-primary"], [c.unfunded, "bg-primary/35"], [c.committed, "bg-link"], [c.reserved, "bg-warn"]].map(([v, cl], i) => <div key={i} className={cl as string} style={{ width: `${((v as number) / c.source.commitment) * 100}%` }} />)}</div>
                  <div className="mt-0.5 text-[11px] text-faint">commitment {k(c.source.commitment)} · used {k(used)}</div></div>); })}</div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">{([["bg-primary", "deployed"], ["bg-primary/35", "unfunded holdbacks"], ["bg-link", "committed"], ["bg-warn", "reserved"]] as const).map(([cl, l]) => <span key={l} className="inline-flex items-center gap-1"><span className={`size-2 rounded-xs ${cl}`} />{l}</span>)}</div>
            </Section>
            <Section title="Route this deal">
              <div className="grid grid-cols-3 gap-2">{(["in_house", "partner", "split"] as const).map((r) => <button key={r} data-testid={`route-${r}`} onClick={() => setRouteSel(r)} className={`rounded-lg border p-2 text-sm font-semibold ${route === r ? "border-primary bg-active text-foreground" : "border-border"}`}>{r === "in_house" ? "In-house" : r === "partner" ? "Partner" : "Split"}</button>)}</div>
              {route === "in_house" && avail < e.noteAmount && <p className="mt-2 text-xs text-bad">In-house available {usd(avail)} is less than the note amount {usd(e.noteAmount)}.</p>}
              {route === "split" && <div className="mt-3"><label className="label">In-house share: {usd(gtShare)} ({pct(gtShare / e.noteAmount, 0)}) · partners: {usd(e.noteAmount - gtShare)}</label><input type="range" className="w-full" min={0} max={e.noteAmount} step={5000} value={gtShare} onChange={(ev) => setSplitAmt(Number(ev.target.value))} /><p className="text-[11px] text-faint">Allocations must total 100% of the note before clear to close. Split participations need securities sign-off.</p></div>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary" data-testid="apply-route" onClick={() => dispatch({ t: "route", dealId: d.id, route, inHouseAmount: gtShare })}>Apply route</button>
                {d.capitalStatus === "reserved" && <button className="btn-ghost" data-testid="commit" onClick={() => dispatch({ t: "commit", dealId: d.id })}>Commit capital</button>}
              </div>
              {d.allocations.length > 0 && <ul className="mt-3 text-sm">{d.allocations.map((a) => <li key={a.sourceId} className="flex flex-wrap justify-between gap-x-3"><span>{a.sourceId.startsWith("partner:") ? s.partners.find((p) => "partner:" + p.id === a.sourceId)?.name : a.sourceId.startsWith("buyer:") ? `Sold to ${s.buyers.find((b) => "buyer:" + b.id === a.sourceId)?.name}` : cap.find((c) => c.source.id === a.sourceId)?.source.name}</span><b>{usd(a.amount)}</b></li>)}<li className="flex justify-between border-t pt-1 text-xs text-muted-foreground"><span>Total vs note</span><span>{pct(d.allocations.reduce((x, a) => x + a.amount, 0) / e.noteAmount, 0)}</span></li></ul>}
            </Section>
          </div>
          <div className="min-w-0 space-y-4">
            <Section title="Matched partners (buy box)">
              <ul className="divide-y divide-border">{matches.map(({ p, m }) => (
                <li key={p.id} className="flex items-start gap-2 py-2">
                  <input type="checkbox" className="mt-1" disabled={!p.ndaSigned || m.match === 0 || d.teaserSentTo.includes(p.id)} checked={sel.includes(p.id) || d.teaserSentTo.includes(p.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                  <div className="min-w-0 flex-1"><div className="flex justify-between gap-2 text-sm"><span className="min-w-0 font-medium">{p.name}</span><span className="font-semibold">{m.match}%</span></div><div className="text-[11px] text-muted-foreground">{!p.ndaSigned ? "NDA not signed: can't receive teasers" : m.reasons.join(" · ")}{d.teaserSentTo.includes(p.id) && " · teaser sent"}</div></div>
                </li>))}</ul>
              <button className="btn-primary mt-2" data-testid="send-teaser" disabled={sel.length === 0} onClick={() => { dispatch({ t: "sendTeaser", dealId: d.id, partnerIds: sel }); setSel([]); }}>Send blind teaser to {sel.length || "…"}</button>
            </Section>
            <Section title="Teaser preview (what partners see)">
              <div className="grid grid-cols-2 gap-2 text-sm"><div>Product: <b>{productLabel[teaser.product]}</b></div><div>Location: <b>{teaser.county}, {teaser.zip3}</b></div><div>Amount: <b>{usd(teaser.noteAmount)}</b></div><div>FICO band: <b>{teaser.ficoBand}</b></div><div>Experience: <b>Tier {teaser.tier}</b></div><div>Lender yield: <b>{teaser.lenderYieldOffered.toFixed(2)}%</b></div></div>
              <p className="mt-2 text-[11px] text-faint">No street address, borrower name or entity name. Photos stripped of metadata.</p>
            </Section>
            <Section title={`Bids received (${bids.length})`}>
              {bids.length === 0 ? <p className="text-sm text-muted-foreground">No bids yet.</p> : <ul className="space-y-2">{bids.map((b) => (
                <li key={b.id} className="rounded-lg border border-border p-3 text-sm" data-testid="bid-row"><div className="flex flex-wrap justify-between gap-2"><b className="min-w-0">{s.partners.find((p) => p.id === b.partnerId)?.name}</b><Badge tone={b.status === "accepted" ? "green" : b.status === "declined" ? "slate" : "violet"}>{b.status}</Badge></div>
                  <div className="text-muted-foreground">{b.type === "accept_as_offered" ? "Accept as offered" : "Bid"} · {b.pct}% of loan · lender yield {b.lenderRate}% · {b.lenderPoints} pts{b.conditions && ` · ${b.conditions}`}</div>
                  {b.status === "submitted" && <button className="btn-primary mt-2 py-1 text-xs" data-testid="accept-bid" onClick={() => dispatch({ t: "acceptBid", bidId: b.id })}>Accept &amp; issue commitment</button>}</li>))}</ul>}
            </Section>
          </div>
        </div>
      )}

      {tab === "Term sheet" && <TermSheetBuilder deal={d} />}
      {tab === "Conditions" && <ConditionsPanel deal={d} />}
      {tab === "Credit review" && <div className="space-y-4"><ApplicationRecord deal={d} /><ApplicationOnFile deal={d} /><OfacPanel deal={d} /><CreditReview deal={d} /></div>}
      {tab === "Closing" && <div className="space-y-4"><ClosingPanel deal={d} />{INSURED.includes(d.status) && <InsurancePanel deal={d} />}{(d.app.product === "fix_flip" || d.app.product === "ground_up" || d.lienFile) && <LienProtection deal={d} />}<OfacPanel deal={d} /></div>}
      {tab === "Servicing" && (SERVICED.includes(d.status) || d.status === "paid_off") && <LoanLedger deal={d} />}
      {tab === "Servicing" && SERVICED.includes(d.status) && <BudgetControls deal={d} side="team" />}
      {tab === "Servicing" && (SERVICED.includes(d.status) || d.status === "paid_off") && <InvestorUpdates deal={d} />}
      {tab === "Servicing" && SERVICED.includes(d.status) && <InsurancePanel deal={d} />}
      {tab === "Servicing" && SERVICED.includes(d.status) && <ExitPlanCard deal={d} side="team" />}
      {tab === "Servicing" && (SERVICED.includes(d.status) || d.status === "paid_off") && <TeamLoanStatements deal={d} />}

      {tab === "Messages" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <LoanMessages dealId={d.id} side="team" hint="Nothing yet. The borrower and their broker see this thread." />
          <LoanMessages dealId={d.id} side="internal" title="Team notes" hint="Only your team sees these." />
        </div>
      )}

      {tab === "Documents" && (<div className="space-y-4">
        <PropertyPhotos deal={d} side="team" />
        <TermSheetCard deal={d} canSign={false} />
        <ScopeOfWork deal={d} editable={false} />
        {(d.scope?.length ?? 0) > 0 && <Section title="Site photos"><PhotoRequests deal={d} /></Section>}
        <Section title="Documents">
          <ul className="divide-y divide-border">{d.docs.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0"><div className="text-sm font-medium">{x.name}{x.addedBy === "borrower" && <span className="ml-2 text-xs font-normal text-link">added by the borrower</span>}</div>{x.status === "rejected" && x.teamNote && <div className="text-xs text-bad">Sent back: {x.teamNote}</div>}<div className="text-xs text-muted-foreground">{x.category}{x.fileName && !x.documentId && ` · ${x.fileName}`}{x.documentId && <> · <a className="text-link underline underline-offset-2" href={`/api/documents/${x.documentId}`} data-testid="doc-file">{x.fileName}</a></>}{x.carriedFrom && <> · <span className="text-good" data-testid="doc-carried">carried over from {x.carriedFrom}</span> <button type="button" className="text-link underline underline-offset-2" data-testid="doc-ask-again" onClick={() => dispatch({ t: "docStatus", dealId: d.id, docId: x.id, status: "requested" })}>ask again</button></>}</div></div>
              <div className="flex flex-wrap items-center gap-2"><Badge>{statusLabel(x.status)}</Badge><DocUpload dealId={d.id} doc={x} />{(x.status === "uploaded" || x.status === "in_review") && <><button className="btn-ghost py-1 text-xs" onClick={() => dispatch({ t: "docStatus", dealId: d.id, docId: x.id, status: "accepted" })}>Accept</button><button className="btn-ghost py-1 text-xs" data-testid={`send-back-${x.id}`} onClick={() => setSendBack({ docId: x.id, note: "" })}>Send back</button></>}{x.status === "requested" && <button className="btn-ghost py-1 text-xs" data-testid={`waive-${x.id}`} onClick={() => dispatch({ t: "docStatus", dealId: d.id, docId: x.id, status: "waived" })}>Waive</button>}</div>{sendBack?.docId === x.id && (
                <div className="mt-2 flex w-full flex-wrap items-end gap-2" data-testid="send-back-form">
                  <label className="block min-w-0 flex-1 basis-56"><span className="label">What the borrower still needs to send (they see this)</span><input className="desk-input" data-testid="send-back-note" maxLength={300} placeholder="e.g. All pages of the October statement" value={sendBack.note} onChange={(event) => setSendBack({ ...sendBack, note: event.target.value })} /></label>
                  <button className="btn-primary h-9! px-3! text-xs!" data-testid="send-back-confirm" onClick={async () => { if (await dispatch({ t: "docStatus", dealId: d.id, docId: x.id, status: "rejected", note: sendBack.note })) setSendBack(null); }}>Send back</button>
                  <button className="btn-ghost h-9! px-3! text-xs!" onClick={() => setSendBack(null)}>Cancel</button>
                </div>
              )}</li>))}</ul>
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3" data-testid="request-doc">
            <label className="block min-w-0 flex-1 basis-48"><span className="label">Ask for another document</span><input data-testid="request-doc-name" className="desk-input" placeholder="e.g. Updated insurance binder" value={request.name} onChange={(ev) => setRequest({ ...request, name: ev.target.value })} /></label>
            <label className="block"><span className="label">Category</span><select className="desk-input w-auto!" value={request.category} onChange={(ev) => setRequest({ ...request, category: ev.target.value })}>{["Identity", "Entity", "Property", "Liquidity", "Closing", "Experience"].map((category) => <option key={category}>{category}</option>)}</select></label>
            <button className="btn-ghost" data-testid="request-doc-send" disabled={!request.name.trim()} onClick={async () => { if (await dispatch({ t: "addDocRequest", dealId: d.id, name: request.name.trim(), category: request.category })) setRequest({ ...request, name: "" }); }}>Ask</button>
          </div>
        </Section>
      </div>)}
    </div>
  );
}
