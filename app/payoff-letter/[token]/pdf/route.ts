import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { demoLetter } from "@/lib/payoff-demo";
import { openPayoffLink } from "@/lib/payoff-links";
import { letterPdf } from "@/lib/payoff-pdf";
import { letterContent } from "@/lib/payoffs";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdf = (bytes: Buffer, reference: string) => new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="payoff-letter-${reference}.pdf"`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });

/** The newest letter on the request the emailed link belongs to, or an earlier one with ?n=. /payoff-letter/demo/pdf is the sample. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "demo") { const sample = demoLetter(); return pdf(await letterPdf(sample), sample.reference); }
  const link = await openPayoffLink(token);
  if (!link) return new NextResponse("This link has expired or isn't valid. Ask LendHous for a new payoff letter.", { status: 404 });
  if (!(await consumeRateLimit(`payoff-link:${link.request.id}`, 120, 60 * 60 * 1000))) return new NextResponse("Too many downloads at once. Wait a minute and try again.", { status: 429 });
  const number = Number(new URL(request.url).searchParams.get("n")) || link.letter.number;
  const letter = link.request.letters?.find((item) => item.number === number) ?? link.letter;
  await audit({ actorId: null, action: "payoff.letter_opened", entityType: "LoanBook", entityId: link.deal.id, after: { payoffId: link.request.id, number: letter.number, by: "payoff-link" } });
  const content = letterContent(link.deal, link.request, letter, process.env.LENDER_NAME || "LendHous");
  return pdf(await letterPdf(content), content.reference);
}
