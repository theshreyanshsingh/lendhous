import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { readField } from "@/lib/crypto";
import { canOpenFile } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { notDeleted, prisma } from "@/lib/prisma";
import { getBytes } from "@/lib/storage";
import { attachmentName, documentNameContext, fileHeaders } from "@/lib/uploads";

/** Opens a stored loan file for someone allowed to see it. Every open is logged. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.accountStatus !== "APPROVED") return new NextResponse("Sign in to open this file.", { status: 401 });
  const { id } = await params;
  const document = await prisma.document.findFirst({ where: { id, ...notDeleted } });
  // The same answer whether the file doesn't exist or isn't theirs, so nobody can test for files.
  const refused = () => new NextResponse("File not found.", { status: 404 });
  if (!document) return refused();
  const { book } = await readBook();
  if (!canOpenFile(book, user, document.ownerId, await permissionCheck(user))) return refused();
  const view = new URL(request.url).searchParams.get("view");
  // A thumbnail is a glance at a job site photo on a draw. Opening it, like opening any other file, is what gets logged.
  if (view !== "thumb" || document.documentType !== "draw_photo") await audit({ actorId: user.id, action: "document.opened", entityType: "Document", entityId: document.id, after: { dealId: document.ownerId } });
  const name = attachmentName(readField(document.originalName, documentNameContext(document.id)));
  // Files are encrypted in storage, so they always come through here rather than from a signed link to the bucket.
  return new NextResponse(new Uint8Array(await getBytes(document.storageKey)), { headers: fileHeaders(document.mime, name, Boolean(view)) });
}
