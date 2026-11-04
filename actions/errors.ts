"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Marks an error fixed. It comes back, counting again, if it happens again. */
export async function markErrorFixed(formData: FormData) {
  const actor = await requirePermission("manage_roles");
  const id = String(formData.get("id") || "");
  await prisma.errorEvent.updateMany({ where: { id }, data: { resolvedAt: new Date() } });
  await audit({ actorId: actor.id, action: "errors.marked_fixed", entityType: "ErrorEvent", entityId: id });
  revalidatePath("/admin/errors");
}
