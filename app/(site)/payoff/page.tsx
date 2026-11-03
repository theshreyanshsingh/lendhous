import type { Metadata } from "next";
import { PageHead } from "@/components/site-chrome";
import { LETTER_DAYS } from "@/lib/payoffs";
import { PayoffRequestForm } from "./payoff-request";

export const metadata: Metadata = {
  title: "Request a Payoff Letter",
  description: "Borrowers, title companies and closing attorneys can ask LendHous for a payoff letter online. We send it by email within 10 days, usually much sooner.",
};

export default function PayoffRequestPage() {
  return (
    <>
      <PageHead eyebrow="PAYOFF LETTER" title="Request a payoff letter." description="For the borrower, or a title company or attorney the borrower has authorized in writing. No account needed." />
      <main className="content quote-layout">
        <PayoffRequestForm />
        <aside className="panel" style={{ position: "sticky", top: 24 }}>
          <div className="eyebrow">WHAT HAPPENS NEXT</div>
          <ol className="quote-next">
            <li><b>We log it today.</b> You get an email saying when it counts as received.</li>
            <li><b>We check who&apos;s asking.</b> Anyone but the borrower sends the borrower&apos;s signed authorization, and we tell the borrower you asked.</li>
            <li><b>The letter, by email.</b> Itemized and good through your date, within {LETTER_DAYS} days as Florida law requires, usually much sooner.</li>
          </ol>
          <p className="quote-small">Payoffs are paid by wire. Our letters never include wire instructions, and we never send them by email: you get them by calling us at a number you find yourself.</p>
        </aside>
      </main>
    </>
  );
}
