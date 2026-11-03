import { details, placesKey, suggest } from "@/lib/places";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relays address lookups to Google with the server's key. Public, because the quote form and the application link have
// no sign-in, so it's rate limited per visitor and only ever returns addresses.
export async function GET(request: Request) {
  // Off without a key: the field stops asking and people type the address.
  if (!placesKey()) return Response.json({ enabled: false });
  const meta = await requestMeta();
  if (!(await consumeRateLimit(`places:${meta.ipAddress}`, 300, 60 * 60 * 1000))) return Response.json({ error: "Too many lookups. Type the address instead." }, { status: 429 });
  const url = new URL(request.url);
  const session = (url.searchParams.get("session") ?? "").slice(0, 64);
  try {
    if (url.searchParams.get("kind") === "details") {
      const id = (url.searchParams.get("id") ?? "").slice(0, 300);
      if (!id) return Response.json({ error: "Missing place." }, { status: 400 });
      return Response.json({ address: await details(id, session) });
    }
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (q.length < 4) return Response.json({ suggestions: [] });
    return Response.json({ suggestions: await suggest(q, session) });
  } catch (error) {
    console.error("[lendhous-places]", error);
    return Response.json({ error: "Address lookup isn't working right now. Type the address instead." }, { status: 502 });
  }
}
