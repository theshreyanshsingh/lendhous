import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteMobileMenu } from "@/components/site-mobile-menu";
import { PROGRAMS } from "@/lib/site-content";
import { NO_CONTACT, telHref, type SiteContact } from "@/lib/site-contact";

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

/** The site's footer. `contact` is what an owner set in Settings (lib/site-contact.ts); blank details aren't shown. */
export function SiteFooter({ contact = NO_CONTACT }: { contact?: SiteContact }) {
  return (
    <footer>
      <div className="footer-top">
        <Link className="brand" href="/">LendHous<span className="brand-period">.</span></Link>
        <p>Real estate investment financing.</p>
      </div>
      <h2 className="sr-only">Site links</h2>
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
          <Link href="/rates">Rates and leverage</Link>
          <Link href="/rewards">Borrower rewards</Link>
          <Link href="/florida">Florida counties</Link>
        </div>
        <div>
          <h3>GET STARTED</h3>
          <Link href="/start">Get a quote</Link>
          <Link href="/book">Book a call</Link>
          <Link href="/payoff">Request a payoff letter</Link>
          <Link href="/login">Portal login</Link>
        </div>
        <div data-testid="footer-contact">
          <h3>CONTACT</h3>
          {contact.phone && <a href={telHref(contact.phone)} data-testid="footer-phone">{contact.phone}</a>}
          {contact.email && <a href={`mailto:${contact.email}`} data-testid="footer-email">{contact.email}</a>}
          {contact.address && <address className="footer-address" data-testid="footer-address">{contact.address}</address>}
          <Link href="/contact">Contact us</Link>
        </div>
      </nav>
      <div className="footer-links">
        <span>© {new Date().getFullYear()} LendHous LLC{contact.nmlsId && <> · <span data-testid="footer-nmls">NMLS ID {contact.nmlsId}</span></>}</span>
        <nav className="footer-legal" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms of use</Link>
          <Link href="/disclosures">Disclosures &amp; licensing</Link>
          <Link href="/login">Client &amp; team portals</Link>
        </nav>
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
