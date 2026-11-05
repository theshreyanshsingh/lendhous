import { NextResponse } from "next/server";
import { channelOf, QUOTE_STEPS, refOf, type QuoteStep } from "@/lib/quote-funnel";
import { countQuoteStep } from "@/lib/quote-funnel-store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

/** Counts a visitor starting a quote or seeing their terms. It takes no personal data and stores none. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { step?: string; channel?: string; ref?: string } | null;
  const step = QUOTE_STEPS.find((item) => item === body?.step) as QuoteStep | undefined;
  if (!step) return new NextResponse(null, { status: 400 });
  const meta = await requestMeta();
  const shared = /^(unknown|127\.|::1$|::ffff:127\.)/.test(meta.ipAddress);
  if (await consumeRateLimit(`quote-event:${meta.ipAddress}`, shared ? 2000 : 60, 60 * 60 * 1000)) await countQuoteStep(step, channelOf(body?.channel), refOf(body?.ref)).catch((error) => console.error("[lendhous-quotes] could not count a quote step:", error));
  return new NextResponse(null, { status: 204 });
}
