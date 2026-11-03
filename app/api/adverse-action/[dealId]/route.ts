import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { noticeContent, startAdverseAction } from "@/lib/adverse-action";
import { noticePdf } from "@/lib/adverse-action-pdf";
import { getCurrentUser } from "@/lib/auth";
import { demoBook } from "@/lib/book";
import { permissionCheck, readBook } from "@/lib/book-store";
import { evaluate } from "@/lib/engine";
import { viewFor } from "@/lib/permissions";
import { servicingDate } from "@/lib/servicing";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdf = (bytes: Buffer, name: string) => new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" } });

/**
 * A decline notice or statement of reasons as a PDF. Staff open it before it's sent, to check it, and after; the
 * borrower once it has gone to them. /api/adverse-action/demo is a sample for demo seats.
 */
export async function GET(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const kind = new URL(request.url).searchParams.get("kind") === "statement" ? "statement" : "notice";
  if (dealId === "demo") {
    const deal = demoBook().deals.find((item) => item.id === "d16")!;
    const action = { ...startAdverseAction(deal, { reason: "leverage" }, "2026-10-31", "2026-10-31T12:00:00Z"), reasons: ["Value of the collateral not sufficient for the loan amount requested", "Not enough verified cash to close and to hold in reserve"] };
    return pdf(await noticePdf({ ...noticeContent(deal, action, "notice", { name: "LendHous", address: "100 Sample Way, Fort Lauderdale, FL 33301 (FAKE)", phone: "(954) 555-0100" }, evaluate(deal.app).noteAmount, "2026-10-31"), sample: true }), "notice-of-action-sample");
  }
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in to open this letter.", { status: 401 });
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === dealId);
  const action = deal?.adverseAction;
  const sent = action?.[kind];
  // The same answer whether there's no letter or it isn't theirs.
  const refused = () => new NextResponse("Letter not found.", { status: 404 });
  if (!deal || !action || (kind === "statement" && !action.request)) return refused();
  const view = viewFor(user.roleCodes);
  const staff = view === "admin" && (await permissionCheck(user))("view_pipeline");
  if (!staff && !(view === "borrower" && deal.borrowerId === user.id && sent)) return refused();
  const settings = await getSettings();
  const lender = { name: process.env.LENDER_NAME || "LendHous", address: settings.lenderAddress || "[LendHous's mailing address: add it in Settings]", phone: settings.lenderPhone };
  await audit({ actorId: user.id, action: "adverse_action.opened", entityType: "LoanBook", entityId: deal.id, after: { kind } });
  return pdf(await noticePdf(noticeContent(deal, action, kind, lender, evaluate(deal.app).noteAmount, sent?.sentOn ?? servicingDate(new Date()))), `${kind === "notice" ? "notice-of-action" : "statement-of-reasons"}-${deal.loanNumber}`);
}
