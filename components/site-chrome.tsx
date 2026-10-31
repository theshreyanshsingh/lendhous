import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteMobileMenu } from "@/components/site-mobile-menu";
import { PROGRAMS } from "@/lib/site-content";

/** The public site's header. Portal login leads to the sign-in page, which opens the signed-in panel under /admin. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="LendHous home">LendHous<span className="brand-period">.</span></Link>
      <nav aria-label="Main navigation">
        <Link href="/programs">Loan programs</Link>
        <Link href="/about">About</Link>
        <Link href="/resources">Resources</Link>
        <Link href="/calculators">Calculators</Link>
      </nav>
      <div className="nav-actions">
        <Link className="portal-link" href="/login" data-testid="portal-login">Portal login</Link>
        <Link className="button small" href="/start">Let’s talk <ArrowRight size={18} aria-hidden="true" /></Link>
        <SiteMobileMenu />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="footer-top">
        <Link className="brand" href="/">LendHous<span className="brand-period">.</span></Link>
        <p>Real estate investment financing.</p>
      </div>
      <nav className="footer-nav" aria-label="Footer">
        <div>
          <h3>LOAN PROGRAMS</h3>
          {PROGRAMS.map((program) => <Link key={program.slug} href={`/programs/${program.slug}`}>{program.title}</Link>)}
        </div>
        <div>
          <h3>LEARN</h3>
          <Link href="/about">About</Link>
          <Link href="/resources">Investor resources</Link>
          <Link href="/calculators">Calculators</Link>
        </div>
        <div>
          <h3>GET STARTED</h3>
          <Link href="/start">Let’s talk</Link>
          <Link href="/login">Portal login</Link>
        </div>
      </nav>
      <div className="footer-links">
        <span>© {new Date().getFullYear()} LendHous LLC</span>
        <Link href="/disclosures">Disclosures &amp; privacy</Link>
        <Link href="/login">Client &amp; team portals</Link>
      </div>
      <p className="fine">Business-purpose investment property financing. All financing is subject to underwriting, eligibility, property review, and final approval. Program availability and terms vary. This website is not a commitment to lend.</p>
    </footer>
  );
}

export function PageHead({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <section className="page-head">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
