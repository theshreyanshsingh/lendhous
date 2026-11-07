import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/site-chrome";
import { bookedTimes } from "@/lib/call-store";
import { callSlots } from "@/lib/calls";
import { getSettings } from "@/lib/settings";
import { BookCall } from "./book-call";

export const metadata: Metadata = { title: "Book a Call", description: "Pick a time for a LendHous loan officer to call you about a fix and flip, bridge, construction or DSCR rental loan in Florida." };
// The open times change as people book them.
export const dynamic = "force-dynamic";

export default async function Book() {
  const open = (await getSettings()).allowCallBooking !== false;
  const days = open ? callSlots(new Date(), await bookedTimes().catch(() => [])) : [];
  return (
    <>
      <PageHead eyebrow="TALK TO A LOAN OFFICER" title="Pick a time, and we'll call you." description="Half an hour with a LendHous loan officer about your deal, your quote or your loan. Times are Eastern, on Florida business days." />
      <main className="content quote-layout">
        {open && days.length ? <BookCall days={days} /> : <div className="panel" data-testid="book-closed"><p>Booking a call isn&apos;t open right now. <Link className="text-link" href="/start">Request a quote</Link> and a loan officer will call you, usually the same business day.</p></div>}
        <aside className="panel" style={{ position: "sticky", top: 24 }}>
          <div className="eyebrow">BEFORE THE CALL</div>
          <ol className="quote-next">
            <li><b>Have the property in mind.</b> The address, the price, and the work you plan.</li>
            <li><b>Know your exit.</b> Selling, renting or refinancing, and roughly when.</li>
            <li><b>Want numbers first?</b> <Link className="text-link" href="/start">Get indicative terms</Link> in a minute, with no contact details needed.</li>
          </ol>
          <p className="quote-small">Business-purpose loans to investors and their LLCs only.</p>
        </aside>
      </main>
    </>
  );
}
