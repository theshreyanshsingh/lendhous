import { audit } from "@/lib/audit";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { demoBook, serviceDay } from "@/lib/book";
import { firmOf } from "@/lib/book-access";
import { toCsv } from "@/lib/csv";
import { previousMonth, setInvestorFees, statementFor, statementRows, type Statement } from "@/lib/investor-statements";
import { freshSettings } from "@/lib/settings";
import { viewFor } from "@/lib/permissions";
import { statementPdf } from "@/lib/statement-pdf";
import { openStatement } from "@/lib/statement-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const send = async (statement: Statement, format: string, sample: boolean) => {
  const name = `lendhous-statement-${statement.month}${sample ? "-sample" : ""}`;
  if (format === "csv") return new Response(toCsv(statementRows(statement)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store" } });
  const pdf = await statementPdf(statement, process.env.LENDER_NAME || "LendHous", sample);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "private, no-store" } });
};

/**
 * One monthly statement, as a PDF or (?format=csv) a spreadsheet: for the partner or buyer it belongs to, or the team.
 * "demo" is a sample from the demo book (?type=partner or buyer), with no real figures.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The PDF's note on late fees follows the split in Settings.
  setInvestorFees({ lateFees: (await freshSettings()).lateFeesToInvestors === true });
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const format = query.get("format") ?? "pdf";
  if (id === "demo") {
    const book = demoBook();
    const type = query.get("type") === "buyer" ? "buyer" : "partner";
    return send(statementFor(book, { type, id: type === "buyer" ? book.buyerId : book.partnerId }, previousMonth(serviceDay(book))), format, true);
  }
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download statements.", { status: 401 });
  const found = await openStatement(id);
  const view = viewFor(user.roleCodes);
  const theirs = found && view === found.row.investorType && firmOf(user) === found.row.investorId;
  if (!found || !(theirs || (view === "admin" && (await hasPermission(user, "view_pipeline"))))) return new Response("Statement not found.", { status: 404 });
  await audit({ actorId: user.id, action: "statement.downloaded", entityType: "InvestorStatement", entityId: id, after: { month: found.row.month, format } });
  return send(found.statement, format, false);
}
