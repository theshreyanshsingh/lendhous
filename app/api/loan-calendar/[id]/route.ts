import { getCurrentUser } from "@/lib/auth";
import { scopedBook } from "@/lib/book-store";
import { icsFile, loanEvents } from "@/lib/calendar-file";
import { viewFor } from "@/lib/permissions";
import { servicingDate } from "@/lib/servicing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A loan's dates as a calendar file (lib/calendar-file.ts), for its borrower or the team. Served from a link rather than
 * made in the browser, so a phone opens it in its calendar app.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to add your loan's dates to your calendar.", { status: 401 });
  const view = viewFor(user.roleCodes);
  const deal = (await scopedBook(user)).deals.find((item) => item.id === id);
  if (!deal || !(view === "admin" || (view === "borrower" && deal.borrowerId === user.id))) return new Response("Loan not found.", { status: 404 });
  const events = loanEvents(deal, servicingDate(new Date()));
  if (!events.length) return new Response("This loan has no dates coming up.", { status: 404 });
  return new Response(icsFile(events, new Date().toISOString()), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="lendhous-${deal.loanNumber}.ics"`, "Cache-Control": "no-store" } });
}
