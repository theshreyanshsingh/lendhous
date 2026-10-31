"use client";
import { useState } from "react";
import { scopeError, scopeTotal } from "@/lib/draws";
import type { Deal } from "@/lib/mockData";
import { est, useStore } from "@/lib/store";
import { Badge, Section, usd } from "@/components/ui";

/** The itemized rehab budget. It can change until the loan clears to close; after that it's what draws are paid against. */
export function ScopeOfWork({ deal, editable }: { deal: Deal; editable: boolean }) {
  const { dispatch } = useStore();
  const budget = est(deal.app).holdback;
  const [lines, setLines] = useState(deal.scope ?? []);
  const [summary, setSummary] = useState(deal.scopeSummary ?? "");
  const [saved, setSaved] = useState(false);
  if (!deal.scope?.length) return null;
  const sow = deal.docs.find((doc) => doc.id === "sow");
  const open = editable && !["clear_to_close", "closing", "funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off"].includes(deal.status);
  const error = scopeError(lines, budget);
  const released = lines.reduce((sum, line) => sum + line.released, 0);
  return (
    <Section title="Scope of work" right={sow?.status === "accepted" ? <Badge tone="green">Approved</Badge> : sow?.status === "in_review" ? <Badge tone="blue">In review</Badge> : undefined}>
      {open && <p className="mb-3 text-sm text-muted-foreground">Split your {usd(budget)} budget by type of work. Draws are paid against these lines, so don&apos;t list the same work twice.</p>}
      <ul className="divide-y divide-border" data-testid="scope-lines">
        {lines.map((line, index) => (
          <li key={line.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-40">{line.division}{!open && <small className="block text-xs text-muted-foreground">{usd(line.released)} released · {usd(line.budget - line.released)} left</small>}</span>
            {open ? (
              <input aria-label={`Budget for ${line.division}`} data-testid={`scope-${line.id}`} className="desk-input w-32!" inputMode="numeric" value={line.budget.toLocaleString("en-US")} onChange={(event) => { setSaved(false); setLines(lines.map((item, at) => (at === index ? { ...item, budget: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 } : item))); }} />
            ) : <b>{usd(line.budget)}</b>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-sm font-semibold"><span>Total</span><span data-testid="scope-total">{usd(scopeTotal(lines))}{!open && released > 0 ? ` · ${usd(released)} released` : ""}</span></div>
      {open && (
        <div className="mt-3 space-y-3">
          <label className="block"><span className="label">Project summary</span><textarea data-testid="scope-summary" rows={3} className="desk-input h-auto! py-2" placeholder="The home's condition today and the work you plan. Mention any added square footage or layout changes." value={summary} onChange={(event) => { setSaved(false); setSummary(event.target.value); }} /></label>
          {error && <p role="alert" className="text-sm text-bad" data-testid="scope-error">{error}</p>}
          {saved && <p role="status" className="text-sm text-good" data-testid="scope-saved">Sent to your team for review.</p>}
          <button className="btn-primary w-full sm:w-auto" data-testid="save-scope" disabled={Boolean(error)} onClick={() => { dispatch({ t: "saveScope", dealId: deal.id, scope: lines, summary }); setSaved(true); }}>Submit scope of work</button>
        </div>
      )}
    </Section>
  );
}
