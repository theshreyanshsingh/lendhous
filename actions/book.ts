"use server";

import { createHash, randomUUID } from "crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { audit } from "@/lib/audit";
import { canUploadFile, docOf, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { sendAlerts } from "@/lib/book-alerts";
import { permissionCheck, readBook, runAction } from "@/lib/book-store";
import { hasPermission, requirePermission, requireUser } from "@/lib/auth";
import { encryptField } from "@/lib/crypto";
import type { Book, BookAction } from "@/lib/book";
import { isDemoEmail } from "@/lib/deploy";
import { prisma } from "@/lib/prisma";
import { borrowerFor, screenAutomatically } from "@/lib/loan-intake";
import { TEAM_ROLES, type TeamRole } from "@/lib/loan-team";
import { memberById, memberOf, teamCandidates } from "@/lib/loan-team-store";
import { DEMO_TEAM, type TeamMember } from "@/lib/mockData";
import { deliverPayoffLetter } from "@/lib/payoff-delivery";
import { fileProblem } from "@/lib/conditions";
import { isFinalDraw, partiesFor } from "@/lib/lien-law";
import { moveLeadPhotos, storePropertyPhoto } from "@/lib/property-photos";
import { viewFor } from "@/lib/permissions";
import { screenDeal } from "@/lib/sanctions-store";
import { screenFirm, type FirmKind } from "@/lib/firm-screening";
import { renewalProblem } from "@/lib/insurance";
import type { PolicyKind } from "@/lib/mockData";
import { SHOWCASE_TAG } from "@/lib/showcase-store";
import { servicingDate } from "@/lib/servicing";
import { consumeRateLimit } from "@/lib/rate-limit";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { attachmentName, documentNameContext, uploadProblem } from "@/lib/uploads";

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
  // New names on a loan are screened straight away, so a possible sanctions match surfaces before anyone works on it.
  const named = result.action.t === "submitApp" ? result.after.deals.find((deal) => !result.before.deals.some((old) => old.id === deal.id))?.id : result.action.t === "saveSponsor" ? result.action.dealId : undefined;
  const screened = named ? await screenAutomatically(named) : null;
  // A partner or buyer is screened as soon as it's saved, with whoever signs in for it, before any teaser or bid.
  const firmChecked = result.action.t === "saveFirm" ? await screenFirm(result.action.kind, result.action.id, viewer) : null;
  if (firmChecked && !("error" in firmChecked)) await sendAlerts(firmChecked.before, firmChecked.after, firmChecked.action);
  // A photo taken off the loan is retired as a file too, so it can't be opened from an old link.
  if (result.action.t === "removePropertyPhoto") await prisma.document.updateMany({ where: { id: result.action.photoId, ownerType: "LOAN", ownerId: result.action.dealId }, data: { deletedAt: new Date() } });
  // A payoff letter goes out the moment it's issued: the 10 days are about sending it, not writing it.
  const delivered = result.action.t === "issuePayoffLetter" ? await deliverPayoffLetter(result.action.payoffId) : null;
  return { book: scopeBook(screened ?? delivered ?? (firmChecked && !("error" in firmChecked) ? firmChecked.after : result.after), viewer) };
}

/** Screens a partner lender or loan buyer against the OFAC list now, as the person asking. */
export async function screenFirmNow(kind: FirmKind, firmId: string): Promise<BookReply> {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  if (!(await hasPermission(viewer, "route_capital")) && !(await hasPermission(viewer, "manage_capital")) && !(await hasPermission(viewer, "clear_ofac"))) return { error: "Your account can't screen firms." };
  if (kind !== "partner" && kind !== "buyer") return { error: "That request wasn't valid." };
  const result = await screenFirm(kind, firmId, viewer);
  if ("error" in result) return { error: result.error };
  await sendAlerts(result.before, result.after, result.action);
  return { book: scopeBook(result.after, viewer) };
}

/** Who a loan can be given to, and whether the viewer can give it (anyone can take an empty seat themselves). */
export async function loanTeamOptions(): Promise<{ members: TeamMember[]; canAssign: boolean; me: string }> {
  const viewer = await requirePermission("view_pipeline");
  const demo = isDemoEmail(viewer.email);
  return { members: demo ? DEMO_TEAM : await teamCandidates(), canAssign: await hasPermission(viewer, "assign_loans"), me: demo ? DEMO_TEAM.find((member) => member.email === viewer.email)?.id ?? "" : viewer.id };
}

