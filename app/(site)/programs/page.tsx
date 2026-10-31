import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { PROGRAMS } from "@/lib/site-content";

export const metadata: Metadata = { title: "Loan Programs" };

export default function Programs() {
  return (
    <>
      <PageHead eyebrow="CAPITAL FOR YOUR STRATEGY" title="Find the right starting point." description="Acquire, improve, build, or hold. Explore how different financing structures can support your investment plan." />
      <main className="content">
        <div className="note">Program guides are a starting point for discussion. Confirm LendHous program availability, lending location, and current eligibility before applying.</div>
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
        <div className="cta">
          <h2>Start with the property.<br /><em>Build around the plan.</em></h2>
          <Link className="button" href="/start">Prepare your deal brief <ArrowRight size={19} aria-hidden="true" /></Link>
        </div>
      </main>
    </>
  );
}
