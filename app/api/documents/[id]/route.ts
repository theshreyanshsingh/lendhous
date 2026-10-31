import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { canOpenFile } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { notDeleted, prisma } from "@/lib/prisma";
import { getBytes, signedDownloadUrl } from "@/lib/storage";
import { attachmentName } from "@/lib/uploads";

/** Opens a stored loan file for someone allowed to see it. Every open is logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in to open this file.", { status: 401 });
  const { id } = await params;
  const document = await prisma.document.findFirst({ where: { id, ...notDeleted } });
  // The same answer whether the file doesn't exist or isn't theirs, so nobody can test for files.
  const refused = () => new NextResponse("File not found.", { status: 404 });
  if (!document) return refused();
  const { book } = await readBook();
  if (!canOpenFile(book, user, document.ownerId, await permissionCheck(user))) return refused();
  await audit({ actorId: user.id, action: "document.opened", entityType: "Document", entityId: document.id, after: { dealId: document.ownerId } });
  const name = attachmentName(document.originalName);
  const signed = await signedDownloadUrl(document.storageKey, name);
  if (signed) return NextResponse.redirect(signed);
  return new NextResponse(new Uint8Array(await getBytes(document.storageKey)), { headers: { "Content-Type": document.mime, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
