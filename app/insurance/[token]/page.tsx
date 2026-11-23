import { Logo } from "@/components/logo";
import { InsurancePortal } from "@/components/InsurancePortal";
import { AGENT_LINK_DAYS, clauseFor, type AgentView } from "@/lib/insurance-agent";
import { openInsuranceLink } from "@/lib/insurance-links";

export const metadata = { title: "Insurance file", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// A preview for the team, borrowers and the demo. It keeps everything in the browser and sends nothing.
const DEMO: AgentView = {
  loanNumber: "LH-DEMO-1008", insured: "Sample Flips LLC (FAKE)", address: "8 Placeholder Pine Ct, Coral Springs 33065", noteAmount: 280_500, closingDate: "2026-11-10", maturity: "2027-11-10", funded: false,
  clause: clauseFor("LH-DEMO-1008"), kinds: ["hazard", "builders_risk", "windstorm", "flood"],
  needs: [
    { key: "property", label: "Hazard or builder's risk", note: "The building, for at least the loan amount or its replacement cost.", state: "needed" },
    { key: "wind", label: "Windstorm", note: "Included in the property policy, or a separate wind policy (often Citizens in coastal counties).", state: "needed" },
    { key: "flood", label: "Flood", note: "Zone AE is a special flood hazard area, so flood insurance is required.", state: "needed" },
  ],
  onFile: [], sent: [], sentBy: "Pat Processor at LendHous",
};

export default async function InsuranceLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "demo") return <InsurancePortal token={null} initial={DEMO} expiresAt={new Date(Date.now() + AGENT_LINK_DAYS * 86_400_000).toISOString()} />;
  const link = await openInsuranceLink(token);
  if (!link || link.state !== "open") {
    return (
      <div className="min-h-screen">
        <header className="border-b border-rule"><div className="mx-auto max-w-xl px-4 py-5"><Logo /></div></header>
        <main className="mx-auto max-w-xl px-4 py-12" data-testid="insurance-link-closed">
          <p className="eyebrow">Insurance file</p>
          <h1 className="mt-3 text-3xl font-normal text-foreground">This link is no longer open.</h1>
          <p className="mt-3 text-sm text-muted-foreground">It may have expired, been replaced by a newer one, or the loan has closed out. Ask LendHous or the borrower for a new link. Anything you already sent is safe.</p>
        </main>
      </div>
    );
  }
  return <InsurancePortal token={token} initial={link.view} expiresAt={link.deal.insuranceLink!.expiresAt} />;
}
