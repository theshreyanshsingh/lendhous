import type { Metadata } from "next";
import { PageHead } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Disclosures & Privacy" };

export default function Disclosures() {
  return (
    <>
      <PageHead eyebrow="INFORMATION & TRANSPARENCY" title="Know what this site provides." description="Important context for the information and tools on this website." />
      <main className="content">
        <article className="article">
          <h2>Financing information</h2>
          <p>This site describes business-purpose real estate investment financing. It is not an offer, rate lock, prequalification, loan approval, or commitment to lend. Program availability, pricing, leverage, experience requirements, property eligibility, and lending locations require confirmation by LendHous LLC.</p>
          <h2>Figures supplied by LendHous</h2>
          <p>The maximums of up to 95% loan-to-cost and up to 75% loan-to-value come from company-supplied notes. They are not available to every applicant and may not apply together. The $500M+ figure describes reported collective funding experience and is not represented as LendHous LLC’s own origination volume.</p>
          <h2>Calculators</h2>
          <p>Inputs are illustrative assumptions, not advertised rates or loan terms. Results omit costs unless a field expressly includes them. Actual loan documents, appraisals, and underwriting determine applicable calculations. No calculator result establishes eligibility or promises an investment return.</p>
          <h2>Privacy</h2>
          <p>The deal-brief form processes entries in your browser and can download them to your device. It does not send an application to LendHous. Do not enter private borrower information or upload financial documents there.</p>
          <p>This application does not add advertising analytics. Hosting may process ordinary request and access information. Signing in to the portal stores a session cookie. External reference links are subject to their destination’s privacy practices.</p>
          <h2>Portal and services</h2>
          <p>The client and team portal requires an account. Document submission and payment processing are not enabled in this version. Company contact details, lending jurisdictions, applicable licensing disclosures, and a company-approved privacy policy must be supplied before a public lending launch.</p>
        </article>
      </main>
    </>
  );
}
