"use client";
import { Section } from "@/components/ui";
import type { Period } from "@/lib/reports";
import { hoursText, speedScoreboard, type Cell } from "@/lib/speed";
import { useStore } from "@/lib/store";

const shown = (value: Cell, business: boolean) => (value.count ? hoursText(value.median, business) : "–");

/** How fast the team worked in the period against its targets: overall and by loan officer. */
export function SpeedScoreboard({ period }: { period: Period }) {
  const { s, targets } = useStore();
  const { measures, byOfficer } = speedScoreboard(s, period, targets);
  return (
    <Section title="Speed against the targets">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="speed-measures">
        {measures.map(({ key, target, overall }) => (
          <div key={key} className="min-w-0 rounded-[2px] border border-border p-3" data-testid={`speed-${key}`}>
            <p className="text-xs text-muted-foreground">{target.label}</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums">{shown(overall, target.business)}</p>
            <p className="text-xs text-muted-foreground">{overall.count ? `middle of ${overall.count} · slowest ${hoursText(overall.slowest, target.business)} · ${overall.met} of ${overall.count} on time` : "None finished in this period"}</p>
            <p className="text-[11px] text-faint">Target {hoursText(target.hours, target.business)}</p>
          </div>
        ))}
      </div>
      {byOfficer.length > 0 && (
        <table className="stack-table mt-4 w-full text-sm" data-testid="speed-by-officer">
          <thead><tr><th>Loan officer</th>{measures.map(({ key, target }) => <th key={key} className="text-right">{target.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {byOfficer.map((row) => (
              <tr key={row.name}>
                <td className="font-medium">{row.name}</td>
                {measures.map(({ key, target }) => {
                  const value = row.cells[key];
                  const late = value.count > 0 && value.met < value.count;
                  return <td key={key} data-label={target.label} className={`text-right tabular-nums ${late ? "text-warn" : ""}`}>{shown(value, target.business)}{value.count ? <span className="block text-[11px] text-muted-foreground">{value.met} of {value.count} on time</span> : null}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-muted-foreground">The middle wait (median) for work finished in the period. Targets are set in Settings.</p>
    </Section>
  );
}
