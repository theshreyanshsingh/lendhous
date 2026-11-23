import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";
import { nmlsLookup, siteContact } from "@/lib/site-contact";

export const metadata: Metadata = { title: "Disclosures & Licensing", description: "How LendHous lends, what the figures on this site mean, and how LendHous LLC is licensed." };

export default async function Disclosures() {
  const contact = await siteContact();
  return (
    <>
      <PageHead eyebrow="DISCLOSURES" title="What to know before you apply." description="How LendHous lends, what the figures on this site mean, and how LendHous LLC is licensed." />
      <main className="content">
        <article className="article" data-testid="disclosures">
          <h2>Business-purpose loans only</h2>
          <p>LendHous LLC lends to real estate investors and their companies, for business purposes only: to buy, renovate, build, refinance or hold investment property. It doesn&apos;t make loans for personal, family or household purposes, or loans on a home the borrower lives in or plans to live in.</p>

          <h2>Not a commitment to lend</h2>
          <p>Nothing on this site is an offer, a rate lock, a prequalification, an approval or a commitment to lend. Terms shown by the quote form, the rates page and the calculators are estimates from today&apos;s pricing and the details you enter. A loan is approved only in writing, after underwriting, a valuation of the property, a review of title and insurance, and the conditions in its term sheet. Rates, leverage, fees and programs can change without notice.</p>

          <h2>The figures on this site</h2>
          <p>Up to 95% of cost and up to 75% of value are program maximums. Not every borrower, property or program qualifies for them, and both may not apply to the same loan.</p>
          <p>$500M+ is the combined funding experience of the LendHous team. It isn&apos;t loan volume originated by LendHous LLC alone.</p>

          <h2>Calculators</h2>
          <p>The calculators are for illustration. Their inputs are assumptions you choose, not advertised rates or loan terms, and their results leave out costs unless a field includes them. They don&apos;t decide eligibility or promise a return: loan documents, appraisals and underwriting decide the actual numbers.</p>

          <h2>Licensing</h2>
          {contact.nmlsId
            ? <p data-testid="disclosures-nmls">LendHous LLC&apos;s NMLS ID is {contact.nmlsId}. You can look it up on <a href={nmlsLookup(contact.nmlsId)} rel="noopener noreferrer" target="_blank">NMLS Consumer Access</a>.</p>
            : <p data-testid="disclosures-licensing">LendHous LLC makes business-purpose loans on investment property across Florida.</p>}

          <h2>Your information</h2>
          <p>How LendHous collects, uses, shares and protects what you give it is in the <Link href="/privacy">privacy policy</Link>. Using this site is covered by the <Link href="/terms">terms of use</Link>.</p>

          <h2>Contact</h2>
          <p>Questions about these disclosures, or about a loan, go to the team through the <Link href="/contact">contact page</Link>.</p>
        </article>
      </main>
    </>
  );
}
