import { PortalApplication } from "@/components/PortalApplication";
import { lastSignedDraft, openPortalDraft } from "@/lib/application-links";
import { requireUser } from "@/lib/auth";
import { readBook } from "@/lib/book-store";
import { draftForAccount, draftFromLoan, draftFromQuote, repeatDraft } from "@/lib/borrower-application";
import { recentQuoteFor } from "@/lib/lead-store";
import { isDemoEmail } from "@/lib/deploy";
import { earlierLoans } from "@/lib/repeat-borrower";

export const metadata = { title: "Apply for a loan" };
export const dynamic = "force-dynamic";

/**
 * A repeat borrower's next application starts from their last signed one (or, for a loan the team entered, from the loan
 * itself): the one they picked with "New loan on another property", or the newest.
 */
async function repeatStart(user: { id: string; name: string; email: string; phone?: string | null }, from?: string) {
  const mine = earlierLoans((await readBook()).book.deals, user.id).sort((a, b) => b.closingDate.localeCompare(a.closingDate));
  if (!mine.length) return null;
  const picked = mine.find((deal) => deal.id === from);
  const signed = await lastSignedDraft(picked ? [picked.id] : mine.map((deal) => deal.id));
  const source = (signed && mine.find((deal) => deal.id === signed.dealId)) || picked || mine[0];
  return { draft: signed ? repeatDraft(signed.draft) : draftFromLoan(source, user), from: { loanNumber: source.loanNumber, address: source.address } };
}

// The borrower picks up their application where they left it, or starts one with what their account and earlier loans say.
export default async function Apply({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser();
  const { from } = await searchParams;
  if (isDemoEmail(user.email)) return <PortalApplication initial={draftForAccount(user)} startStep={0} savedAt={null} from={from} />;
  const open = await openPortalDraft(user.id);
  if (open) return <PortalApplication initial={open.draft} startStep={open.row.step} savedAt={open.row.savedAt?.toISOString() ?? null} />;
  const start = await repeatStart(user, from);
  if (start) return <PortalApplication initial={start.draft} startStep={0} savedAt={null} startedFrom={start.from} />;
  // A new borrower who saved a quote first starts from it: the property and the numbers they already gave.
  const quote = await recentQuoteFor(user.email).catch(() => null);
  if (quote) return <PortalApplication initial={{ ...draftFromQuote(quote), contact: draftForAccount(user).contact }} startStep={0} savedAt={null} fromQuote={`${quote.address.street}, ${quote.address.city}`} />;
  return <PortalApplication initial={draftForAccount(user)} startStep={0} savedAt={null} />;
}
