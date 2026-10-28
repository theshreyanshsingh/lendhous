// Append-only audit trail (Spec v3 10.3): who, from where, which request, and the values before and after.
// Nothing in the app updates or deletes AuditEvent rows; a write-once export (S3 Object Lock) is a SOC 2 item.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestMeta } from "@/lib/request-meta";

// Values that must never land in the log even though they sit on audited records.
const SECRET_KEYS = /(password|secret|hash|hashes|token|Enc)$/i;

export function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (key, inner) => (key && SECRET_KEYS.test(key) ? "[redacted]" : inner)));
}

export async function audit(input: { actorId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }) {
  const meta = await requestMeta();
  await prisma.auditEvent.create({
    data: {
      actorId: input.actorId,
      actorIp: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: redact(input.before),
      after: redact(input.after),
    },
  });
}
