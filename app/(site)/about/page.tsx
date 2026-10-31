import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";

export const metadata: Metadata = { title: { absolute: "About LendHous | Investor-Focused Financing" } };

const VALUES = [
  { title: "Clarity at every step", body: "Understand the information requested, the next milestone, and the assumptions behind proposed financing." },
  { title: "A complete project view", body: "Look beyond the purchase price to renovation needs, carrying costs, contingencies, and the exit." },
  { title: "Room to build experience", body: "Use practical resources and deal-planning tools to enter a financing conversation better prepared." },
];

export default function About() {
  return (
    <>
      <PageHead eyebrow="THE LENDHOUS PERSPECTIVE" title="Capital with a clear purpose." description="LendHous LLC is focused on real estate investors: the people who see an opportunity, make a plan, and bring a property’s potential to life." />
      <main className="content">
        <div className="two-col">
          <section>
            <div className="eyebrow">INSTITUTIONAL THINKING. PERSONAL ATTENTION.</div>
            <h2>Your first investment.<br /><em>Your next chapter.</em></h2>
            <p style={{ marginTop: 25 }}>Our approach starts with understanding the project. The property, the budget, the timeline, and the exit should shape the financing conversation.</p>
            <p>First-time investors are welcome to explore their options. Experience is one part of a broader review, alongside the property, financial profile, and project plan.</p>
            <Link className="button" href="/start">Start with your strategy</Link>
          </section>
          <aside className="panel">
            <div className="eyebrow">COLLECTIVE EXPERIENCE</div>
            <div className="result">$500M+</div>
            <h3>Collectively funded</h3>
            <p>Collective funding experience reported by LendHous. This figure does not represent loans originated solely by LendHous LLC.</p>
            <div className="note">Specific program availability, maximum leverage, and terms are determined through eligibility review and underwriting.</div>
          </aside>
        </div>
        <div className="program-grid" style={{ marginTop: 60 }}>
          {VALUES.map((value) => (
            <section key={value.title} className="panel">
              <h3>{value.title}</h3>
              <p>{value.body}</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
