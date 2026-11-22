"use client";
import { useState } from "react";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Section, Stat, usd } from "@/components/ui";
import { drawPlan, DRAW_CHOICES } from "@/lib/draw-planner";

const days = (count: number) => `${count} business day${count === 1 ? "" : "s"}`;

/**
 * Planning the draws (docs/feature-ideas-2026-11-22.md, rank 8). Each draw pays back work already done, so the borrower
 * carries a stage at a time: this shows how much, for how long, and what the draw fees add up to.
 */
export function DrawPlanner({ deal }: { deal: Deal }) {
  const { targets } = useStore();
  const [count, setCount] = useState(4);
  const plan = drawPlan(deal, count, targets);
  if (!plan || !["fix_flip", "ground_up"].includes(deal.app.product)) return null;
  return (
    <Section title="Planning your draws">
      <div className="space-y-3 text-sm" data-testid="draw-planner">
        <p className="text-muted-foreground">Draws pay you back for work that&apos;s done, so you pay for each stage first. Fewer, bigger draws mean less in fees but more of your own cash out at a time.</p>
        <label className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Split the {usd(plan.left)} {deal.disbursedDraws ? "left to draw" : "rehab budget"} into</span>
          <select className="desk-input w-auto!" data-testid="draw-count" value={count} onChange={(event) => setCount(Number(event.target.value))}>{DRAW_CHOICES.map((choice) => <option key={choice} value={choice}>{choice} draws</option>)}</select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Each stage, paid by you first" value={usd(plan.perDraw)} sub="about, before its draw pays it back" />
          <Stat label="Back to you" value={plan.days.desk ? `${plan.days.desk} to ${plan.days.inspector} business days` : days(plan.days.inspector)} sub={plan.days.desk ? "a photo review, or an inspector's visit" : "with an inspector's visit"} />
          <Stat label="Draw fees in all" value={usd(plan.fees)} sub={`${count} draws`} />
          {plan.toStart !== undefined && <Stat label="To start" value={usd(plan.toStart)} sub="cash to close plus the first stage" />}
        </div>
      </div>
    </Section>
  );
}