/** Puts someone on a loan as its officer or processor, or takes them off. The person is looked up here, never sent. */
export async function assignLoan(dealId: string, role: TeamRole, userId: string | null): Promise<BookReply> {
  const viewer = await requirePermission("view_pipeline");
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  if (!TEAM_ROLES.includes(role)) return { error: "That request wasn't valid." };
  const deal = (await readBook()).book.deals.find((item) => item.id === dealId);
  if (!deal) return { error: "That loan no longer exists." };
  const takingOpenSeat = userId === viewer.id && !deal.team?.[role];
  if (!takingOpenSeat && !(await hasPermission(viewer, "assign_loans"))) return { error: "Your account can't assign loans. Ask an owner." };
  const member = userId ? (await teamCandidates()).find((item) => item.id === userId) : null;
  if (userId && !member) return { error: "That person can't work loans." };
  return perform(viewer, { t: "assignLoanTeam", dealId, role, member: member ?? null, by: viewer.name }, { trusted: true });
}

/** Screens a loan against the OFAC list now, as the person asking. */
export async function screenLoan(dealId: string): Promise<BookReply> {
  const viewer = await requirePermission("view_pipeline");
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  const deal = (await readBook()).book.deals.find((item) => item.id === dealId);
  if (!deal) return { error: "That loan no longer exists." };
  const screening = await screenDeal(deal, viewer.name);
  if ("error" in screening) return { error: screening.error };
  return perform(viewer, { t: "recordScreening", dealId, screening }, { trusted: true });
}

/** Every change a real account makes to the loan book comes through here. */
export async function dispatchBook(raw: unknown): Promise<BookReply> {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  const action = parseAction(raw);
  if (!action) return { error: "That request wasn't valid." };
  const reply = await perform(viewer, action);
  // The public home page keeps a copy of the recently funded list; showing or hiding a loan clears it.
  if (action.t === "setShowcase" && !reply.error) revalidateTag(SHOWCASE_TAG);
  return reply;
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
  // A photo of the property, from the borrower, their broker or staff. It's stored, then listed on the loan.
  if (form.get("propertyPhoto") === "1") {
    const stored = await storePropertyPhoto({ type: "LOAN", id: dealId }, file, viewer.id);
    if ("error" in stored) return { error: stored.error };
    await audit({ actorId: viewer.id, action: "document.uploaded", entityType: "Document", entityId: stored.id, after: { dealId, documentType: "property_photo" } });
    return { ...(await perform(viewer, { t: "addPropertyPhotos", dealId, photos: [stored], by: viewer.name }, { trusted: true })), documentId: stored.id };
  }
  // A lien waiver or the contractor's final affidavit for a draw that hasn't gone out yet (Fla. Stat. 713.20, 713.06).
  const drawId = String(form.get("drawId") || "");
  const waiverParty = String(form.get("waiverParty") || "");
  const affidavit = form.get("affidavit") === "1";
  const lienDraw = drawId ? book.draws.find((item) => item.id === drawId && item.dealId === dealId && item.status !== "funded" && item.status !== "rejected") : undefined;
  if (drawId && (!lienDraw || (!affidavit && !partiesFor(book.deals.find((item) => item.id === dealId)?.lienFile, "9999-12-31").some((party) => party.key === waiverParty)))) return { error: "That draw or lienor is no longer waiting for a waiver." };
  // A renewed insurance policy from the borrower (or the team for them): checked before the file is stored.
  const renewal = form.get("renewal") === "1" ? { kind: String(form.get("kind") || "") as PolicyKind, carrier: String(form.get("carrier") || "").trim().slice(0, 160), policy: String(form.get("policy") || "").trim().slice(0, 120), expiresOn: String(form.get("expiresOn") || "") } : null;
  if (renewal) {
    const deal = book.deals.find((item) => item.id === dealId);
    const refused = deal ? renewalProblem(deal, renewal, servicingDate(new Date())) : "That loan no longer exists.";
    if (refused) return { error: refused };
  }
  // A file for a condition: the borrower and their broker send only the borrower's; staff can send any (Spec B17).
  const conditionId = String(form.get("conditionId") || "");
  if (conditionId) {
    const condition = book.deals.find((item) => item.id === dealId)?.conditions?.find((item) => item.id === conditionId);
    const refused = fileProblem(condition, viewFor(viewer.roleCodes) !== "admin");
    if (refused) return { error: refused };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = uploadProblem(file.name, file.size, bytes);
  if (problem) return { error: problem };
  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `loans/${safeBasename(dealId)}/${id}.${ext}`;
  const mime = mimeFor(ext, file.type);
  const fileKeyId = await putBytes(key, bytes);
  await prisma.document.create({
    data: { id, ownerType: "LOAN", ownerId: dealId, documentType: docId || (renewal ? "insurance_renewal" : conditionId ? "condition" : lienDraw ? (affidavit ? "final_affidavit" : "lien_waiver") : "draw_photo"), originalName: encryptField(attachmentName(file.name), documentNameContext(id)), storageKey: key, fileKeyId, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), uploadedById: viewer.id },
  });
  await audit({ actorId: viewer.id, action: "document.uploaded", entityType: "Document", entityId: id, after: { dealId, documentType: docId || (renewal ? "insurance_renewal" : conditionId ? "condition" : lienDraw ? (affidavit ? "final_affidavit" : "lien_waiver") : "draw_photo"), size: bytes.length } });
  if (lienDraw) {
    const deal = book.deals.find((item) => item.id === dealId)!;
    const action: BookAction = affidavit ? { t: "affidavitReceived", drawId, fileName: attachmentName(file.name), documentId: id, by: viewer.name } : { t: "lienWaiverReceived", drawId, partyKey: waiverParty, kind: isFinalDraw(deal, lienDraw) ? "final" : "progress", fileName: attachmentName(file.name), documentId: id, by: viewer.name };
    return { ...(await perform(viewer, action, { trusted: true })), documentId: id };
  }
  if (renewal) return { ...(await perform(viewer, { t: "insuranceRenewal", dealId, ...renewal, fileName: attachmentName(file.name), documentId: id, by: viewer.name }, { trusted: true })), documentId: id };
  if (conditionId) return { ...(await perform(viewer, { t: "conditionFile", dealId, conditionId, fileName: attachmentName(file.name), documentId: id, by: viewer.name }, { trusted: true })), documentId: id };
  if (!docId) return { documentId: id };
  const reply = await perform(viewer, { t: "uploadDoc", dealId, docId, fileName: attachmentName(file.name), documentId: id }, { trusted: true });
  return { ...reply, documentId: id };
}

