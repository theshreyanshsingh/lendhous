import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { readField } from "@/lib/crypto";
import { canOpenFile, firmOf } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { viewFor } from "@/lib/permissions";
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
  const allowed = await permissionCheck(user);
  // A lead's photos, sent with a quote request before there's a loan, are for the team that answers leads.
  if (document.ownerType === "LEAD") { if (viewFor(user.roleCodes) !== "admin" || !allowed("view_pipeline")) return refused(); }
  // A brokerage's own papers: for the brokerage, and the team that approves brokers.
  else if (document.ownerType === "BROKER") { if (!(viewFor(user.roleCodes) === "admin" ? allowed("manage_brokers") : viewFor(user.roleCodes) === "broker" && firmOf(user) === document.ownerId)) return refused(); }
  else {
    // The loan it was uploaded to, or another loan it's filed on: a copy carried over or reused from an earlier loan.
    const book = (await readBook()).book;
    const filedOn = book.deals.filter((deal) => deal.id !== document.ownerId && deal.docs.some((doc) => doc.documentId === document.id)).map((deal) => deal.id);
    if (![document.ownerId, ...filedOn].some((dealId) => canOpenFile(book, user, dealId, allowed))) return refused();
  }
  const view = new URL(request.url).searchParams.get("view");
  // A thumbnail is a glance at a photo on a draw or of the property. Opening it, like opening any other file, is what gets logged.
  if (view !== "thumb" || (document.documentType !== "draw_photo" && document.documentType !== "property_photo")) await audit({ actorId: user.id, action: "document.opened", entityType: "Document", entityId: document.id, after: { [document.ownerType === "LEAD" ? "leadId" : "dealId"]: document.ownerId } });
  const name = attachmentName(readField(document.originalName, documentNameContext(document.id)));
  // Files are encrypted in storage, so they always come through here rather than from a signed link to the bucket.
  return new NextResponse(new Uint8Array(await getBytes(document.storageKey)), { headers: fileHeaders(document.mime, name, Boolean(view)) });
}
