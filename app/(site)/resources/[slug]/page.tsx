import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/site-chrome";
import { GUIDES } from "@/lib/site-content";

export const generateStaticParams = () => GUIDES.map((guide) => ({ slug: guide.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: GUIDES.find((guide) => guide.slug === slug)?.title };
}

export default async function InvestorGuide({ params }: Props) {
  const { slug } = await params;
  const guide = GUIDES.find((item) => item.slug === slug);
  if (!guide) notFound();
  return (
    <>
      <PageHead eyebrow={guide.eyebrow} title={guide.title} description={guide.summary} />
      <main className="content">
        <article className="article">
          {guide.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              <p>{section.body}</p>
            </section>
          ))}
          {guide.further && (
            <p className="fine">Further reading: <a href={guide.further.href} target="_blank" rel="noreferrer">{guide.further.label}</a>. {guide.further.note}</p>
          )}
          <div className="note">Educational information only. Program definitions and requirements vary; confirm the terms that apply to your transaction.</div>
          <div className="actions">
            <Link className="button" href="/calculators">Explore the calculators</Link>
            <Link className="text-link" href="/resources">All resources</Link>
          </div>
        </article>
      </main>
    </>
  );
}
