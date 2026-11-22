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
  // A lot bought from an owner who lives out of state: the closer confirms how it checked who's selling.
  sellerCheck: { done: null }, updates: [],
  moves: [{ id: "demo-move", from: "2026-11-06", to: "2026-11-12", party: "appraiser", reason: "The appraiser's visit moved to Monday, November 9. (FAKE)", at: "2026-11-02T15:00:00Z" }],
  // What the agreed terms say each lender line on the statement should be, for the closer to check theirs against.
  settlement: { open: true, expected: { loanAmount: 296_250, points: 5_925, lenderFees: 1_495, brokerFee: 0, interestReserve: 0, docStamps: 1_037.05, intangibleTax: 592.5 }, lines: [], entered: null, explained: false },
};

// The same file after funding, when the team asks for a title search before releasing a draw.
const DEMO_DRAW: TitleView = {
  ...DEMO, loanNumber: "LH-DEMO-1012", entity: "Notreal Builders LLC (FAKE)", address: "12 Example Ridge Way, Tampa 33602", noteAmount: 512_000, closingDate: "2026-07-18", status: "servicing_current", fileNumber: "ST-1012",
  items: DEMO.items.map((item) => ({ ...item, status: "accepted", fileName: item.fileName ?? `${item.name}.pdf` })),
  wire: { bankName: "Sample Bank (FAKE)", beneficiary: "Sample Title & Escrow (FAKE) Escrow Account", account: "•••• 4821", verified: true, enteredAt: "2026-07-14T15:00:00Z" },
  fundsReceived: { amount: 512_000, on: "2026-07-18", by: "Sample Title & Escrow (FAKE)", at: "2026-07-18T18:00:00Z" }, recording: { on: "2026-07-21", reference: "Instr. 2026-0123456 (FAKE)", by: "Sample Title & Escrow (FAKE)", at: "2026-07-21T16:00:00Z" }, funded: true,
  sellerCheck: null, moves: [], settlement: null,
  updates: [{ drawId: "demo-draw", askedAt: new Date(Date.now() - 86_400_000).toISOString(), amount: 120_000, since: "2026-07-21", answered: null }],
};

export default async function TitleLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "demo") return <TitlePortal token={null} initial={DEMO} expiresAt={new Date(Date.now() + TITLE_LINK_DAYS * 86_400_000).toISOString()} />;
  if (token === "demo-draw") return <TitlePortal token={null} initial={DEMO_DRAW} expiresAt={new Date(Date.now() + TITLE_LINK_DAYS * 86_400_000).toISOString()} />;
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
