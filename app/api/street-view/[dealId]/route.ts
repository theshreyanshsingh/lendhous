import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canOpenFile } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { streetViewImage, streetViewLocation } from "@/lib/street-view";

/** The Street View picture of a loan's property, for someone who can open that loan's files. */
export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in to see this.", { status: 401 });
  const { dealId } = await params;
  const refused = () => new NextResponse("Not found.", { status: 404 });
  const { book } = await readBook();
  if (!canOpenFile(book, user, dealId, await permissionCheck(user))) return refused();
  const deal = book.deals.find((item) => item.id === dealId)!;
  const picture = await streetViewImage(streetViewLocation(deal));
  if (!picture) return refused();
  return new NextResponse(picture.bytes, { headers: { "Content-Type": picture.type, "Cache-Control": "private, max-age=86400" } });
}
