// Photos of a property someone wants a loan on: from the public quote form, the application link, or the borrower's
// portal. They're encrypted like every loan file. Before there's a loan they belong to the lead; when the loan starts
// they move to it, and the loan book lists them so the team and the borrower see them on the loan.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encryptField, readField } from "./crypto";
import { notDeleted, prisma } from "./prisma";
import { extensionOf, mimeFor, putBytes, safeBasename } from "./storage";
import { attachmentName, documentNameContext, photoProblem } from "./uploads";

export const PROPERTY_PHOTO = "property_photo";
/** At most this many per lead or loan: enough to show a property, not a place to keep files. */
export const MAX_PROPERTY_PHOTOS = 12;
/** How long after a quote request its browser can still send the photos. */
const PHOTO_KEY_HOURS = 2;

export type Owner = { type: "LEAD" | "LOAN"; id: string };
/** Whose photos an application link adds to: its loan, or the lead it was sent for until that becomes a loan. */
export const ownerOf = (row: { dealId: string | null; leadId: string | null }): Owner | null => (row.dealId ? { type: "LOAN", id: row.dealId } : row.leadId ? { type: "LEAD", id: row.leadId } : null);
export type StoredPhoto = { id: string; name: string; at: string };

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");

export async function photosOf(owner: Owner): Promise<StoredPhoto[]> {
  const rows = await prisma.document.findMany({ where: { ownerType: owner.type, ownerId: owner.id, documentType: PROPERTY_PHOTO, ...notDeleted }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({ id: row.id, name: readField(row.originalName, documentNameContext(row.id)), at: row.createdAt.toISOString() }));
}

/** Stores one photo, checked to be a picture and under the limit. uploadedById is null for someone without an account. */
export async function storePropertyPhoto(owner: Owner, file: File, uploadedById: string | null): Promise<{ error: string } | StoredPhoto> {
  const count = await prisma.document.count({ where: { ownerType: owner.type, ownerId: owner.id, documentType: PROPERTY_PHOTO, ...notDeleted } });
  if (count >= MAX_PROPERTY_PHOTOS) return { error: `That's the most photos we take here (${MAX_PROPERTY_PHOTOS}). Send others to your loan officer.` };
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = photoProblem(file.name, file.size, bytes);
  if (problem) return { error: problem };
  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `${owner.type === "LEAD" ? "leads" : "loans"}/${safeBasename(owner.id)}/${id}.${ext}`;
  const name = attachmentName(file.name);
  const fileKeyId = await putBytes(key, bytes);
  const row = await prisma.document.create({ data: { id, ownerType: owner.type, ownerId: owner.id, documentType: PROPERTY_PHOTO, originalName: encryptField(name, documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), uploadedById } });
  return { id, name, at: row.createdAt.toISOString() };
}

/** Takes away a photo someone without an account sent, from the same lead or loan. Staff uploads stay. */
export async function removeAnonymousPhoto(owner: Owner, id: string) {
  const { count } = await prisma.document.updateMany({ where: { id, ownerType: owner.type, ownerId: owner.id, documentType: PROPERTY_PHOTO, uploadedById: null, ...notDeleted }, data: { deletedAt: new Date() } });
  return count > 0;
}

/** When a lead becomes a loan, its photos go with it. Returns them, for the loan book. */
export async function moveLeadPhotos(leadId: string, dealId: string) {
  await prisma.document.updateMany({ where: { ownerType: "LEAD", ownerId: leadId, documentType: PROPERTY_PHOTO, ...notDeleted }, data: { ownerType: "LOAN", ownerId: dealId } });
  return photosOf({ type: "LOAN", id: dealId });
}

/** A key for the browser that just sent a quote request to send its photos with. Only the hash is kept. */
export async function issuePhotoKey(leadId: string) {
  const key = randomBytes(24).toString("base64url");
  await prisma.lead.update({ where: { id: leadId }, data: { photoKeyHash: hashOf(key), photoKeyExpiresAt: new Date(Date.now() + PHOTO_KEY_HOURS * 3_600_000) } });
  return key;
}

/** The lead a photo key belongs to, while it still works. */
export async function leadForPhotoKey(key: string) {
  if (!key || key.length > 100) return null;
  const lead = await prisma.lead.findFirst({ where: { photoKeyHash: hashOf(key), ...notDeleted }, select: { id: true, photoKeyExpiresAt: true } });
  return lead && lead.photoKeyExpiresAt && lead.photoKeyExpiresAt.getTime() > Date.now() ? lead : null;
}
