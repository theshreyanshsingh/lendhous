import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FAQS, PROGRAMS } from "@/lib/site-content";
import { QuickCheck } from "./quick-check";

const STEPS = [
  { title: "The conversation", body: "Tell us about the property, your budget, experience, and intended exit." },
  { title: "The details", body: "Review the proposed structure, costs, and documents required for underwriting." },
  { title: "The closing", body: "Complete diligence and closing conditions. Coordinate funding and any renovation draws." },
];

export default function Landing() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">REAL ESTATE INVESTMENT LENDING</div>
          <h1>A considered<br />approach<br />to capital.</h1>
          <p>For the property you see potential in.<br />Fix &amp; flip, DSCR rental, bridge, construction,<br className="desktop-break" /> and portfolio financing for real estate investors.</p>
          <div className="actions">
            <Link className="button" href="/start">Discuss your project <ArrowRight size={19} aria-hidden="true" /></Link>
            <Link className="text-link" href="/programs">View loan programs</Link>
          </div>
          <p className="hero-note">A short form, not an application. No credit check.</p>
          <div className="hero-foot">First property or established portfolio.<br /> You’re in the right place.</div>
        </div>
        <figure className="hero-visual city-view">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/dallas-skyline.webp" width={1500} height={1156} fetchPriority="high" alt="Dallas skyline at twilight, with Reunion Tower and Bank of America Plaza; photograph by Carol M. Highsmith" />
        </figure>
      </section>

      <section className="metrics">
        <div><span className="metric-label">LOAN-TO-COST¹</span><strong><small>Up to</small> 95<span>%</span></strong></div>
        <div><span className="metric-label">LOAN-TO-VALUE¹</span><strong><small>Up to</small> 75<span>%</span></strong></div>
        <div><span className="metric-label">COLLECTIVELY FUNDED²</span><strong>$500<span>M+</span></strong></div>
      </section>

      <section className="section lending-section">
        <div className="lending-intro">
          <div className="eyebrow">THE FINANCING</div>
          <h2>Different properties.<br />Different plans.</h2>
          <p>Start with what you intend to do.<br />We’ll help frame the financing conversation.</p>
          <Link className="text-link" href="/programs">Explore all programs <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="program-ledger">
          {PROGRAMS.map((program, index) => (
            <Link key={program.slug} className="program-row" href={`/programs/${program.slug}`} data-testid="home-program">
              <span className="row-number">0{index + 1}</span>
              <div>
                <h3>{program.title}</h3>
                <p>{program.homeSummary}</p>
                <p className="row-fit"><span>Best for:</span> {program.audience}</p>
              </div>
              <ArrowRight size={23} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className="process section">
        <div className="process-heading">
          <div className="eyebrow">WORKING TOGETHER</div>
          <h2>Know what comes next.</h2>
          <Link className="text-link" href="/resources">Read the investor guides <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="steps">
          {STEPS.map((step, index) => (
            <section key={step.title}>
              <span className="step-number">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </section>
          ))}
        </div>
      </section>

      <section className="section tool-section">
        <div>
          <div className="eyebrow">BEFORE YOU REACH OUT</div>
          <h2>Run the numbers first.</h2>
          <p className="lede">See how cost and value limits can shape a loan on your deal. A high limit on one ratio doesn’t override a lower limit on another.</p>
          <div className="tool-links">
            <Link className="text-link" href="/calculators">Rental coverage and flip margin calculators <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="text-link" href="/resources/leverage">LTC, LTV, and ARV explained <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
        <QuickCheck />
      </section>

      <section className="section faq-section">
        <div>
          <div className="eyebrow">COMMON QUESTIONS</div>
          <h2>Straight answers.</h2>
          <p className="lede">Eligibility and terms depend on the program, the property, and underwriting. Here’s what we can say up front.</p>
          <Link className="text-link" href="/resources">More investor resources <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="faq">
          {FAQS.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="cta home-cta">
        <div>
          <div className="eyebrow">LET’S TALK PROPERTY</div>
          <h2>What are you working on?</h2>
          <p className="cta-lede">Send the team your property, budget, and plan.</p>
        </div>
        <Link className="button" href="/start">Discuss your project <ArrowRight size={19} aria-hidden="true" /></Link>
      </section>

      <section className="footnotes">
        <p>¹ Maximum leverage figures supplied by LendHous. Availability depends on the program, borrower, property, and underwriting; maximums may not apply together.</p>
        <p>² Collective funding experience supplied by LendHous; does not represent funding solely originated by LendHous LLC.</p>
      </section>
    </main>
  );
}
