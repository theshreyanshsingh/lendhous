import { Logo } from "@/components/logo";
import { TitlePortal } from "@/components/TitlePortal";
import { TITLE_LINK_DAYS, type TitleView } from "@/lib/closing";
import { openTitleLink } from "@/lib/title-links";

export const metadata = { title: "Closing file", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// A preview for the team and the demo. It keeps everything in the browser and sends nothing.
const DEMO: TitleView = {
  loanNumber: "LH-DEMO-1015", borrower: "Emery Testcase (FAKE)", entity: "Testcase Holdings LLC (FAKE)", address: "16 Mock Canal Rd, Fort Lauderdale 33301", noteAmount: 296_250, closingDate: "2026-11-12", status: "clear_to_close", sentBy: "Pat Processor at LendHous", company: "Sample Title & Escrow (FAKE)", fileNumber: "ST-1015",
  items: [
    { id: "closing-title", name: "Title commitment", status: "accepted", stage: null, fileName: "Commitment ST-1015.pdf" },
    { id: "closing-cpl", name: "Closing protection letter (CPL)", status: "requested", stage: null, fileName: null },
    { id: "closing-settlement", name: "Settlement statement, approved by both sides", status: "uploaded", stage: null, fileName: "Settlement draft 2.pdf" },
    { id: "closing-loan-docs", name: "Signed loan documents", status: "requested", stage: "funding", fileName: null },
    { id: "closing-recorded", name: "Recorded mortgage", status: "requested", stage: "post_close", fileName: null },
  ],
  wire: null, fundsReceived: null, recording: null, funded: false,
};

export default async function TitleLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "demo") return <TitlePortal token={null} initial={DEMO} expiresAt={new Date(Date.now() + TITLE_LINK_DAYS * 86_400_000).toISOString()} />;
  const link = await openTitleLink(token);
  if (!link || link.state !== "open") {
    return (
      <div className="min-h-screen">
        <header className="border-b border-rule"><div className="mx-auto max-w-xl px-4 py-5"><Logo /></div></header>
        <main className="mx-auto max-w-xl px-4 py-12" data-testid="title-link-closed">
          <p className="eyebrow">Closing file</p>
          <h1 className="mt-3 text-3xl font-normal text-foreground">This link is no longer open.</h1>
          <p className="mt-3 text-sm text-muted-foreground">It may have expired, been replaced by a newer one, or the loan has closed out. Ask your LendHous contact for a new link. Anything you already sent is safe.</p>
        </main>
      </div>
    );
  }
  return <TitlePortal token={token} initial={link.view} expiresAt={link.deal.titleLink!.expiresAt} />;
}
