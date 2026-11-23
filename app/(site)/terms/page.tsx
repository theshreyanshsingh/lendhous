import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Terms of Use", description: "The terms for using lendhous.com and the LendHous loan portal." };

// The date these terms last changed. Change it with the text.
const TERMS_UPDATED = "November 23, 2026";

export default function Terms() {
  return (
    <>
      <PageHead eyebrow="TERMS OF USE" title="The terms for using this site." description={`The rules for lendhous.com and the LendHous loan portal. Last updated ${TERMS_UPDATED}.`} />
      <main className="content">
        <article className="article" data-testid="terms">
          <p>These terms apply to lendhous.com and the LendHous portal (together, &ldquo;the site&rdquo;), run by LendHous LLC (&ldquo;LendHous&rdquo;, &ldquo;we&rdquo;). By using the site you agree to them. A loan itself is governed by its own term sheet and loan documents, which take priority over these terms for that loan.</p>

          <h2>Business-purpose financing only</h2>
          <p>LendHous makes loans for business purposes only, to real estate investors and their companies, on investment property. Don&apos;t use the site to seek a loan for personal, family or household purposes, or on a home you live in or plan to live in.</p>

          <h2>Nothing here is a commitment to lend</h2>
          <p>Quotes, rates, calculators, guides and other information on the site are estimates and general information. They aren&apos;t an offer, a rate lock, a prequalification, an approval or a commitment to lend, and they aren&apos;t legal, tax or investment advice. A loan is approved only in writing, on the terms of its own documents. See our <Link href="/disclosures">disclosures</Link>.</p>

          <h2>Your account</h2>
          <ul>
            <li>You must be at least 18 and able to act for yourself or the company you represent.</li>
            <li>Keep your password to yourself, and tell us straight away through the <Link href="/contact">contact page</Link> if you think someone else has used your account. You&apos;re responsible for what&apos;s done with it until you tell us.</li>
            <li>We may suspend or close an account that breaks these terms, that we suspect of fraud, or where the law requires it.</li>
          </ul>

          <h2>What you send us</h2>
          <p>What you tell us and upload must be true, complete and yours to share. You authorize us to verify it, as described in your application and our <Link href="/privacy">privacy policy</Link>. Don&apos;t send another person&apos;s information without their permission.</p>

          <h2>Using the site properly</h2>
          <p>Don&apos;t:</p>
          <ul>
            <li>use the site for anything unlawful or fraudulent, or pretend to be someone else;</li>
            <li>try to get into accounts, loans or parts of the site that aren&apos;t yours, or test, probe or get around its security;</li>
            <li>upload malware or anything meant to harm the site or its users;</li>
            <li>copy the site&apos;s content or data by automated means, or overload it;</li>
            <li>copy, resell or reuse the site&apos;s content commercially without our written permission.</li>
          </ul>

          <h2>Notices by email and in the portal</h2>
          <p>We send notices about your account and loans by email and in the portal. Consent to receive loan documents and disclosures electronically is asked for separately, when you apply.</p>

          <h2>Our content</h2>
          <p>The site, its text, design, logos and tools belong to LendHous or its licensors. You may use them to consider and manage financing with LendHous. Brokers may use the materials we give them for that purpose, as their broker agreement allows.</p>

          <h2>Other sites</h2>
          <p>Links to other sites are for convenience. We don&apos;t control them and aren&apos;t responsible for their content or how they handle information.</p>

          <h2>No warranties</h2>
          <p>We work to keep the site accurate and available, but it&apos;s provided &ldquo;as is&rdquo;, without warranties of any kind, to the fullest extent the law allows. Information can change or contain errors, and the site may be unavailable at times.</p>

          <h2>Limits on our liability</h2>
          <p>To the fullest extent the law allows, LendHous isn&apos;t liable for indirect, incidental, special or consequential losses, or for lost profits or data, arising from your use of the site or your reliance on its information. Nothing in these terms limits liability that the law doesn&apos;t allow to be limited, or changes the terms of a loan agreement.</p>

          <h2>Florida law</h2>
          <p>These terms are governed by the laws of the State of Florida, without regard to its conflict-of-laws rules.</p>

          <h2>Changes</h2>
          <p>We may change these terms by posting a new version here with a new date. Using the site after a change means you accept the new terms.</p>

          <h2>Contact</h2>
          <p>Questions about these terms go to the team through the <Link href="/contact">contact page</Link>.</p>
        </article>
      </main>
    </>
  );
}
