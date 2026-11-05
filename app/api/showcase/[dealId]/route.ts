import { NextResponse } from "next/server";
import { readBook } from "@/lib/book-store";
import { notDeleted, prisma } from "@/lib/prisma";
import { PROPERTY_PHOTO } from "@/lib/property-photos";
import { showcasePhoto } from "@/lib/showcase";
import { getBytes } from "@/lib/storage";

/** The first property photo of a loan its borrower chose to show on the website. Nothing else is ever served here. */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const refused = () => new NextResponse("Not found.", { status: 404 });
  const photoId = showcasePhoto((await readBook()).book.deals.find((deal) => deal.id === dealId));
  if (!photoId) return refused();
  const document = await prisma.document.findFirst({ where: { id: photoId, ownerType: "LOAN", ownerId: dealId, documentType: PROPERTY_PHOTO, ...notDeleted } });
  if (!document) return refused();
  return new NextResponse(new Uint8Array(await getBytes(document.storageKey)), { headers: { "Content-Type": document.mime, "Cache-Control": "public, max-age=600", "X-Content-Type-Options": "nosniff" } });
}
