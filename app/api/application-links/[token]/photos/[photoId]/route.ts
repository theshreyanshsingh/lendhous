import { NextResponse } from "next/server";
import { openApplicationLink } from "@/lib/application-links";
import { runAction } from "@/lib/book-store";
import { notDeleted, prisma } from "@/lib/prisma";
import { ownerOf, PROPERTY_PHOTO, removeAnonymousPhoto } from "@/lib/property-photos";
import { getBytes } from "@/lib/storage";
import { fileHeaders } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string; photoId: string }> };
const missing = () => new NextResponse("Photo not found.", { status: 404 });

async function photoFor(token: string, photoId: string) {
  const link = await openApplicationLink(token);
  const owner = link && link.state === "open" ? ownerOf(link.row) : null;
  if (!link || !owner) return null;
  const document = await prisma.document.findFirst({ where: { id: photoId, ownerType: owner.type, ownerId: owner.id, documentType: PROPERTY_PHOTO, ...notDeleted } });
  return document ? { link, owner, document } : null;
}

/** Shows one of this application's photos back to the person filling it in, while the link is open. */
export async function GET(_request: Request, { params }: Context) {
  const { token, photoId } = await params;
  const found = await photoFor(token, photoId);
  if (!found) return missing();
  return new NextResponse(new Uint8Array(await getBytes(found.document.storageKey)), { headers: { ...fileHeaders(found.document.mime, "photo", true), "Referrer-Policy": "no-referrer" } });
}

/** Takes one away again: only photos sent without an account, so nothing the team added. */
export async function DELETE(_request: Request, { params }: Context) {
  const { token, photoId } = await params;
  const found = await photoFor(token, photoId);
  if (!found || !(await removeAnonymousPhoto(found.owner, photoId))) return missing();
  if (found.owner.type === "LOAN") await runAction({ id: `application-link:${found.link.row.id}`, name: "Application link", roleCodes: [] }, { t: "removePropertyPhoto", dealId: found.owner.id, photoId }, { trusted: true });
  return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
}
