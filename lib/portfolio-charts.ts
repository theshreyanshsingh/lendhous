// The numbers behind a partner's or buyer's portfolio charts: what was paid to them each month, and how much of their
// money comes due each month. Both come from the same servicing ledger and payment split as the monthly statements.
import type { Holding } from "./investor-statements";
import { splitOf } from "./investor-statements";
import { balanceOf, ledger } from "./servicing";

export type MonthValue = { month: string; value: number };

/** The n months ending with the one today is in, oldest first: ["2026-06", …, "2026-11"]. */
export function lastMonths(today: string, n: number) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 - (n - 1 - i), 1));
    return date.toISOString().slice(0, 7);
  });
}

/** What reached the investor in each month, after servicing: interest, principal and payoffs. */
export function paidByMonth(holdings: Holding[], months: string[]): MonthValue[] {
  return months.map((month) => ({ month, value: Math.round(holdings.reduce((sum, holding) => sum + splitOf(holding, (day) => day.startsWith(month)).net, 0) * 100) / 100 }));
}

/** The investor's share of each unpaid loan, grouped by the month the loan matures, soonest first. */
export function maturityLadder(holdings: Holding[]): MonthValue[] {
  const byMonth = new Map<string, number>();
  for (const holding of holdings) {
    if (holding.deal.status === "paid_off") continue;
    const month = ledger(holding.deal).maturity.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + holding.share * balanceOf(holding.deal));
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value: Math.round(value) }));
}

/** "2026-11" → "Nov", "Nov 2026" with the year, or "Jan ’27" short, for a chart's axis. */
export const monthLabel = (month: string, year: boolean | "short" = false) => {
  const name = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", ...(year === true ? { year: "numeric" } : {}), timeZone: "UTC" });
  return year === "short" ? `${name} ’${month.slice(2, 4)}` : name;
};
