"use client";
import { Section, usd } from "@/components/ui";
import { concentration, CONCENTRATION_LIMITS, DIMENSION, type Dimension } from "@/lib/risk";
import { useStore } from "@/lib/store";

/** The funded book by borrower, county, loan type and flood zone, against the limits (lib/risk.ts). */
export function ConcentrationReport() {
  const { s } = useStore();
  return (
    <Section title="Concentration">
      <div className="grid gap-4 md:grid-cols-2" data-testid="concentration-report">
        {(Object.keys(CONCENTRATION_LIMITS) as Dimension[]).map((dimension) => (
          <div key={dimension} className="min-w-0">
            <p className="text-sm font-medium">{DIMENSION[dimension]} <span className="text-xs font-normal text-muted-foreground">limit {Math.round(CONCENTRATION_LIMITS[dimension] * 100)}% of the funded book</span></p>
            <ul className="mt-1 space-y-1 text-sm">{concentration(s.deals, dimension).slice(0, 5).map((row) => (
              <li key={row.name} className="flex justify-between gap-2" data-testid="concentration-row"><span className="min-w-0 truncate">{row.name}</span><span className={`shrink-0 tabular-nums ${row.over ? "font-medium text-bad" : ""}`}>{usd(row.amount)} · {Math.round(row.share * 100)}%{row.over ? " over" : ""}</span></li>
            ))}</ul>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Funded loans at today&apos;s balance. The limits are PLACEHOLDER until GT sets them; a term sheet that would go over one says so before it&apos;s sent.</p>
    </Section>
  );
}
