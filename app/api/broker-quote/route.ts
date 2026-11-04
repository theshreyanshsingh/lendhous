import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { firmOf } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { readBook } from "@/lib/book-store";
import { brokerQuoteContent } from "@/lib/broker-quote";
import { canSendDeals } from "@/lib/brokers";
import { isDemoEmail } from "@/lib/deploy";
import { viewFor } from "@/lib/permissions";
import { loadPricing } from "@/lib/pricing-store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { servicingDate } from "@/lib/servicing";
import { termSheetPdf } from "@/lib/term-sheet-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A quote PDF with the brokerage's name, for an approved broker to give their client. The numbers are worked out here on
 * today's pricing from what the form sent; nothing is saved.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in first.", { status: 401 });
  if (viewFor(user.roleCodes) !== "broker") return new NextResponse("Only brokers make quotes here.", { status: 403 });
  if (!(await consumeRateLimit(`broker-quote:${user.id}`, 60, 60 * 60 * 1000))) return new NextResponse("Too many quotes. Wait a while.", { status: 429 });
  const demo = isDemoEmail(user.email);
  const firm = demo ? { name: "Demo Brokerage (FAKE)", status: "approved" as const } : (await readBook()).book.brokers.find((item) => item.id === firmOf(user));
  if (!canSendDeals(firm)) return new NextResponse("LendHous approves a brokerage before it makes quotes.", { status: 403 });
  const body = (await request.json().catch(() => null)) as { app?: unknown; client?: unknown; points?: unknown; address?: unknown } | null;
  const client = String(body?.client ?? "").trim().slice(0, 120);
  const address = String(body?.address ?? "").trim().slice(0, 200);
  const points = Math.min(5, Math.max(0, Number(body?.points) || 0));
  // The same checks as a submitted application, so the PDF prices only a well-formed loan.
  const checked = parseAction({ t: "submitApp", app: body?.app, address: address || "-", city: "-", zip: "-", entityName: "-", exitStrategy: "-" });
  if (!checked || checked.t !== "submitApp" || !client) return new NextResponse("Add the client's name and the loan's numbers.", { status: 400 });
  await loadPricing();
  const { pricingVersion: _version, termRate: _rate, termPoints: _points, repeat: _repeat, ...app } = checked.app;
  const content = brokerQuoteContent({ app, broker: firm!.name, client, brokerPoints: points, address, today: servicingDate(new Date()) });
  await audit({ actorId: user.id, action: "broker.quote_made", entityType: "Broker", entityId: demo ? "demo" : firmOf(user), after: { product: app.product } });
  const bytes = await termSheetPdf({ ...content, ...(demo ? { sample: true } : {}) });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="lendhous-quote.pdf"`, "Cache-Control": "no-store" } });
}
