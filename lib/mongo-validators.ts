// MongoDB has no CHECK constraints or row-level security. Collection validators are the database-side guard Lendhous
// keeps instead (backend plan, "Option B mitigations"): the database itself rejects a write that breaks these rules,
// even if application code has a bug. `npm run db:indexes` and the release build apply them.
import type { PrismaClient } from "@prisma/client";

const NONE = (tag: string) => ({ $literal: `__none_${tag}` });
const orNone = (field: string, tag: string) => ({ $ifNull: [field, NONE(tag)] });
const isSet = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });

export const VALIDATORS: Record<string, Record<string, unknown>> = {
  // Spec v3 3.2: step-2 approver ≠ step-1 approver ≠ initiator, and nobody approves step 2 before step 1.
  Approval: {
    $expr: {
      $and: [
        { $ne: [orNone("$step1ApproverId", "1"), "$initiatorId"] },
        { $ne: [orNone("$step2ApproverId", "2"), "$initiatorId"] },
        { $ne: [orNone("$step2ApproverId", "2"), orNone("$step1ApproverId", "1")] },
        { $or: [{ $not: [isSet("$step2ApproverId")] }, isSet("$step1ApproverId")] },
      ],
    },
  },
};

export async function syncValidators(prisma: PrismaClient) {
  const present = (await prisma.$runCommandRaw({ listCollections: 1, nameOnly: true })) as { cursor?: { firstBatch?: { name: string }[] } };
  const names = new Set((present.cursor?.firstBatch ?? []).map((item) => item.name));
  for (const [collection, validator] of Object.entries(VALIDATORS)) {
    const options = { validator, validationLevel: "strict", validationAction: "error" };
    if (names.has(collection)) await prisma.$runCommandRaw({ collMod: collection, ...options } as never);
    else await prisma.$runCommandRaw({ create: collection, ...options } as never);
  }
  return Object.keys(VALIDATORS).length;
}
