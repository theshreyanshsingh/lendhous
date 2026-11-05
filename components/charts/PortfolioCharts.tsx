"use client";
import { MonthBars } from "@/components/charts/MonthBars";
import { useServiceDay } from "@/components/loan/use-service-day";
import { Section, usd } from "@/components/ui";
import { holdingsOf, type Investor } from "@/lib/investor-statements";
import { lastMonths, maturityLadder, monthLabel, paidByMonth } from "@/lib/portfolio-charts";
import { useStore } from "@/lib/store";

/** A partner's or buyer's money over time: what was paid to them in the last year, and when their balances come due. */
export function PortfolioCharts({ investor }: { investor: Investor }) {
  const { s } = useStore();
  const today = useServiceDay();
  const holdings = holdingsOf(s, investor);
  if (!holdings.length) return null;
  const paid = today ? paidByMonth(holdings, lastMonths(today, 12)) : [];
  const ladder = maturityLadder(holdings);
  const total = paid.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="portfolio-charts">
      <Section title="Paid to you, last 12 months" right={today ? <span className="text-xs text-muted-foreground tabular-nums">{usd(total, 2)} in all</span> : null}>
        {today ? <MonthBars data={paid} label="Paid to you each month, after servicing" testid="paid-chart" /> : <div className="h-44 animate-pulse rounded-[2px] bg-muted" />}
      </Section>
      <Section title="When your money comes back">
        {ladder.length === 0 ? <p className="text-sm text-muted-foreground">Every loan is paid off.</p> : (
          <ul className="space-y-2.5" data-testid="maturity-ladder">
            {ladder.map((item) => {
              const share = item.value / Math.max(...ladder.map((row) => row.value));
              return (
                <li key={item.month} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
                  <span className="text-muted-foreground">{monthLabel(item.month, true)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-brand dark:bg-[#93a993]" style={{ width: `${Math.max(2, share * 100)}%` }} /></span>
                  <span className="font-medium tabular-nums">{usd(item.value)}</span>
                </li>
              );
            })}
            <li className="pt-1 text-[11px] text-faint">Your share of each loan&apos;s balance, by the month it matures. Loans can pay off early or be extended.</li>
          </ul>
        )}
      </Section>
    </div>
  );
}
