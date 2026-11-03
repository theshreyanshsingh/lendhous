import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { permissionCheck, readBook } from "@/lib/book-store";
import { letterPdf } from "@/lib/payoff-pdf";
import { letterContent } from "@/lib/payoffs";
import { viewFor } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A payoff letter's PDF for staff and the borrower it's about. ?n= picks an earlier letter on the request. Every open is logged. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in to open this letter.", { status: 401 });
  const { id } = await params;
  const { book } = await readBook();
  const payoff = book.payoffs.find((item) => item.id === id);
  const deal = payoff && book.deals.find((item) => item.id === payoff.dealId);
  const number = Number(new URL(request.url).searchParams.get("n")) || payoff?.letters?.length || 0;
  const letter = payoff?.letters?.find((item) => item.number === number);
  // The same answer whether the letter doesn't exist or isn't theirs.
  const refused = () => new NextResponse("Letter not found.", { status: 404 });
  if (!payoff || !deal || !letter) return refused();
  const view = viewFor(user.roleCodes);
  const allowed = await permissionCheck(user);
  if (!(view === "admin" ? allowed("service_loans") || allowed("view_pipeline") : view === "borrower" && deal.borrowerId === user.id)) return refused();
  await audit({ actorId: user.id, action: "payoff.letter_opened", entityType: "LoanBook", entityId: deal.id, after: { payoffId: payoff.id, number } });
  const content = letterContent(deal, payoff, letter, process.env.LENDER_NAME || "LendHous");
  return new NextResponse(new Uint8Array(await letterPdf(content)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="payoff-letter-${content.reference}.pdf"`, "Cache-Control": "no-store" } });
}
