"use client";
import { Badge, productLabel } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { downloadCsv } from "@/lib/csv";
import { CAPITAL_COLUMNS, capitalAccount, expectedPayoff, monthlyLine, withWatch } from "@/lib/holder-view";
import type { Investor } from "@/lib/investor-statements";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const TONE = { good: "text-good", note: "text-muted-foreground", warn: "text-warn", bad: "text-bad" } as const;

/** A partner's or buyer's capital account as a spreadsheet: a row per loan (lib/holder-view.ts). */
export function CapitalAccountDownload({ investor }: { investor: Investor }) {
  const { s } = useStore();
  const download = () => {
    const today = serviceDay(s);
    const rows = capitalAccount(withWatch(s), investor, today).map((row) => Object.fromEntries(CAPITAL_COLUMNS.map(([key, label]) => [label, key === "product" ? productLabel[row.product as Deal["app"]["product"]] ?? row.product : key === "share" ? `${Math.round(row.share * 100)}%` : row[key]])));
    downloadCsv(`lendhous-capital-account-${today}.csv`, rows);
  };
  return <button type="button" className="btn-ghost h-8! px-2.5! text-xs!" data-testid="capital-account-download" onClick={download}>Capital account (CSV)</button>;
}

/** One held loan's expected payoff and this month's line, under its row on the portfolio. */
export function LoanOutlook({ deal: held, moved }: { deal: Deal; moved?: boolean }) {
  const { s } = useStore();
  const today = serviceDay(s);
  if (moved) return null;
  const deal = withWatch({ deals: [held], draws: s.draws, storms: s.storms, payoffs: s.payoffs }).deals[0];
  const payoff = expectedPayoff(deal, today);
  const lines = deal.status === "paid_off" ? [] : monthlyLine(deal, deal.holderWatch, today);
  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="loan-outlook">
      <p className="text-muted-foreground" data-testid="loan-payoff">{payoff.basis === "plan" && <Badge tone="blue">Borrower&apos;s plan</Badge>}{payoff.basis === "letter" && <Badge tone="green">Payoff asked for</Badge>} {payoff.words}</p>
      {lines.length > 0 && <ul className="space-y-0.5" data-testid="loan-watch">{lines.map((line) => <li key={line.text} className={TONE[line.tone]}>{line.text}</li>)}</ul>}
    </div>
  );
}
