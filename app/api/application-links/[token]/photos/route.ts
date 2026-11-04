import { NextResponse } from "next/server";
import { openApplicationLink } from "@/lib/application-links";
import { audit } from "@/lib/audit";
import { runAction } from "@/lib/book-store";
import { ownerOf, storePropertyPhoto } from "@/lib/property-photos";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** A photo of the property from the borrower filling in their application link. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return refuse("That photo is too large. The limit is 15 MB.", 413);
  const link = await openApplicationLink((await params).token);
  if (!link || link.state !== "open") return refuse("This link no longer works. Ask your loan officer for a new one.", 404);
  const owner = ownerOf(link.row);
  if (!owner) return refuse("This link can't take photos.", 400);
  if (!(await consumeRateLimit(`application-photos:${link.row.id}`, 100, 60 * 60 * 1000))) return refuse("Too many photos at once. Wait a while and try again.", 429);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return refuse("Choose a photo.", 400);
  const stored = await storePropertyPhoto(owner, file, null);
  if ("error" in stored) return refuse(stored.error, 400);
  await audit({ actorId: null, action: "document.uploaded", entityType: "Document", entityId: stored.id, after: { [owner.type === "LOAN" ? "dealId" : "leadId"]: owner.id, documentType: "property_photo", by: "application-link" } });
  if (owner.type === "LOAN") await runAction({ id: `application-link:${link.row.id}`, name: "Application link", roleCodes: [] }, { t: "addPropertyPhotos", dealId: owner.id, photos: [stored], by: "Borrower's application" }, { trusted: true });
  return NextResponse.json({ photo: { id: stored.id, name: stored.name } }, { headers: { "Cache-Control": "no-store" } });
}
