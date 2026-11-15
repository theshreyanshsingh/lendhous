import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { readBook, runAction } from "@/lib/book-store";
import { isTitleDoc, titleView } from "@/lib/closing";
import { encryptField } from "@/lib/crypto";
import { notifyTeam } from "@/lib/email";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { checkPdf } from "@/lib/pdf-signals";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { servicingDate } from "@/lib/servicing";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { openTitleLink, titleActor } from "@/lib/title-links";
import { titleUpdateProblem } from "@/lib/title-updates";
import { attachmentName, documentNameContext, uploadProblem } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Stores one file from the title company on the loan, encrypted like every loan file, and checks a PDF's own record of how it was made. */
async function store(deal: Deal, file: File, bytes: Buffer, documentType: string, label: string) {
  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `loans/${safeBasename(deal.id)}/${id}.${ext}`;
  const name = attachmentName(file.name);
  const fileKeyId = await putBytes(key, bytes);
  await prisma.document.create({ data: { id, ownerType: "LOAN", ownerId: deal.id, documentType, originalName: encryptField(name, documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
  if (ext === "pdf") await runAction(titleActor(deal), { t: "recordFileCheck", dealId: deal.id, check: checkPdf(bytes, { documentId: id, fileName: name, label, at: new Date().toISOString() }) }, { trusted: true }).catch(() => null);
  return { id, name };
}

const dropped = (id: string) => prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });

/**
 * The title company answers a request to search the records since recording before a draw (lib/title-updates.ts):
 * nothing new, or what it found, with its search report if it has one.
 */
async function titleUpdate(deal: Deal, form: FormData, drawId: string) {
  const draw = (await readBook()).book.draws.find((item) => item.id === drawId && item.dealId === deal.id);
  if (!draw?.titleCheck?.asked) return refuse("LendHous hasn't asked for a search on that draw.", 400);
  const answer = { clean: form.get("clean") === "yes", through: String(form.get("through") || ""), found: String(form.get("found") || "").trim().slice(0, 1000) };
  const problem = titleUpdateProblem(deal, draw, answer, servicingDate(new Date()));
  if (problem) return refuse(problem, 400);
  const file = form.get("file");
  let stored: { id: string; name: string } | undefined;
  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const refused = uploadProblem(file.name, file.size, bytes);
    if (refused) return refuse(refused, 400);
    stored = await store(deal, file, bytes, "title_update", "Title search");
  }
  const saved = await runAction(titleActor(deal), { t: "recordTitleUpdate", drawId, updateId: `tu${randomUUID()}`, ...answer, ...(stored ? { fileName: stored.name, documentId: stored.id } : {}), by: titleActor(deal).name, via: "title" }, { trusted: true });
  if ("error" in saved) {
    if (stored) await dropped(stored.id);
    return refuse(saved.error, 409);
  }
  await audit({ actorId: null, action: "closing.title_update", entityType: "LoanBook", entityId: deal.id, after: { drawId, clean: answer.clean } });
  await notifyTeam(`Title search back: ${deal.loanNumber}`, answer.clean ? `${titleActor(deal).name} searched the records through ${answer.through} and found nothing new recorded against ${deal.address}. The draw's title hold is cleared.` : `${titleActor(deal).name} searched the records through ${answer.through} and found something recorded against ${deal.address}: ${answer.found}\n\nThe draw stays held until it's cleared. See the draw on the Draws page.`, "closing.title_update").catch(() => {});
  const after = saved.after.deals.find((item) => item.id === deal.id)!;
  return NextResponse.json({ view: titleView(after, evaluate(after.app).noteAmount, saved.after.draws) });
}

/**
 * The title company uploads one closing document: only the checklist's items, only on this loan. It lands as "uploaded"
 * for a processor to accept or reject on the Documents tab. The same link answers a title search before a draw.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return refuse("That file is too large. The limit is 15 MB.", 413);
  const link = await openTitleLink((await params).token);
  if (!link) return refuse("This link has expired or isn't valid. Ask LendHous for a new one.", 404);
  if (link.state !== "open") return refuse("This link has been turned off. Ask LendHous for a new one.", 410);
  if (!(await consumeRateLimit(`title-link:${link.deal.id}`, 300, 60 * 60 * 1000))) return refuse("Too many uploads at once. Wait a minute and try again.", 429);
  const form = await request.formData().catch(() => null);
  if (!form) return refuse("Choose a file.", 400);
  const updateFor = String(form.get("update") || "");
  if (updateFor) return titleUpdate(link.deal, form, updateFor);
  const file = form.get("file");
  const docId = String(form.get("docId") || "");
  if (!(file instanceof File)) return refuse("Choose a file.", 400);
  const doc = link.deal.docs.find((item) => item.id === docId);
  if (!doc || !isTitleDoc(docId)) return refuse("That isn't on this loan's closing checklist.", 400);
  if (doc.status === "accepted") return refuse("LendHous has already accepted this one. Ask them if it needs replacing.", 409);
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = uploadProblem(file.name, file.size, bytes);
  if (problem) return refuse(problem, 400);

  const { id, name } = await store(link.deal, file, bytes, docId, doc.name);
  const saved = await runAction(titleActor(link.deal), { t: "uploadDoc", dealId: link.deal.id, docId, fileName: name, documentId: id }, { trusted: true });
  if ("error" in saved) {
    await dropped(id);
    return refuse(saved.error, 409);
  }
  await audit({ actorId: null, action: "document.uploaded", entityType: "Document", entityId: id, after: { dealId: link.deal.id, by: "title-link", documentType: docId, size: bytes.length } });
  await notifyTeam(`Title uploaded: ${doc.name}, ${link.deal.loanNumber}`, `${titleActor(link.deal).name} uploaded the ${doc.name.toLowerCase()} for ${link.deal.borrowerName}'s closing. Accept or reject it on the loan's Documents tab.`, "closing.document").catch(() => {});
  const deal = saved.after.deals.find((item) => item.id === link.deal.id)!;
  return NextResponse.json({ view: titleView(deal, evaluate(deal.app).noteAmount, saved.after.draws) });
}
