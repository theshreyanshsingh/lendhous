import { getCurrentUser } from "@/lib/auth";
import { canOpenFile } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { isFinalDraw, partiesFor } from "@/lib/lien-law";
import { viewFor } from "@/lib/permissions";
import { servicingDate } from "@/lib/servicing";
import { waiverFields } from "@/lib/waiver-forms";
import { waiverPdf } from "@/lib/waiver-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A statutory lien waiver filled in for one lienor on one draw (lib/waiver-forms.ts), for the loan's borrower to send the
 * lienor or the team to send it themselves. `?party=` is the lienor: the contractor, or a notice to owner's id.
 */
export async function GET(request: Request, { params }: { params: Promise<{ drawId: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new Response("Sign in to get the form.", { status: 401 });
  const { drawId } = await params;
  const { book } = await readBook();
  const draw = book.draws.find((item) => item.id === drawId);
  const deal = draw ? book.deals.find((item) => item.id === draw.dealId) : undefined;
  const view = viewFor(user.roleCodes);
  const allowed = await permissionCheck(user);
  // The loan's borrower and the team that handles draws; nobody else.
  if (!draw || !deal || !(view === "admin" ? canOpenFile(book, user, deal.id, allowed) : view === "borrower" && deal.borrowerId === user.id)) return new Response("Draw not found.", { status: 404 });
  const today = servicingDate(new Date());
  const party = partiesFor(deal.lienFile, today).find((item) => item.key === new URL(request.url).searchParams.get("party"));
  if (!party) return new Response("That lienor isn't on this draw.", { status: 404 });
  const kind = isFinalDraw(deal, draw) ? "final" : "progress";
  const pdf = await waiverPdf(waiverFields(deal, draw, party, kind, draw.requestedAt.slice(0, 10)), deal.loanNumber);
  const name = `${kind === "final" ? "final" : "progress"}-lien-waiver-${party.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "lienor"}.pdf`;
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
