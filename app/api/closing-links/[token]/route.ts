import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { runAction } from "@/lib/book-store";
import { isTitleDoc, titleView } from "@/lib/closing";
import { encryptField } from "@/lib/crypto";
import { notifyTeam } from "@/lib/email";
import { evaluate } from "@/lib/engine";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { openTitleLink, titleActor } from "@/lib/title-links";
import { attachmentName, documentNameContext, uploadProblem } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The title company uploads one closing document: only the checklist's items, only on this loan. It lands as "uploaded"
 * for a processor to accept or reject on the Documents tab, encrypted like every loan file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return refuse("That file is too large. The limit is 15 MB.", 413);
  const link = await openTitleLink((await params).token);
  if (!link) return refuse("This link has expired or isn't valid. Ask LendHous for a new one.", 404);
  if (link.state !== "open") return refuse("This link has been turned off. Ask LendHous for a new one.", 410);
  if (!(await consumeRateLimit(`title-link:${link.deal.id}`, 300, 60 * 60 * 1000))) return refuse("Too many uploads at once. Wait a minute and try again.", 429);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const docId = String(form?.get("docId") || "");
  if (!form || !(file instanceof File)) return refuse("Choose a file.", 400);
  const doc = link.deal.docs.find((item) => item.id === docId);
  if (!doc || !isTitleDoc(docId)) return refuse("That isn't on this loan's closing checklist.", 400);
  if (doc.status === "accepted") return refuse("LendHous has already accepted this one. Ask them if it needs replacing.", 409);
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = uploadProblem(file.name, file.size, bytes);
  if (problem) return refuse(problem, 400);

  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `loans/${safeBasename(link.deal.id)}/${id}.${ext}`;
  const name = attachmentName(file.name);
  const fileKeyId = await putBytes(key, bytes);
  await prisma.document.create({ data: { id, ownerType: "LOAN", ownerId: link.deal.id, documentType: docId, originalName: encryptField(name, documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
  const saved = await runAction(titleActor(link.deal), { t: "uploadDoc", dealId: link.deal.id, docId, fileName: name, documentId: id }, { trusted: true });
  if ("error" in saved) {
    await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    return refuse(saved.error, 409);
  }
  await audit({ actorId: null, action: "document.uploaded", entityType: "Document", entityId: id, after: { dealId: link.deal.id, by: "title-link", documentType: docId, size: bytes.length } });
  await notifyTeam(`Title uploaded: ${doc.name}, ${link.deal.loanNumber}`, `${titleActor(link.deal).name} uploaded the ${doc.name.toLowerCase()} for ${link.deal.borrowerName}'s closing. Accept or reject it on the loan's Documents tab.`, "closing.document").catch(() => {});
  const deal = saved.after.deals.find((item) => item.id === link.deal.id)!;
  return NextResponse.json({ view: titleView(deal, evaluate(deal.app).noteAmount) });
}
