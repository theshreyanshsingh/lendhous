"use server";

import { createHash, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { canUploadFile, docOf, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { sendAlerts } from "@/lib/book-alerts";
import { permissionCheck, readBook, runAction } from "@/lib/book-store";
import { requirePermission, requireUser } from "@/lib/auth";
import type { Book, BookAction } from "@/lib/book";
import { isDemoEmail } from "@/lib/deploy";
import { inviteMember } from "@/lib/members";
import { accessFor } from "@/lib/member-rules";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { attachmentName, uploadProblem } from "@/lib/uploads";

export type BookReply = { book?: Book; error?: string };

/** The entity an action is about, for the audit log. */
function subjectOf(action: BookAction) {
  if ("dealId" in action) return action.dealId;
  if (action.t === "bid") return action.bid.dealId;
  if ("drawId" in action) return action.drawId;
  if ("payoffId" in action) return action.payoffId;
  if ("saleId" in action) return action.saleId;
  if ("offerId" in action) return action.offerId;
  if ("bidId" in action) return action.bidId;
  return action.t;
}

async function perform(viewer: Viewer, action: BookAction, options: { trusted?: boolean } = {}): Promise<BookReply> {
  const result = await runAction(viewer, action, options);
  if ("error" in result) return { error: result.error, book: scopeBook((await readBook()).book, viewer) };
  // Message text and application details stay in the record; the log says who did what to which loan.
  await audit({ actorId: viewer.id, action: `book.${result.action.t}`, entityType: "LoanBook", entityId: subjectOf(result.action) });
  await sendAlerts(result.before, result.after, result.action);
  return { book: scopeBook(result.after, viewer) };
}

/** Every change a real account makes to the loan book comes through here. */
export async function dispatchBook(raw: unknown): Promise<BookReply> {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  const action = parseAction(raw);
  if (!action) return { error: "That request wasn't valid." };
  return perform(viewer, action);
}

export async function refreshBook(): Promise<Book | null> {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return null;
  return scopeBook((await readBook()).book, viewer);
}

/** Stores a loan document or a draw photo, then records it. The file goes in first, so a record never points at nothing. */
export async function uploadLoanFile(form: FormData): Promise<BookReply & { documentId?: string }> {
  const viewer = await requireUser();
  if (!(await consumeRateLimit(`upload:${viewer.id}`, 60, 60 * 60 * 1000))) return { error: "Too many uploads. Wait a while and try again." };
  const dealId = String(form.get("dealId") || "");
  const docId = String(form.get("docId") || "");
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a file." };
  const { book } = await readBook();
  const allowed = await permissionCheck(viewer);
  if (!canUploadFile(book, viewer, dealId, allowed)) return { error: "Your account can't upload to this loan." };
  const doc = docId ? docOf(book, dealId, docId) : undefined;
  if (docId && !doc) return { error: "That document is no longer on this loan." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = uploadProblem(file.name, file.size, bytes);
  if (problem) return { error: problem };
  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `loans/${safeBasename(dealId)}/${id}.${ext}`;
  const mime = mimeFor(ext, file.type);
  await putBytes(key, bytes, mime);
  await prisma.document.create({
    data: { id, ownerType: "LOAN", ownerId: dealId, documentType: docId || "draw_photo", originalName: attachmentName(file.name), storageKey: key, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), uploadedById: viewer.id },
  });
  await audit({ actorId: viewer.id, action: "document.uploaded", entityType: "Document", entityId: id, after: { dealId, documentType: docId || "draw_photo", size: bytes.length } });
  if (!docId) return { documentId: id };
  const reply = await perform(viewer, { t: "uploadDoc", dealId, docId, fileName: attachmentName(file.name), documentId: id }, { trusted: true });
  return { ...reply, documentId: id };
}

type NewLoan = { action: Extract<BookAction, { t: "submitApp" }>; clientEmail: string; invite: boolean; leadId?: string };

/** Links a loan to a borrower's account, inviting them if they don't have one yet. */
async function borrowerFor(actor: Awaited<ReturnType<typeof requirePermission>>, name: string, email: string, invite: boolean) {
  const address = email.trim().toLowerCase();
  if (!address) return { id: undefined };
  const found = await prisma.user.findUnique({ where: { email: address } });
  if (found && !found.deletedAt) return { id: found.id };
  if (!invite) return { id: undefined };
  const result = await inviteMember(actor, { name, email: address, title: "", roles: ["BORROWER"], permissions: accessFor(["BORROWER"]) });
  if ("error" in result) return { error: result.error };
  return { id: (await prisma.user.findUniqueOrThrow({ where: { email: address } })).id };
}

/** Staff start a loan for a client, from scratch or from a website brief. */
export async function startLoan(input: NewLoan): Promise<BookReply & { dealId?: string }> {
  const actor = await requirePermission("view_pipeline");
  const action = parseAction(input.action);
  if (!action || action.t !== "submitApp") return { error: "That request wasn't valid." };
  const name = action.client?.name?.trim() ?? "";
  if (!name) return { error: "Enter the borrower's name." };
  const link = await borrowerFor(actor, name, String(input.clientEmail ?? ""), Boolean(input.invite));
  if (link.error) return { error: link.error };
  const result = await runAction(actor, { ...action, client: { name, borrowerId: link.id }, source: input.leadId ? "website_lead" : "staff" });
  if ("error" in result) return { error: result.error };
  const deal = result.after.deals.find((item) => !result.before.deals.some((old) => old.id === item.id))!;
  await audit({ actorId: actor.id, action: "book.startLoan", entityType: "LoanBook", entityId: deal.id, after: { loanNumber: deal.loanNumber, leadId: input.leadId } });
  if (input.leadId) {
    const updated = await prisma.lead.updateMany({ where: { id: String(input.leadId) }, data: { loanId: deal.id, contactedAt: new Date() } });
    if (updated.count) revalidatePath("/admin/leads");
  }
  return { book: scopeBook(result.after, actor), dealId: deal.id };
}

/** Gives a loan that has no portal account one, so the borrower can sign in and see it. */
export async function inviteBorrower(dealId: string, email: string): Promise<BookReply> {
  const actor = await requirePermission("view_pipeline");
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === dealId);
  if (!deal) return { error: "That loan no longer exists." };
  const link = await borrowerFor(actor, deal.borrowerName, String(email ?? ""), true);
  if (link.error) return { error: link.error };
  if (!link.id) return { error: "Enter their email address." };
  const account = await prisma.user.findUniqueOrThrow({ where: { id: link.id } });
  return perform(actor, { t: "linkBorrower", dealId, borrowerId: account.id, borrowerName: deal.borrowerName }, { trusted: true });
}
