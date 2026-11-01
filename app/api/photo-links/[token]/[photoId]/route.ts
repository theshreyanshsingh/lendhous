import { NextResponse } from "next/server";
import { readField } from "@/lib/crypto";
import { openPhotoLink } from "@/lib/photo-links";
import { prisma } from "@/lib/prisma";
import { getBytes } from "@/lib/storage";
import { attachmentName, documentNameContext, fileHeaders } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** While a link is open, whoever holds it sees the photos sent through it, so they can come back. Nothing else on the loan. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; photoId: string }> }) {
  const { token, photoId } = await params;
  const link = await openPhotoLink(token);
  const refused = () => new NextResponse("File not found.", { status: 404 });
  if (link?.state !== "open" || !link.request.photos.some((photo) => photo.id === photoId)) return refused();
  const document = await prisma.document.findFirst({ where: { id: photoId, ownerId: link.deal.id, documentType: "draw_photo", OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] } });
  if (!document) return refused();
  const name = attachmentName(readField(document.originalName, documentNameContext(document.id)));
  return new NextResponse(new Uint8Array(await getBytes(document.storageKey)), { headers: fileHeaders(document.mime, name, true) });
}
