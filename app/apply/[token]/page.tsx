import { BorrowerApplication } from "@/components/BorrowerApplication";
import { Logo } from "@/components/logo";
import { openApplicationLink } from "@/lib/application-links";
import { ownerOf, photosOf } from "@/lib/property-photos";
import { blankDraft, LINK_DAYS } from "@/lib/borrower-application";

export const metadata = { title: "Your loan application", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// A preview for the team and the demo: it keeps everything in the browser and sends nothing.
function demoDraft() {
  const draft = blankDraft();
  draft.contact = { firstName: "Sam", lastName: "Sample", email: "sam.sample@example.com", phone: "(954) 555-0111" };
  draft.property.address = { street: "100 Sample Street", city: "Hollywood", state: "FL", zip: "33020", county: "Broward" };
  draft.loan = { ...draft.loan, purchasePrice: "300,000", rehab: "80,000", arv: "520,000" };
  return draft;
}

export default async function ApplicationLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "demo") return <BorrowerApplication token={null} initial={demoDraft()} startStep={0} savedAt={null} officer="Your LendHous loan officer" expiresAt={new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString()} />;
  const link = await openApplicationLink(token);
  if (!link || link.state !== "open") {
    const signed = link?.state === "signed";
    return (
      <div className="min-h-screen">
        <header className="border-b border-rule"><div className="mx-auto max-w-xl px-4 py-5"><Logo /></div></header>
        <main className="mx-auto max-w-xl px-4 py-12" data-testid="application-link-closed">
          <p className="eyebrow">Loan application</p>
          <h1 className="mt-3 text-3xl font-normal text-foreground">{signed ? "This application is already signed." : "This link is no longer open."}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{signed ? "Your loan officer has it. Sign in to the LendHous portal to follow your loan and upload documents." : "It may have expired or been replaced by a newer one. Ask your loan officer to send a new link. Anything you saved is kept."}</p>
        </main>
      </div>
    );
  }
  // Photos already sent on this link, or with the quote request it came from, so they show again after a reload.
  const owner = ownerOf(link.row);
  const photos = owner ? (await photosOf(owner)).map((photo) => ({ id: photo.id, name: photo.name, src: `/api/application-links/${token}/photos/${photo.id}` })) : [];
  return <BorrowerApplication token={token} initial={link.draft} startStep={link.row.step} savedAt={link.row.savedAt?.toISOString() ?? null} officer={link.row.officer} expiresAt={link.row.expiresAt.toISOString()} photos={photos} />;
}
