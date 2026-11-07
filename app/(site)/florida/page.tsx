import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { COUNTIES } from "@/lib/counties";

export const metadata: Metadata = { title: "Florida Investor Loans by County", description: "LendHous lends to real estate investors across Florida. Fix and flip, bridge, construction and DSCR rental loans by county." };

export default function Florida() {
  return (
    <>
      <PageHead eyebrow="WHERE WE LEND" title="Investor loans across Florida." description="Our core markets are Miami-Dade, Broward and Palm Beach, and we lend across the state. Pick a county for its terms and what's worth knowing there." />
      <main className="content">
        <h2 className="sr-only">The counties</h2>
        <div className="program-grid" data-testid="county-list">
          {COUNTIES.map((county) => (
            <Link key={county.slug} className="program-card" href={`/florida/${county.slug}`} data-testid="county-card">
              <div className="card-top"><span>{county.name.toUpperCase()} COUNTY</span><ArrowRight size={20} aria-hidden="true" /></div>
              <h3>{county.name}</h3>
              <p>{county.cities.join(", ")}</p>
            </Link>
          ))}
        </div>
        <div className="cta">
          <h2>Somewhere else in Florida?<br /><em>Ask anyway.</em></h2>
          <Link className="button" href="/start">Get a loan quote <ArrowRight size={19} aria-hidden="true" /></Link>
        </div>
      </main>
    </>
  );
}
