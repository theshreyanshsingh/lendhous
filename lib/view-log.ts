// The files partners' and buyers' people have opened (docs/competitor-gaps-2026-11-09.md, rank 24): who, from which firm,
// which file on which loan, when, and whether its copy was watermarked. From the audit log, which records every open.
import { readField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { documentNameContext } from "@/lib/uploads";

export type FileOpen = { at: string; person: string; firm: string; file: string; dealId?: string; watermarked?: boolean };

/** The last 90 days of opens by these accounts, newest first. */
export async function holderOpens(accounts: { id: string; name: string; firm: string }[], days = 90): Promise<FileOpen[]> {
  if (!accounts.length) return [];
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const events = await prisma.auditEvent.findMany({ where: { action: "document.opened", actorId: { in: [...byId.keys()] }, createdAt: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 300 });
  const documents = await prisma.document.findMany({ where: { id: { in: [...new Set(events.map((event) => event.entityId))] } }, select: { id: true, originalName: true } });
  const names = new Map(documents.map((document) => [document.id, readField(document.originalName, documentNameContext(document.id))]));
  return events.map((event) => {
    const account = byId.get(event.actorId ?? "")!;
    const after = (event.after ?? {}) as { dealId?: string; firm?: string; watermarked?: boolean };
    return { at: event.createdAt.toISOString(), person: account.name, firm: after.firm || account.firm, file: names.get(event.entityId) ?? "A file since removed", dealId: after.dealId, watermarked: after.watermarked };
  });
}