type NewLoan = { action: Extract<BookAction, { t: "submitApp" }>; clientEmail: string; invite: boolean; leadId?: string };

/** Links a loan to a borrower's account, inviting them if they don't have one yet. */
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
  const screened = await screenAutomatically(deal.id);
  await audit({ actorId: actor.id, action: "book.startLoan", entityType: "LoanBook", entityId: deal.id, after: { loanNumber: deal.loanNumber, leadId: input.leadId } });
  let latest = screened ?? result.after;
  // Whoever starts the loan is its loan officer until someone reassigns it.
  const officer = await runAction(actor, { t: "assignLoanTeam", dealId: deal.id, role: "officer", member: memberOf(actor), by: actor.name }, { trusted: true });
  if (!("error" in officer)) latest = officer.after;
  if (input.leadId) {
    const photos = await moveLeadPhotos(String(input.leadId), deal.id);
    const withPhotos = photos.length ? await runAction(actor, { t: "addPropertyPhotos", dealId: deal.id, photos, by: "Quote request" }, { trusted: true }) : null;
    if (withPhotos && !("error" in withPhotos)) latest = withPhotos.after;
    // A lead from a broker's referral link makes the loan the broker's, from the day the request came in.
    const lead = await prisma.lead.findFirst({ where: { id: String(input.leadId) }, select: { brokerId: true, createdAt: true } });
    if (lead?.brokerId) {
      const referred = await runAction(actor, { t: "referLoan", dealId: deal.id, brokerId: lead.brokerId, on: servicingDate(lead.createdAt) }, { trusted: true });
      if (!("error" in referred)) latest = referred.after;
    }
    const updated = await prisma.lead.updateMany({ where: { id: String(input.leadId) }, data: { loanId: deal.id, contactedAt: new Date() } });
    if (updated.count) revalidatePath("/admin/leads");
  }
  return { book: scopeBook(latest, actor), dealId: deal.id };
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
