import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { leadForPhotoKey, storePropertyPhoto } from "@/lib/property-photos";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A photo of the property, sent by the browser that just sent a quote request, with the key it was given. One photo at a
 * time, pictures only, and only for a couple of hours after the request.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return refuse("That photo is too large. The limit is 15 MB.", 413);
  const meta = await requestMeta();
  if (!(await consumeRateLimit(`lead-photos:${meta.ipAddress}`, 60, 60 * 60 * 1000))) return refuse("Too many photos from this connection. Try again in an hour.", 429);
  const form = await request.formData().catch(() => null);
  const lead = await leadForPhotoKey(String(form?.get("key") || ""));
  if (!lead) return refuse("This request can't take more photos. Send them to your loan officer.", 403);
  const file = form?.get("file");
  if (!(file instanceof File)) return refuse("Choose a photo.", 400);
  const stored = await storePropertyPhoto({ type: "LEAD", id: lead.id }, file, null);
  if ("error" in stored) return refuse(stored.error, 400);
  await audit({ actorId: null, action: "document.uploaded", entityType: "Document", entityId: stored.id, after: { leadId: lead.id, documentType: "property_photo", by: "quote-request" } });
  return NextResponse.json({ photo: { id: stored.id, name: stored.name } }, { headers: { "Cache-Control": "no-store" } });
}
