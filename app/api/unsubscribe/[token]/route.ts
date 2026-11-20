import { unsubscribe } from "@/lib/unsubscribe-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A mail app's one-click unsubscribe (RFC 8058): a POST to the address in the campaign's List-Unsubscribe header. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const done = await unsubscribe(token);
  return new Response(done ? "Unsubscribed." : "That link isn't valid.", { status: done ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}

/** Someone who follows the address itself lands on the page that asks first. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return new Response(null, { status: 303, headers: { Location: `/unsubscribe/${encodeURIComponent(token)}` } });
}
