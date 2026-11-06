import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { comparePrograms } from "@/lib/program-compare";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { PROGRAMS } from "@/lib/site-content";

export const metadata: Metadata = { title: "Loan Programs" };
// The comparison comes from the pricing the owner last published.
export const dynamic = "force-dynamic";

export default async function Programs() {
  await loadPricing();
  const compare = comparePrograms(currentPricing());
  return (
    <>
      <PageHead eyebrow="CAPITAL FOR YOUR STRATEGY" title="Find the right starting point." description="Acquire, improve, build, or hold. Explore how different financing structures can support your investment plan." />
      <main className="content">
        <div className="note">Program guides are a starting point for discussion. Confirm LendHous program availability, lending location, and current eligibility before applying.</div>
        <h2 className="sr-only">The programs</h2>
        <div className="program-grid">
          {PROGRAMS.map((program, index) => (
            <Link key={program.slug} className="program-card" href={`/programs/${program.slug}`}>
              <div className="card-top"><span>PROGRAM 0{index + 1}</span><ArrowRight size={20} aria-hidden="true" /></div>
              <div className="eyebrow">{program.eyebrow}</div>
              <h3>{program.title}</h3>
              <p>{program.summary}</p>
              <div className="card-link">View financing guide <ArrowRight size={16} aria-hidden="true" /></div>
            </Link>
          ))}
        </div>
        <section className="compare" data-testid="program-compare">
          <div className="eyebrow">SIDE BY SIDE</div>
          <h2>Compare loan programs at a glance.</h2>
          <div className="compare-grid">
            {compare.map((program) => (
              <Link key={program.key} href={program.href} className="compare-card" data-testid="compare-card">
                <h3>{program.name}</h3>
                <p className="compare-best">{program.bestFor}</p>
                <dl>
                  <div><dt>Rate from</dt><dd className="compare-rate">{program.rateFrom.toFixed(2)}%</dd></div>
                  <div><dt>Points from</dt><dd>{program.pointsFrom}</dd></div>
                  <div><dt>Financing</dt><dd>{program.financing}</dd></div>
                  <div><dt>Term</dt><dd>{program.term}</dd></div>
                  <div><dt>Credit score from</dt><dd>{program.minFico}</dd></div>
                  <div><dt>Borrower</dt><dd>LLC or other entity</dd></div>
                </dl>
              </Link>
            ))}
          </div>
          <p className="compare-note">Rates and leverage from today&apos;s pricing for the most experienced borrowers; your terms depend on the deal, your experience and credit. Not an offer to lend. Not sure which fits? <Link href="/start" className="text-link">Request a quote</Link> and a loan officer will match you the same day.</p>
        </section>
        <div className="cta">
          <h2>Start with the property.<br /><em>Build around the plan.</em></h2>
          <Link className="button" href="/start">Get a loan quote <ArrowRight size={19} aria-hidden="true" /></Link>
        </div>
      </main>
    </>
  );
}
