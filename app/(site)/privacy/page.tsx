import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Privacy Policy", description: "What LendHous LLC collects on this website and in its loan portal, why, who it shares it with, and how it protects it." };

// The date this policy last changed. Change it with the text.
const PRIVACY_UPDATED = "November 23, 2026";

export default function Privacy() {
  return (
    <>
      <PageHead eyebrow="PRIVACY POLICY" title="How we handle your information." description={`What LendHous LLC collects on this website and in its loan portal, why, who sees it, and how it's protected. Last updated ${PRIVACY_UPDATED}.`} />
      <main className="content">
        <article className="article" data-testid="privacy">
          <p>LendHous LLC (&ldquo;LendHous&rdquo;, &ldquo;we&rdquo;) makes business-purpose loans to real estate investors and their companies. This policy covers lendhous.com, its quote and booking forms, and the LendHous portal used by borrowers, brokers, partner lenders, loan buyers and our team. It doesn&apos;t cover other companies&apos; sites that we link to.</p>

          <h2>What we collect</h2>
          <ul>
            <li><b>When you contact us or ask for a quote:</b> your name, email, phone and company, the property&apos;s address and details, the numbers of your deal, and any notes or photos you send. Booking a call adds the time you chose.</li>
            <li><b>When you open an account:</b> your name, email, phone and password. We keep only a scrambled (hashed) form of your password.</li>
            <li><b>When you apply for a loan:</b> details about you, your company and anyone guaranteeing the loan, including dates of birth, Social Security numbers, citizenship, addresses and ownership; credit reports and background, identity and sanctions checks you authorize; bank statements, entity documents, IDs, your track record, and documents about the property such as purchase contracts, budgets, appraisals, title, insurance, permits and photos.</li>
            <li><b>While a loan is open:</b> draw requests and their photos and receipts, payments, messages with our team, and documents from title companies, insurance agents, appraisers, inspectors and contractors.</li>
            <li><b>From partner lenders, loan buyers and brokers:</b> details of the firm and its owners and officers, investor status, tax forms (W-9) and the documents of our agreements.</li>
            <li><b>Automatically:</b> the address your device connects from, your browser type, and the pages you request, which our servers record to run the site, keep it secure and limit abuse. We count how many visitors reach each step of the quote form, without cookies or anything that identifies you.</li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>To answer you, prepare quotes and term sheets, and decide on, close, fund and service loans.</li>
            <li>To verify identities and check sanctions lists, including the U.S. Treasury&apos;s OFAC list, and to prevent fraud.</li>
            <li>To arrange funding with partner lenders and to sell loans or shares of loans to buyers.</li>
            <li>To send notices about your account and loans, and, if you haven&apos;t opted out, occasional news about our programs.</li>
            <li>To keep records the law requires, to protect our rights and yours, and to keep the site and portal secure and working.</li>
          </ul>
          <p>We don&apos;t sell your personal information, and we don&apos;t use advertising or tracking cookies.</p>

          <h2>Who we share it with</h2>
          <ul>
            <li><b>The people working on your loan:</b> partner lenders and loan buyers who fund or buy it, under confidentiality agreements; your broker, if you came through one; and the title company, closing attorney, appraiser, inspector, insurance agent and contractors on the loan, each seeing only what their part needs.</li>
            <li><b>Companies that run services for us:</b> hosting and file storage (Amazon Web Services), our database (MongoDB Atlas), the network that delivers the site (Cloudflare), email delivery, and, if used, an error-reporting service that gets reports with personal details taken out. If address suggestions are on, what you type in an address field goes to Google to suggest addresses. A property&apos;s address, and nothing about you, goes to the U.S. Census Bureau and FEMA to place it on a map and find its flood zone. If you turn on notifications, your browser&apos;s push service delivers them. These companies may use the information only to provide their service to us.</li>
            <li><b>Our professional advisers,</b> such as attorneys, accountants and auditors, under a duty of confidentiality.</li>
            <li><b>When the law requires it,</b> or to respond to lawful requests from courts and government agencies, to prevent fraud or harm, or to enforce our agreements.</li>
            <li><b>If LendHous or its loans are sold or merged,</b> to the buyer or successor, which must handle it as this policy says.</li>
          </ul>

          <h2>How we protect it</h2>
          <p>The site and portal are served over encrypted connections. Social Security numbers and other sensitive details, and every document stored in the portal, are encrypted with keys only LendHous holds. Each person in the portal sees only what their role allows; our team&apos;s access is recorded, and staff are signed out when idle. PDFs opened by partner lenders and loan buyers carry the viewer&apos;s name. No system is perfectly secure, but if a breach of security affects your personal information, we will notify you as Florida law requires (section 501.171, Florida Statutes).</p>

          <h2>Cookies and similar tools</h2>
          <p>Signing in to the portal sets one cookie that keeps you signed in. Your browser may also keep a few preferences on your device. We don&apos;t use cookies for advertising or analytics.</p>

          <h2>How long we keep it</h2>
          <p>We keep information as long as we need it for the purposes above. Loan files, records of sanctions checks and our audit records are kept after a loan is repaid, for as long as the law and our agreements with partner lenders and loan buyers require. A quote request that doesn&apos;t become a loan is kept so we can follow up and to keep records of our lending.</p>

          <h2>Your choices</h2>
          <ul>
            <li><b>See or correct your information:</b> ask your loan team in the portal, or anyone on the team through the <Link href="/contact">contact page</Link>.</li>
            <li><b>Stop marketing emails:</b> use the unsubscribe link in any of them. Notices about your account or loan still come, because they&apos;re part of the service.</li>
            <li><b>Ask us to delete your information:</b> we&apos;ll delete what the law and our agreements don&apos;t require us to keep.</li>
            <li><b>Turn off notifications</b> from the portal&apos;s Notifications page or your browser.</li>
          </ul>

          <h2>Children</h2>
          <p>This site and our loans are for adults acting for a business. We don&apos;t knowingly collect information from anyone under 18.</p>

          <h2>Changes to this policy</h2>
          <p>We&apos;ll post any change here with a new date at the top. If a change materially affects information we already hold, we&apos;ll tell account holders by email or in the portal.</p>

          <h2>Contact</h2>
          <p>Questions about this policy or your information go to the team through the <Link href="/contact">contact page</Link>. See also our <Link href="/terms">terms of use</Link> and <Link href="/disclosures">disclosures</Link>.</p>
        </article>
      </main>
    </>
  );
}
