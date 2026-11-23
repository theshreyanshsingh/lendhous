import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { readField } from "@/lib/crypto";
import { canOpenFile, firmOf } from "@/lib/book-access";
import { permissionCheck, readBook } from "@/lib/book-store";
import { viewFor } from "@/lib/permissions";
import { notDeleted, prisma } from "@/lib/prisma";
import { getBytes } from "@/lib/storage";
import { attachmentName, byteRange, documentNameContext, fileHeaders } from "@/lib/uploads";
import { stampLine, watermarkPdf } from "@/lib/watermark";

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
  const view = viewFor(user.roleCodes);
  // A partner's or buyer's copy of a PDF carries who opened it and when (lib/watermark.ts).
  let holderFirm: string | null = null;
  // A lead's photos, sent with a quote request before there's a loan, are for the team that answers leads.
  if (document.ownerType === "LEAD") { if (view !== "admin" || !allowed("view_pipeline")) return refused(); }
  // A brokerage's own papers: for the brokerage, and the team that approves brokers.
  else if (document.ownerType === "BROKER") { if (!(view === "admin" ? allowed("manage_brokers") : view === "broker" && firmOf(user) === document.ownerId)) return refused(); }
  else {
    // The loan it was uploaded to, or another loan it's filed on: a copy carried over or reused from an earlier loan.
    const book = (await readBook()).book;
    const filedOn = book.deals.filter((deal) => deal.id !== document.ownerId && deal.docs.some((doc) => doc.documentId === document.id)).map((deal) => deal.id);
    if (![document.ownerId, ...filedOn].some((dealId) => canOpenFile(book, user, dealId, allowed))) return refused();
    // A team note's file is the team's; a message's file is for the people on the thread, not the loan's partners or buyers.
    if (document.documentType === "note_file" && view !== "admin") return refused();
    if (document.documentType === "message_file" && (view === "partner" || view === "buyer")) return refused();
    if (view === "partner" || view === "buyer") holderFirm = (view === "partner" ? book.partners : book.buyers).find((firm) => firm.id === firmOf(user))?.name ?? "";
  }
  const shown = new URL(request.url).searchParams.get("view");
  const name = attachmentName(readField(document.originalName, documentNameContext(document.id)));
  // Files are encrypted in storage, so they always come through here rather than from a signed link to the bucket.
  let bytes = new Uint8Array(await getBytes(document.storageKey));
  let watermarked: boolean | undefined;
  if (holderFirm !== null && document.mime === "application/pdf") {
    const stamped = await watermarkPdf(bytes, stampLine(user.name, holderFirm, new Date()));
    watermarked = Boolean(stamped);
    if (stamped) bytes = new Uint8Array(stamped);
  }
  // A thumbnail is a glance at a photo on a draw or of the property. Opening it, like opening any other file, is what gets logged.
  // A video's later pieces, as a player asks for them, are the same open.
  const continuing = document.mime.startsWith("video/") && /^bytes=[1-9]/.test(request.headers.get("range") ?? "");
  if (!continuing && (shown !== "thumb" || (document.documentType !== "draw_photo" && document.documentType !== "property_photo"))) await audit({ actorId: user.id, action: "document.opened", entityType: "Document", entityId: document.id, after: { [document.ownerType === "LEAD" ? "leadId" : "dealId"]: document.ownerId, ...(holderFirm !== null ? { firm: holderFirm, ...(watermarked !== undefined ? { watermarked } : {}) } : {}) } });
  // Safari and iPhones play a video only when they can ask for it in pieces.
  const range = document.mime.startsWith("video/") ? byteRange(request.headers.get("range"), bytes.length) : null;
  if (range) return new NextResponse(bytes.subarray(range.start, range.end + 1), { status: 206, headers: { ...fileHeaders(document.mime, name, Boolean(shown)), "Accept-Ranges": "bytes", "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`, "Content-Length": String(range.end - range.start + 1) } });
  return new NextResponse(bytes, { headers: { ...fileHeaders(document.mime, name, Boolean(shown)), ...(document.mime.startsWith("video/") ? { "Accept-Ranges": "bytes" } : {}) } });
}
