import { audit } from "@/lib/audit";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { demoBook, serviceDay } from "@/lib/book";
import { readBook } from "@/lib/book-store";
import { borrowerStatementPdf } from "@/lib/borrower-statement-pdf";
import { openBorrowerStatement } from "@/lib/borrower-statement-store";
import { borrowerStatementFor, type BorrowerStatement } from "@/lib/borrower-statements";
import { previousMonth } from "@/lib/investor-statements";
import { viewFor } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const send = async (statement: BorrowerStatement, sample: boolean) => {
  const pdf = await borrowerStatementPdf(statement, process.env.LENDER_NAME || "LendHous", sample ? "" : (await getSettings()).paymentInstructions, sample);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="lendhous-${statement.loanNumber}-${statement.month}${sample ? "-sample" : ""}.pdf"`, "Cache-Control": "private, no-store" } });
};

/**
 * One loan's monthly statement as a PDF: for the borrower it belongs to, or the team. "demo" is a sample from the demo
 * book (?deal= one of its funded loans), with no real figures.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "demo") {
    const book = demoBook();
    const deal = book.deals.find((item) => item.id === (new URL(request.url).searchParams.get("deal") ?? "d2"));
    const statement = deal && borrowerStatementFor(book, deal, previousMonth(serviceDay(book)));
    return statement ? send(statement, true) : new Response("No sample for that loan.", { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download statements.", { status: 401 });
  const found = await openBorrowerStatement(id);
  const view = viewFor(user.roleCodes);
  // The loan's borrower today, which may be an account linked after the statement was made.
  const theirs = found && view === "borrower" && (await readBook()).book.deals.find((deal) => deal.id === found.row.dealId)?.borrowerId === user.id;
  if (!found || !(theirs || (view === "admin" && ((await hasPermission(user, "view_pipeline")) || (await hasPermission(user, "service_loans")))))) return new Response("Statement not found.", { status: 404 });
  await audit({ actorId: user.id, action: "statement.downloaded", entityType: "BorrowerStatement", entityId: id, after: { month: found.row.month, dealId: found.row.dealId } });
  return send(found.statement, false);
}
