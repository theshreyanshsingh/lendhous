"use client";
import { useState } from "react";
import { Badge, Section, shortDate } from "@/components/ui";
import { INVESTOR_STATUS, investorStatus, STATUS_TONE, updateProblem, workoutProblem } from "@/lib/investor-updates";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/**
 * What the loan's partners and buyers see of how it's going (lib/investor-updates.ts): its status in plain words, the
 * team's updates, newest first, and a workout the team declares or ends. They're emailed each one; the borrower never is.
 */
export function InvestorUpdates({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const status = investorStatus(deal);
  const updates = [...(deal.investorUpdates ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const holders = deal.allocations.some((item) => item.sourceId.startsWith("partner:") || item.sourceId.startsWith("buyer:"));
  const workoutRefusal = workoutProblem(deal, !deal.workout, note);
  return (
    <Section title="For the loan's investors" right={<Badge tone={STATUS_TONE[status]}>{INVESTOR_STATUS[status]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="investor-updates">
        <p className="text-muted-foreground">{holders ? "Partners and buyers who hold this loan see its status and these updates on their portfolio, and are emailed each one." : "No partner or buyer holds this loan; updates stay here until one does."} The borrower and broker never see them.</p>
        {deal.workout && <p className="rounded-md bg-violet-500/10 p-2" data-testid="workout-note">In a workout since {deal.workout.since}: {deal.workout.note}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-64"><span className="label">An update for them</span><textarea className="desk-input min-h-16" maxLength={2000} data-testid="investor-update-text" placeholder="Work is 60% done; the kitchen goes in next month. Listing in March." value={text} onChange={(event) => setText(event.target.value)} /></label>
          <button type="button" className="btn-primary" data-testid="post-investor-update" disabled={Boolean(updateProblem(deal, text))} onClick={async () => { if (await dispatch({ t: "postInvestorUpdate", dealId: deal.id, updateId: `iu${Date.now().toString(36)}`, text, by: viewerName })) setText(""); }}>Post it</button>
        </div>
        {(deal.workout || ["servicing_delinquent", "matured", "default"].includes(deal.status)) && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="block min-w-0 flex-1 basis-64"><span className="label">{deal.workout ? "How the workout ended" : "Declare a workout: what's agreed"}</span><input className="desk-input" maxLength={1000} data-testid="workout-note-input" value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="button" className="btn-ghost" data-testid="set-workout" disabled={Boolean(workoutRefusal)} title={workoutRefusal ?? undefined} onClick={async () => { if (await dispatch({ t: "setWorkout", dealId: deal.id, on: !deal.workout, note, by: viewerName })) setNote(""); }}>{deal.workout ? "End the workout" : "Declare a workout"}</button>
          </div>
        )}
        {updates.length > 0 && <ul className="divide-y divide-border border-t border-border">{updates.map((item) => <li key={item.id} className="py-2" data-testid="investor-update"><p>{item.text}</p><p className="text-xs text-muted-foreground">{item.by} · {shortDate(item.at)}</p></li>)}</ul>}
      </div>
    </Section>
  );
}
