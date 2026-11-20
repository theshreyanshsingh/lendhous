"use client";
import { Badge, Section } from "@/components/ui";
import { budgetReview, contractorRecord, VERDICT_WORDS } from "@/lib/budget-review";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const TONE = { bad: "text-bad", warn: "text-warn", note: "text-muted-foreground" } as const;
const BADGE = { feasible: "green", tight: "amber", short: "rose" } as const;

/**
 * The budget before closing (rank 20): each line against what it usually is on LendHous's funded loans in the county, lines
 * too vague to inspect, whether the lines add up, and room left against the after-repair value. The contractor's other
 * loans with LendHous show beside it.
 */
export function BudgetCheck({ deal }: { deal: Deal }) {
  const { s } = useStore();
  if (!deal.scope?.length) return null;
  const review = budgetReview(deal, s.deals);
  const record = contractorRecord(deal, s.deals, s.draws);
  return (
    <Section title="Budget and contractor check" right={<Badge tone={BADGE[review.verdict]}>{VERDICT_WORDS[review.verdict]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="budget-check">
        <p className="text-xs text-muted-foreground" data-testid="budget-spread">{Math.round(review.spread * 100)}% of the after-repair value is left after the purchase and the work. {review.where ? `Lines compared with ${review.peers} funded loans in ${review.where}.` : ""}</p>
        {review.findings.length === 0 ? <p className="text-xs text-good">Nothing stands out in the budget.</p> : <ul className="space-y-1 text-xs" data-testid="budget-findings">{review.findings.map((finding) => <li key={finding.text} className={TONE[finding.level]}>{finding.text}</li>)}</ul>}
        {review.ranges.size > 0 && (
          <table className="stack-table w-full text-xs" data-testid="budget-lines">
            <thead><tr><th>Line</th><th className="text-right">Budget</th><th className="text-right">Share</th><th className="text-right">Usual here</th></tr></thead>
            <tbody className="divide-y divide-border">
              {(deal.scope ?? []).filter((line) => line.budget > 0).map((line) => {
                const total = (deal.scope ?? []).filter((item) => item.id !== "contingency").reduce((sum, item) => sum + item.budget, 0);
                const range = review.ranges.get(line.id);
                return <tr key={line.id}><td>{line.division}</td><td data-label="Budget" className="text-right tabular-nums">${line.budget.toLocaleString("en-US")}</td><td data-label="Share" className="text-right tabular-nums">{line.id === "contingency" ? "–" : `${Math.round((line.budget / total) * 100)}%`}</td><td data-label="Usual here" className="text-right tabular-nums">{range ? `${Math.round(range.low * 100)}–${Math.round(range.high * 100)}%` : "–"}</td></tr>;
              })}
            </tbody>
          </table>
        )}
        <div className="border-t border-border pt-3 text-xs" data-testid="contractor-record">
          {!record ? <p className="text-muted-foreground">Add the contractor on the Closing tab to see its record with LendHous.</p>
            : record.loans === 0 ? <p className="text-muted-foreground">{deal.lienFile?.contractor} is new to LendHous: no other loans with it yet. Check its license and insurance before the first draw.</p>
            : <p className={record.troubled || record.ahead ? "text-warn" : ""}>{deal.lienFile?.contractor} is on {record.loans} other LendHous loan{record.loans === 1 ? "" : "s"} ({record.loanNumbers.join(", ")}): {record.withOverruns} ran over budget, {record.ahead} paid ahead of the work, {record.troubled} late or in default.</p>}
        </div>
      </div>
    </Section>
  );
}
