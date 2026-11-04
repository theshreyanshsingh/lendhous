import { pdfOf } from "@/actions/letters";
import { audit } from "@/lib/audit";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { letterPdf } from "@/lib/letter-pdf";
import { DEFAULT_CONDITIONS } from "@/lib/letters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfReply = (pdf: Buffer, name: string) => new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "private, no-store" } });

/** A letter's PDF, for the borrower it's for or the team. "demo" is a sample with made-up figures. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "demo") {
    const origin = new URL(request.url).origin;
    const pdf = await letterPdf({ number: "PA-2026-0000", issuedOn: "2026-10-31", expiresOn: "2026-11-30", issuedBy: "Uma Underwriter (FAKE)", verifyUrl: `${origin}/verify/demo`, lender: process.env.LENDER_NAME || "LendHous", phone: "(954) 555-0100", sample: true, details: { kind: "pre_approval", name: "Alex Sample (FAKE)", email: "", entityName: "Sample Flips LLC (FAKE)", product: "fix_flip", maxPurchasePrice: 400_000, maxLoan: 340_000, propertyAddress: "", conditions: DEFAULT_CONDITIONS, validDays: 30 } });
    return pdfReply(pdf, "PA-2026-0000-sample");
  }
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download letters.", { status: 401 });
  const made = await pdfOf(id);
  if (!made || !(made.letter.row.borrowerId === user.id || (await hasPermission(user, "view_pipeline")))) return new Response("Letter not found.", { status: 404 });
  await audit({ actorId: user.id, action: "letter.downloaded", entityType: "ApprovalLetter", entityId: id });
  return pdfReply(made.pdf, made.letter.row.number);
}
