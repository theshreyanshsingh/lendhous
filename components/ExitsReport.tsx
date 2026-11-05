"use client";
import { Section, Stat, statGrid } from "@/components/ui";
import { EXIT_CHOICES, exitReport, type ExitChoice } from "@/lib/exit-plans";
import type { Period } from "@/lib/reports";
import { useStore } from "@/lib/store";

/** How loans are ending: the plans borrowers gave in the period, refinances LendHous kept, and extensions signed. */
export function ExitsReport({ period }: { period: Period }) {
  const { s } = useStore();
  const report = exitReport(s, period);
  const given = Object.values(report.mix).reduce((sum, count) => sum + count, 0);
  return (
    <Section title="How loans are ending">
      <div className={statGrid} data-testid="exits-report">
        <Stat label="Coming due in 4 months" value={report.comingDue} sub="open short-term loans" />
        <Stat label="Refinanced with LendHous" value={report.refinancedHere} sub="rental loans funded in the period" />
        <Stat label="Extensions signed" value={report.extensions} />
        <Stat label="Exit plans given" value={given} sub="by borrowers in the period" />
      </div>
      {given > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="exit-mix">
          {(Object.keys(EXIT_CHOICES) as ExitChoice[]).filter((key) => report.mix[key]).map((key) => <li key={key}><span className="text-muted-foreground">{EXIT_CHOICES[key]}:</span> <b className="tabular-nums">{report.mix[key]}</b></li>)}
        </ul>
      )}
    </Section>
  );
}
