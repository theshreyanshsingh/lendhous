"use client";
import { Section, usd } from "@/components/ui";
import type { Deal } from "@/lib/mockData";

function Bar({ share, label }: { share: number; label: string }) {
  const width = `${Math.min(100, Math.max(0, share * 100))}%`;
  return <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={label}><div className="h-full rounded-full bg-brand" style={{ width }} /></div>;
}

/** How much of the rehab budget has been paid out in draws, overall and line by line. */
export function RehabProgress({ deal }: { deal: Deal }) {
  const lines = (deal.scope ?? []).filter((line) => line.budget > 0);
  if (!lines.length) return null;
  const budget = lines.reduce((sum, line) => sum + line.budget, 0);
  const released = lines.reduce((sum, line) => sum + line.released, 0);
  return (
    <Section title="Rehab money" right={<span className="text-xs text-muted-foreground tabular-nums">{Math.round((released / budget) * 100)}% paid out</span>}>
      <div data-testid="rehab-progress">
        <p className="mb-2 text-sm tabular-nums"><b className="font-semibold">{usd(released)}</b> <span className="text-muted-foreground">of {usd(budget)} paid in draws</span></p>
        <ul className="mt-3 space-y-2.5">
          {lines.map((line) => (
            <li key={line.id} className="text-xs">
              <div className="mb-1 flex items-baseline justify-between gap-2"><span className="min-w-0 truncate">{line.division}</span><span className="shrink-0 text-muted-foreground tabular-nums">{usd(line.released)} of {usd(line.budget)}</span></div>
              <Bar share={line.released / line.budget} label={`${line.division} paid out`} />
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
