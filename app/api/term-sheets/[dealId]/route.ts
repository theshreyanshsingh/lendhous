import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { demoBook } from "@/lib/book";
import { firmOf } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { viewFor } from "@/lib/permissions";
import { termSheetPdf } from "@/lib/term-sheet-pdf";
import { latestSheet, sheetContent } from "@/lib/term-sheets";
import { brandContact } from "@/lib/broker-program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdf = (bytes: Buffer, name: string) => new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" } });

/**
 * A term sheet's PDF. Staff open any version with ?v=; the borrower and their broker only the newest (Spec 13.2).
 * /api/term-sheets/demo is a sample from the FAKE demo book, for demo seats, whose records stay in the browser.
 */
export async function GET(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (dealId === "demo") {
    const deal = demoBook().deals.find((item) => item.id === "d18")!;
    return pdf(await termSheetPdf({ ...sheetContent(deal, latestSheet(deal)!), sample: true }), "term-sheet-sample");
  }
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in to open this term sheet.", { status: 401 });
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === dealId);
  const latest = deal && latestSheet(deal);
  const version = Number(new URL(request.url).searchParams.get("v")) || latest?.version || 0;
  const sheet = deal?.termSheets?.find((item) => item.version === version);
  // The same answer whether the term sheet doesn't exist or isn't theirs.
  const refused = () => new NextResponse("Term sheet not found.", { status: 404 });
  if (!deal || !sheet) return refused();
  const view = viewFor(user.roleCodes);
  const staff = view === "admin" && (await permissionCheck(user))("view_pipeline");
  const client = sheet === latest && ((view === "borrower" && deal.borrowerId === user.id) || (view === "broker" && deal.brokerId === firmOf(user)));
  if (!staff && !client) return refused();
  await audit({ actorId: user.id, action: "term_sheet.opened", entityType: "LoanBook", entityId: deal.id, after: { version } });
  // A broker's loan carries the brokerage's brand, when it has one, on the copy the borrower and broker download.
  const brand = book.brokers.find((item) => item.id === deal.brokerId)?.brand;
  const content = sheetContent(deal, sheet, process.env.LENDER_NAME || "LendHous");
  return pdf(await termSheetPdf(brand ? { ...content, presentedBy: { name: brand.name, contact: brandContact(brand) } } : content), `term-sheet-${deal.loanNumber}-v${version}`);
}
