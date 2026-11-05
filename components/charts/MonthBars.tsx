"use client";
import { k, usd } from "@/components/ui";
import { monthLabel, type MonthValue } from "@/lib/portfolio-charts";

/** A round number just above the largest value, so the top gridline reads cleanly. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

/**
 * One series of monthly amounts as thin bars on a baseline. Hover or focus a month for its exact amount; the largest
 * bar is labelled; a table of the same numbers is there for screen readers.
 */
export function MonthBars({ data, label, money = (n: number) => usd(n, 2), testid }: { data: MonthValue[]; label: string; money?: (n: number) => string; testid?: string }) {
  const top = niceMax(Math.max(...data.map((item) => item.value), 0));
  const biggest = data.reduce((best, item, i) => (item.value > (data[best]?.value ?? 0) ? i : best), 0);
  const showYear = new Set(data.map((item) => item.month.slice(0, 4))).size > 1;
  return (
    <figure className="relative min-w-0" data-testid={testid}>
      <div className="relative h-40" aria-hidden="true">
        {[1, 0.5].map((at) => (
          <div key={at} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${(1 - at) * 100}%` }}>
            <span className="absolute -top-2 left-0 bg-card pr-1 text-[10px] text-faint tabular-nums">{k(top * at)}</span>
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 border-t border-rule" />
        <div className="absolute inset-0 flex items-end gap-[2px] pl-11">
          {data.map((item, i) => {
            const height = (item.value / top) * 100;
            return (
              <div key={item.month} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none" data-testid="month-bar">
                {i === biggest && item.value > 0 && <span className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap text-muted-foreground tabular-nums" style={{ bottom: `calc(${height}% + 4px)` }}>{k(item.value)}</span>}
                <div className="w-full max-w-9 rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80 dark:bg-[#93a993]" style={{ height: `${height}%` }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-[2px] border border-border bg-popover px-2 py-1 text-[11px] whitespace-nowrap shadow-[var(--shadow)] group-hover:block group-focus-visible:block" role="tooltip">
                  <span className="text-muted-foreground">{monthLabel(item.month, true)}</span> <b className="font-semibold tabular-nums">{money(item.value)}</b>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px] pl-11" aria-hidden="true">
        {data.map((item) => <span key={item.month} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">{showYear && item.month.endsWith("-01") ? monthLabel(item.month, "short") : monthLabel(item.month)}</span>)}
      </div>
      {/* a table won't shrink to sr-only's 1px, so it sits in a box that does */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead><tr><th>Month</th><th>Amount</th></tr></thead>
          <tbody>{data.map((item) => <tr key={item.month}><td>{monthLabel(item.month, true)}</td><td>{money(item.value)}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}
