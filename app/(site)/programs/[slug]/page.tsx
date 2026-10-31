import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/site-chrome";
import { PROGRAMS } from "@/lib/site-content";

export const dynamicParams = false;
export const generateStaticParams = () => PROGRAMS.map((program) => ({ slug: program.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: PROGRAMS.find((program) => program.slug === slug)?.title };
}

export default async function ProgramGuide({ params }: Props) {
  const { slug } = await params;
  const program = PROGRAMS.find((item) => item.slug === slug);
  if (!program) notFound();
  return (
    <>
      <PageHead eyebrow={program.eyebrow} title={program.title} description={program.summary} />
      <main className="content program-detail">
        <article>
          <h2>Designed around your strategy.</h2>
          <p>{program.audience}</p>
          <h3>How the structure works</h3>
          <p>{program.structure}</p>
          <h3>What to prepare</h3>
          <ul>{program.prepare.map((item) => <li key={item}>{item}</li>)}</ul>
          <h3>What to consider</h3>
          <p>{program.consider}</p>
          <Link className="text-link" href="/programs">← Compare all programs</Link>
        </article>
        <aside className="stack" style={{ alignSelf: "start" }}>
          <div className="panel">
            <div className="eyebrow">YOUR NEXT STEP</div>
            <h3>A better conversation starts with the details.</h3>
            <p>Prepare the property, budget, experience, and exit plan for a financing discussion.</p>
            <Link className="button" href="/start">Prepare your deal brief</Link>
            <p className="fine">Not an application or a commitment to lend. Availability, terms, and required documentation are subject to confirmation and underwriting.</p>
          </div>
          <Link className="panel" href="/calculators">
            <h3>Work through the numbers ↗</h3>
            <p>Explore project costs, leverage, and rental coverage with adjustable assumptions.</p>
          </Link>
        </aside>
      </main>
    </>
  );
}
