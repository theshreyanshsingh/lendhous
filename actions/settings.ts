"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings, resetSettingsCache } from "@/lib/settings";

const clamp = (value: FormDataEntryValue | null, low: number, high: number, fallback: number) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

export async function saveSettings(formData: FormData) {
  const actor = await requirePermission("manage_roles");
  const before = await getSettings();
  const data = {
    requireStaffMfa: formData.get("requireStaffMfa") === "on",
    offerSampleData: formData.get("offerSampleData") === "on",
    staffIdleMinutes: clamp(formData.get("staffIdleMinutes"), 5, 480, before.staffIdleMinutes),
    retentionYears: clamp(formData.get("retentionYears"), 1, 30, before.retentionYears),
  };
  await prisma.platformSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  resetSettingsCache();
  await audit({ actorId: actor.id, action: "settings.updated", entityType: "PlatformSettings", entityId: "default", before: { requireStaffMfa: before.requireStaffMfa, offerSampleData: before.offerSampleData, staffIdleMinutes: before.staffIdleMinutes, retentionYears: before.retentionYears }, after: data });
  revalidatePath("/admin", "layout");
  redirect("/admin/settings?notice=settings_saved");
}
