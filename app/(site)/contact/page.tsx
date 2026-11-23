import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/site-chrome";
import { getSettings } from "@/lib/settings";
import { contactFrom, nmlsLookup, telHref } from "@/lib/site-contact";

export const metadata: Metadata = { title: "Contact", description: "Reach LendHous about a fix and flip, bridge, construction or DSCR rental loan in Florida: send a deal, book a call, or call or email the team." };
// What an owner set in Settings, as it is now.
export const dynamic = "force-dynamic";

const WAYS = [
  { href: "/start", title: "Send us a deal", text: "Describe the property and see indicative terms in a minute. A loan officer follows up, usually the same business day.", testid: "contact-start" },
  { href: "/book", title: "Book a call", text: "Pick a half hour with a loan officer, on Florida business days.", testid: "contact-book", booking: true },
  { href: "/payoff", title: "Request a payoff letter", text: "For a borrower, title company or closing attorney paying off a LendHous loan.", testid: "contact-payoff" },
  { href: "/login", title: "Already a client?", text: "Sign in to message your loan team, send documents and see where your loan stands.", testid: "contact-portal" },
];

export default async function Contact() {
  const settings = await getSettings().catch(() => null);
  const contact = settings ? contactFrom(settings) : contactFrom({});
  const booking = settings?.allowCallBooking !== false;
  const direct = Boolean(contact.phone || contact.email || contact.address);
  return (
    <>
      <PageHead eyebrow="CONTACT" title="Talk to LendHous." description="Send a deal, book a call, or reach the team directly. Business-purpose loans to investors and their LLCs." />
      <main className="content quote-layout" data-testid="contact-page">
        <div className="contact-ways">
          {WAYS.filter((way) => !way.booking || booking).map((way) => (
            <Link key={way.href} href={way.href} className="contact-way" data-testid={way.testid}>
              <b>{way.title}</b>
              <span>{way.text}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          ))}
        </div>
        <aside className="panel" data-testid="contact-direct">
          <div className="eyebrow">LENDHOUS LLC</div>
          {direct ? (
            <dl className="contact-details">
              {contact.phone && <><dt>Phone</dt><dd><a className="text-link" href={telHref(contact.phone)} data-testid="contact-phone">{contact.phone}</a></dd></>}
              {contact.email && <><dt>Email</dt><dd><a className="text-link" href={`mailto:${contact.email}`} data-testid="contact-email">{contact.email}</a></dd></>}
              {contact.address && <><dt>Mail</dt><dd><address data-testid="contact-address">{contact.address}</address></dd></>}
              {contact.nmlsId && <><dt>NMLS ID</dt><dd><a className="text-link" href={nmlsLookup(contact.nmlsId)} rel="noopener noreferrer" target="_blank">{contact.nmlsId}</a></dd></>}
            </dl>
          ) : (
            <p className="quote-small" data-testid="contact-forms-only">The quickest way to reach a loan officer is to <Link className="text-link" href="/start">send us your deal</Link>{booking ? <> or <Link className="text-link" href="/book">book a call</Link></> : null}.</p>
          )}
          <p className="quote-small">Please don&apos;t send Social Security numbers, bank details or ID documents by email. Once you apply, your loan&apos;s secure portal takes them.</p>
        </aside>
      </main>
    </>
  );
}
