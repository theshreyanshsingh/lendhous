import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { FAQS, GUIDES } from "@/lib/site-content";

export const metadata: Metadata = { title: "Investor Resources" };

export default function Resources() {
  return (
    <>
      <PageHead eyebrow="THE INVESTOR FIELD GUIDE" title="A little clarity goes a long way." description="Practical explanations for the decisions between finding a property and financing your next move." />
      <main className="content two-col">
        <div className="resource-list">
          {GUIDES.map((guide) => (
            <Link key={guide.slug} href={`/resources/${guide.slug}`}>
              <div className="eyebrow">{guide.eyebrow}</div>
              <h3>{guide.title}<ArrowRight size={22} aria-hidden="true" className="shrink-0" /></h3>
              <p>{guide.summary}</p>
            </Link>
          ))}
        </div>
        <aside className="stack" style={{ alignSelf: "start" }}>
          <div className="panel">
            <h3>Put the numbers to work.</h3>
            <p>Compare rental coverage, estimate a flip’s project margin, and understand leverage constraints.</p>
            <Link className="button" href="/calculators">Open deal calculators</Link>
          </div>
          <div className="panel faq">
            <h3>Common questions</h3>
            {FAQS.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </aside>
      </main>
    </>
  );
}
