import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { gridAdjustments, rateGrid } from "@/lib/rate-grid";

export const metadata: Metadata = {
  title: "Rates and Leverage",
  description: "LendHous's rates, points and leverage by experience and credit for fix and flip, bridge, construction and DSCR rental loans, from today's pricing.",
};
// Every number comes from the pricing the owner last published.
export const dynamic = "force-dynamic";

export default async function Rates() {
  await loadPricing();
  const config = currentPricing();
  const tables = rateGrid(config);
  return (
    <>
      <PageHead eyebrow="TODAY'S RATE GRID" title="Rates and leverage, in the open." description="What each program lends and starts at, by your experience and credit. The same numbers our quotes and term sheets use." />
      <main className="content">
        {tables.map((table) => (
          <section key={table.key} className="compare rate-grid" data-testid={`rate-grid-${table.key}`}>
            <div className="eyebrow">{table.title.toUpperCase()}</div>
            <h2>{table.title}</h2>
            <p className="compare-best">{table.note}</p>
            <table>
              <thead><tr><th scope="col">{table.key === "dscr" ? "Credit score" : table.key === "ground_up" ? "Builds" : "Experience"}</th>{table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
              <tbody>{table.rows.map((row) => (
                <tr key={row.label} data-testid="rate-grid-row">
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, at) => <td key={table.columns[at]} data-label={table.columns[at]}>{cell}</td>)}
                </tr>
              ))}</tbody>
            </table>
            <Link href={table.href} className="text-link">About {table.title.toLowerCase()} loans</Link>
          </section>
        ))}
        <section className="compare" data-testid="rate-grid-adjustments">
          <div className="eyebrow">WHAT MOVES THE NUMBERS</div>
          <h2>Adjustments to the grid.</h2>
          <ul className="rewards-list">{gridAdjustments(config).map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="compare-note">Leverage is the most of the cost, after-repair value or value we lend, whichever is reached first. Ranges are the matrix&apos;s room for each tier; your quote picks a point in it, and your term sheet sets it. Not an offer to lend: terms depend on underwriting, the appraisal, title and credit. Business-purpose loans only. <Link href="/rewards" className="text-link">Repeat-borrower pricing</Link></p>
        </section>
        <div className="cta">
          <h2>Your deal, your terms.<br /><em>In about a minute.</em></h2>
          <Link className="button" href="/start">Get a loan quote <ArrowRight size={19} aria-hidden="true" /></Link>
        </div>
      </main>
    </>
  );
}
