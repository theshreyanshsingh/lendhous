"use client";
import type { Estimate, Product } from "@/lib/engine";
import { RatioPill, GradeBadge, usd, pct, Stat } from "./ui";

export default function EstimatePanel({ e, product, compact }: { e: Estimate; product: Product; compact?: boolean }) {
  return (
    <div className="glass overflow-hidden" data-testid="estimate-panel">
      <div className={`border-b border-border px-4 py-4 ${e.eligible ? "" : "bg-bad/10"}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Instant term-sheet estimate</p>
          <GradeBadge grade={e.score.grade} score={e.score.score} />
        </div>
        <div className={`mt-2 text-[28px] font-semibold leading-tight tracking-tight ${e.eligible ? "text-foreground" : "text-bad"}`} data-testid="est-loan">{e.eligible ? usd(e.noteAmount) : "Not eligible"}</div>
        <div className={`mt-1 text-xs ${e.eligible ? "text-muted-foreground" : "text-bad"}`}>{e.eligible ? <>max {usd(e.maxLoan)} · binding: <b className="font-semibold text-foreground">{e.binding}</b></> : e.hardStops[0]}</div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Rate (est.)" value={`${e.rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`} sub={`range ${e.rateRange[0]}–${e.rateRange[1]}% + adj.`} />
          <Stat label="Points" value={`${e.pointsPct.toFixed(2)} (${usd(e.points)})`} sub={`range ${e.pointsRange[0]}–${e.pointsRange[1]}`} />
          <Stat label="Cash to close" value={usd(e.cashToClose)} sub={e.cashToClose < 0 ? "cash out to you" : "before credits"} />
          <Stat label={product === "dscr" ? "Monthly P&I" : "Monthly interest"} value={usd(e.monthlyPayment)} sub={product === "dscr" ? "30-yr amortizing" : "interest-only"} />
        </div>
        {product !== "bridge" && product !== "dscr" && (
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <div className="flex justify-between"><span>Initial advance (at closing)</span><b>{usd(e.initialAdvance)}</b></div>
            <div className="flex justify-between"><span>Rehab holdback (released by draws)</span><b>{usd(e.holdback)}</b></div>
            {e.financedReserve > 0 && <div className="flex justify-between"><span>Financed interest reserve</span><b>{usd(e.financedReserve)}</b></div>}
          </div>
        )}
        <div className={`grid gap-2 ${e.ratios.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
          {e.ratios.map((r) => <RatioPill key={r.key} label={r.label} value={r.actual} limit={r.limit} color={r.color} kind={r.kind} isMultiple={r.key === "dscr"} />)}
        </div>
        {e.flip && !compact && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3">
            <Stat label="Est. profit" value={usd(e.flip.profit)} />
            <Stat label="Margin" value={pct(e.flip.margin)} />
            <Stat label="ROI on cash" value={pct(e.flip.roi, 0)} />
          </div>
        )}
        {(e.hardStops.length > 0 || e.flags.length > 0) && (
          <ul className="space-y-1 text-xs">
            {e.hardStops.map((h) => <li key={h} className="rounded-md bg-bad/10 px-2 py-1 text-bad">⛔ {h}</li>)}
            {e.flags.map((f) => <li key={f} className="rounded-md bg-warn/12 px-2 py-1 text-warn">⚠ {f}</li>)}
          </ul>
        )}
        <p className="text-[11px] leading-snug text-faint">Estimate – not a commitment. Placeholder pricing (Tier {e.tier}, {e.location.replace("_", " ")} county). Final terms depend on underwriting, valuation, title and credit.</p>
      </div>
    </div>
  );
}
