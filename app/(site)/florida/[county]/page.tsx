import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/site-chrome";
import { readBook } from "@/lib/book-store";
import { countyBySlug, countyTerms, fundedIn } from "@/lib/counties";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { comparePrograms } from "@/lib/program-compare";

type Props = { params: Promise<{ county: string }> };

// The terms come from today's pricing and the funded figures from the loan book, so each visit is built fresh.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const county = countyBySlug((await params).county);
  return county ? { title: `Investor Loans in ${county.name} County`, description: `Fix and flip, bridge, construction and DSCR rental loans for real estate investors in ${county.name} County, Florida: ${county.cities.join(", ")}.` } : {};
}

const usd = (amount: number) => `$${amount.toLocaleString("en-US")}`;

export default async function CountyPage({ params }: Props) {
  const county = countyBySlug((await params).county);
  if (!county) notFound();
  await loadPricing();
  const config = currentPricing();
  const terms = countyTerms(county, config);
  const programs = comparePrograms(config);
  const funded = fundedIn((await readBook().catch(() => null))?.book.deals ?? [], county);
  return (
    <>
      <PageHead eyebrow={`${county.name.toUpperCase()} COUNTY, FLORIDA`} title={`Investor loans in ${county.name} County.`} description={`Fix and flip, bridge, new construction and DSCR rental loans in ${county.cities.join(", ")} and across the county, from a Florida lender.`} />
      <main className="content program-detail">
        <article data-testid="county-page">
          <h2>{terms.core ? "One of our core markets." : "Lending across Florida."}</h2>
          <p data-testid="county-terms">{terms.core ? `${county.name} is one of LendHous's core markets, where our loans go to the full leverage in the rate grid.` : `LendHous lends in ${county.name} County at the rate grid's terms with ${Math.round(terms.leverageCut * 100)}% less leverage than in our core South Florida markets.`}{funded ? ` We've funded ${funded.loans} loans here, about ${usd(funded.total)} in all.` : ""}</p>
          <h3>What we lend here</h3>
          <ul>{programs.map((program) => <li key={program.key}><Link className="text-link" href={program.href}>{program.name}</Link>: from {program.rateFrom.toFixed(2)}%, {program.financing.charAt(0).toLowerCase() + program.financing.slice(1)}, {program.term}.</li>)}</ul>
          <h3>Worth knowing in {county.name}</h3>
          <p>{county.note}</p>
          <ul>
            <li>Check the property&apos;s FEMA flood zone first: in zones A and V, flood cover is required for the loan.{county.coastal ? " Close to the coast, windstorm cover is often a separate policy." : ""}</li>
            <li>On a rehab or build, the Notice of Commencement is recorded with the {county.name} County Clerk before work starts, and each draw needs its lien waivers.</li>
            <li>The {county.name} County Property Appraiser&apos;s records show past sales, the assessed value and the taxes to plan for.</li>
          </ul>
          <p className="fine">General information, not advice. Terms depend on the deal, your experience and credit, and underwriting. Not an offer to lend.</p>
          <Link className="text-link" href="/florida">← Every Florida county we cover</Link>
        </article>
        <aside className="stack" style={{ alignSelf: "start" }}>
          <div className="panel">
            <div className="eyebrow">YOUR NEXT STEP</div>
            <h3>Terms on your {county.name} deal in a minute.</h3>
            <p>Enter the property and the numbers to see indicative terms before giving any contact details.</p>
            <Link className="button" href="/start">Get a loan quote</Link>
          </div>
          <Link className="panel" href="/rates">
            <h3>See the rate grid ↗</h3>
            <p>Leverage and starting rates by experience and credit, for every program.</p>
          </Link>
        </aside>
      </main>
    </>
  );
}
