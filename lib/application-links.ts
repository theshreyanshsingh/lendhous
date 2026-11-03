// The borrower application link's storage. The token is a random secret shown once; only its hash is kept. Who it went
// to, the form as filled so far and the signed copy are sealed with the record's own id, so a row copied over another
// won't open. One link works per loan or lead at a time: sending a new one turns the old one off.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ApplicationLink } from "@prisma/client";
import { completeDraft, LINK_DAYS, type AppDraft, type ConsentKey } from "./borrower-application";
import { encryptField, readField } from "./crypto";
import { prisma } from "./prisma";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const seal = (id: string, field: string, value: unknown) => encryptField(JSON.stringify(value), `ApplicationLink.${field}:${id}`);
const unseal = <T,>(id: string, field: string, stored: string): T => JSON.parse(readField(stored, `ApplicationLink.${field}:${id}`)) as T;

export type Recipient = { name: string; email: string };
export type Signature = { name: string; at: string; ip: string; userAgent: string; consents: Record<ConsentKey, boolean>; version: string; digest: string };
export type LinkState = "open" | "expired" | "signed" | "off";

export const stateOf = (row: Pick<ApplicationLink, "status" | "expiresAt">, now = new Date()): LinkState => (row.status === "signed" ? "signed" : row.status === "off" ? "off" : row.expiresAt.getTime() < now.getTime() ? "expired" : "open");

/** Makes a link and returns its address, once. Any earlier open link for the same loan or lead stops working. */
export async function createApplicationLink(input: { dealId?: string; leadId?: string; recipient: Recipient; officer: string; sentById: string; draft: AppDraft }, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const same = input.dealId ? { dealId: input.dealId } : { leadId: input.leadId };
  await prisma.applicationLink.updateMany({ where: { ...same, status: "open" }, data: { status: "off" } });
  await prisma.applicationLink.create({ data: { id, tokenHash: hashOf(token), dealId: input.dealId, leadId: input.leadId, recipient: seal(id, "recipient", input.recipient), officer: input.officer, sentById: input.sentById, draft: seal(id, "draft", input.draft), expiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000) } });
  return { id, url: `${origin()}/apply/${token}` };
}

/** What a link opens, or null if it's unknown. The state says whether it can still be filled in. */
export async function openApplicationLink(token: string) {
  if (!token || token.length > 100) return null;
  const row = await prisma.applicationLink.findUnique({ where: { tokenHash: hashOf(token) } });
  if (!row) return null;
  return { row, state: stateOf(row), recipient: unseal<Recipient>(row.id, "recipient", row.recipient), draft: completeDraft(row.draft ? unseal<unknown>(row.id, "draft", row.draft) : null) };
}

export async function saveDraft(id: string, draft: AppDraft, step: number, now = new Date()) {
  await prisma.applicationLink.update({ where: { id }, data: { draft: seal(id, "draft", draft), step, savedAt: now } });
}

export async function markSigned(id: string, draft: AppDraft, signature: Signature, dealId: string, now = new Date()) {
  await prisma.applicationLink.update({ where: { id }, data: { draft: seal(id, "draft", draft), status: "signed", signedAt: now, signature: seal(id, "signature", signature), dealId } });
}

export const digestOf = (draft: AppDraft) => createHash("sha256").update(JSON.stringify(draft)).digest("hex");

/** Where each lead's or loan's link stands, for the team's lists. Nothing sealed is opened except the recipient's name. */
export async function linkSummaries(where: { leadIds?: string[]; dealIds?: string[] }) {
  const rows = await prisma.applicationLink.findMany({ where: { OR: [...(where.leadIds?.length ? [{ leadId: { in: where.leadIds } }] : []), ...(where.dealIds?.length ? [{ dealId: { in: where.dealIds } }] : [])] }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({ id: row.id, leadId: row.leadId, dealId: row.dealId, state: stateOf(row), step: row.step, savedAt: row.savedAt?.toISOString() ?? null, signedAt: row.signedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), to: unseal<Recipient>(row.id, "recipient", row.recipient).name }));
}

/** The latest signed application on a loan: the full form and the signature record. */
export async function signedApplication(dealId: string) {
  const row = await prisma.applicationLink.findFirst({ where: { dealId, status: "signed" }, orderBy: { signedAt: "desc" } });
  if (!row?.signature) return null;
  return { id: row.id, draft: completeDraft(unseal<unknown>(row.id, "draft", row.draft)), signature: unseal<Signature>(row.id, "signature", row.signature), officer: row.officer };
}
