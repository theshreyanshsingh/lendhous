// Encrypts what was saved before encryption was switched on, and moves records to the newest key after a rotation.
// The app reads both forms, so this can run while it serves traffic, and running it again changes nothing.
import { encryptField, fieldKeys, fieldNeedsSealing, jsonNeedsSealing, openJson, readField, sealJson } from "@/lib/crypto";
import { rowContext } from "@/lib/book-store";
import { leadContext, SEALED_LEAD_FIELDS } from "@/lib/lead-store";
import { noticeContext } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { resealFile } from "@/lib/storage";
import { documentNameContext } from "@/lib/uploads";

const reseal = (stored: string, context: string) => encryptField(readField(stored, context), context);

export async function encryptStoredData() {
  const done = { records: 0, leads: 0, notices: 0, documentNames: 0, files: 0, missing: 0 };

  for (const row of await prisma.bookRecord.findMany()) {
    if (!jsonNeedsSealing(row.data)) continue;
    const context = rowContext(row.id);
    const sealed = sealJson(openJson(row.data, context), context);
    // Matching updatedAt leaves a newer save alone. The app encrypted that one itself.
    const { count } = await prisma.bookRecord.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { data: sealed } });
    done.records += count;
  }

  for (const lead of await prisma.lead.findMany()) {
    const changes = Object.fromEntries(SEALED_LEAD_FIELDS.filter((field) => fieldNeedsSealing(lead[field])).map((field) => [field, reseal(lead[field], leadContext(field, lead.id))]));
    if (!Object.keys(changes).length) continue;
    await prisma.lead.update({ where: { id: lead.id }, data: changes });
    done.leads += 1;
  }

  for (const notice of await prisma.notification.findMany({ select: { id: true, subject: true, body: true } })) {
    if (!fieldNeedsSealing(notice.subject) && !fieldNeedsSealing(notice.body)) continue;
    await prisma.notification.update({ where: { id: notice.id }, data: { subject: reseal(notice.subject, noticeContext("subject", notice.id)), body: reseal(notice.body, noticeContext("body", notice.id)) } });
    done.notices += 1;
  }

  // Reading a file back is the slow, costly part, so only files not yet under the current key are read.
  const current = fieldKeys()[0].id;
  for (const document of await prisma.document.findMany({ select: { id: true, originalName: true, storageKey: true, fileKeyId: true } })) {
    if (fieldNeedsSealing(document.originalName)) {
      await prisma.document.update({ where: { id: document.id }, data: { originalName: reseal(document.originalName, documentNameContext(document.id)) } });
      done.documentNames += 1;
    }
    if (document.fileKeyId === current) continue;
    try {
      const { changed, keyId } = await resealFile(document.storageKey);
      await prisma.document.update({ where: { id: document.id }, data: { fileKeyId: keyId } });
      if (changed) done.files += 1;
    } catch (error) {
      // One lost file must not stop the rest being protected. The count tells whoever ran this to look.
      done.missing += 1;
      console.error(`[lendhous-encrypt] could not encrypt the file for document ${document.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return done;
}
