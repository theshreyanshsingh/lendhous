"use server";

import { createHash, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission, requireUser } from "@/lib/auth";
import { firmOf, scopeBook } from "@/lib/book-access";
import { readBook, runAction } from "@/lib/book-store";
import { AGREEMENT_VERSION, applicationProblem, type BrokerApplication } from "@/lib/brokers";
import { encryptField } from "@/lib/crypto";
import { isDemoEmail } from "@/lib/deploy";
import { notifyTeam } from "@/lib/email";
import type { Book } from "@/lib/book";
import type { Broker } from "@/lib/mockData";
import { viewFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { screenNames } from "@/lib/sanctions-store";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { allTaxForms } from "@/lib/tax-form-store";
import { attachmentName, documentNameContext, uploadProblem } from "@/lib/uploads";

const subjectsOf = (application: Pick<BrokerApplication, "legalName" | "principals">) => [
  { name: application.legalName, role: "entity" as const },
  ...application.principals.map((name) => ({ name, role: "principal" as const })),
];

/**
 * A brokerage signs the broker agreement from its portal, with its formation documents and good standing. The firm and its
 * owners are screened against the OFAC list, and the owners are told it's waiting for approval.
 */
export async function applyAsBroker(form: FormData): Promise<{ book?: Book; error?: string }> {
  const user = await requireUser();
  if (viewFor(user.roleCodes) !== "broker") return { error: "Only a broker's account signs the broker agreement." };
  if (isDemoEmail(user.email)) return { error: "The demo brokerage is already approved." };
  if (!(await consumeRateLimit(`broker-apply:${user.id}`, 10, 60 * 60 * 1000))) return { error: "Too many tries. Wait a while and try again." };
  const firm = firmOf(user);
  const text = (key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);
  const input = {
    legalName: text("legalName", 160), entityState: text("entityState", 2).toUpperCase(), nmls: text("nmls", 12).replace(/\D/g, ""), license: text("license", 80), signedName: text("signedName", 120),
    principals: text("principals", 1000).split(/[\n,;]+/).map((name) => name.trim()).filter(Boolean).slice(0, 8),
  };
  const problem = applicationProblem(input, form.get("agreed") === "1");
  if (problem) return { error: problem };
  const { book } = await readBook();
  const had = book.brokers.find((item) => item.id === firm);
  // The files: required the first time, and replaced when sent again.
  const docs: NonNullable<Broker["docs"]> = [];
  for (const kind of ["articles", "good_standing"] as const) {
    const file = form.get(kind);
    if (!(file instanceof File) || !file.size) {
      if (!had?.docs?.some((item) => item.kind === kind)) return { error: kind === "articles" ? "Attach the brokerage's articles of organization or incorporation." : "Attach a certificate of good standing dated in the last 90 days." };
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const refused = uploadProblem(file.name, file.size, bytes);
    if (refused) return { error: refused };
    const id = randomUUID();
    const ext = extensionOf(file.name)!;
    const key = `brokers/${safeBasename(firm)}/${id}.${ext}`;
    const fileKeyId = await putBytes(key, bytes);
    await prisma.document.create({ data: { id, ownerType: "BROKER", ownerId: firm, documentType: `broker_${kind}`, originalName: encryptField(attachmentName(file.name), documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), uploadedById: user.id } });
    docs.push({ kind, documentId: id, fileName: attachmentName(file.name), at: new Date().toISOString() });
  }
  const meta = await requestMeta();
  const application: BrokerApplication = { ...input, agreementVersion: AGREEMENT_VERSION, signedAt: new Date().toISOString(), ip: meta.ipAddress };
  const screened = await screenNames(subjectsOf(application), "Broker application");
  const result = await runAction(user, { t: "brokerApplied", brokerId: firm, application, docs: [...(had?.docs ?? []).filter((item) => !docs.some((fresh) => fresh.kind === item.kind)), ...docs], ...("error" in screened ? {} : { screening: screened }) }, { trusted: true });
  if ("error" in result) return { error: result.error };
  await audit({ actorId: user.id, action: "broker.agreement_signed", entityType: "Broker", entityId: firm, after: { version: AGREEMENT_VERSION, screening: "error" in screened ? "not run" : screened.status } });
  if (had?.status !== "approved") {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    await notifyTeam(`Broker waiting for approval: ${application.legalName}`, `${application.legalName} (${application.entityState}) signed the broker agreement${application.nmls ? `, NMLS ${application.nmls}` : ""}.\n\nOFAC: ${"error" in screened ? screened.error : screened.status === "clear" ? "clear" : "a possible match to review"}.\n\nReview it: ${origin}/admin/brokers`, "broker.applied").catch((error) => console.error("[lendhous-brokers] could not alert the team:", error));
  }
  revalidatePath("/admin/broker");
  return { book: scopeBook(result.after, user) };
}

/** Screens a brokerage and its owners again, after the list was downloaded or a name changed. */
export async function screenBroker(brokerId: string): Promise<{ book?: Book; error?: string }> {
  const actor = await requirePermission("manage_brokers");
  const { book } = await readBook();
  const broker = book.brokers.find((item) => item.id === brokerId);
  if (!broker?.application) return { error: "This brokerage hasn't signed the broker agreement." };
  const screened = await screenNames(subjectsOf(broker.application), actor.name);
  if ("error" in screened) return { error: screened.error };
  const result = await runAction(actor, { t: "brokerScreened", brokerId, screening: screened }, { trusted: true });
  if ("error" in result) return { error: result.error };
  return { book: scopeBook(result.after, actor) };
}

/** Which brokers have a W-9 (or W-8) on file, for the approval checklist. Only the kind and the day, never the form. */
export async function brokerTaxForms(): Promise<Record<string, { kind: "w9" | "w8"; signedAt: string }>> {
  await requirePermission("manage_brokers");
  const forms = await allTaxForms();
  const out: Record<string, { kind: "w9" | "w8"; signedAt: string }> = {};
  for (const [key, form] of forms) if (form && key.startsWith("broker:")) out[key.slice("broker:".length)] = { kind: form.kind, signedAt: form.signedAt };
  return out;
}
