"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings, resetSettingsCache } from "@/lib/settings";
import { SLA_KEYS, targetsFrom } from "@/lib/sla";

const clamp = (value: FormDataEntryValue | null, low: number, high: number, fallback: number) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

export async function saveSettings(formData: FormData) {
  const actor = await requirePermission("manage_roles");
  const before = await getSettings();
  const data = {
    offerSampleData: formData.get("offerSampleData") === "on",
    allowSignup: formData.get("allowSignup") === "on",
    staffIdleMinutes: clamp(formData.get("staffIdleMinutes"), 5, 480, before.staffIdleMinutes),
    retentionYears: clamp(formData.get("retentionYears"), 1, 30, before.retentionYears),
    lenderAddress: String(formData.get("lenderAddress") ?? before.lenderAddress).trim().slice(0, 300),
    lenderPhone: String(formData.get("lenderPhone") ?? before.lenderPhone).trim().slice(0, 40),
    // Each target in hours; anything outside 1 to 240 keeps what was there.
    slaTargets: Object.fromEntries(SLA_KEYS.map((key) => { const was = targetsFrom(before.slaTargets as never)[key].hours; return [key, clamp(formData.get(`sla-${key}`), 1, 240, was)]; })),
  };
  await prisma.platformSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  resetSettingsCache();
  await audit({ actorId: actor.id, action: "settings.updated", entityType: "PlatformSettings", entityId: "default", before: { offerSampleData: before.offerSampleData, allowSignup: before.allowSignup, staffIdleMinutes: before.staffIdleMinutes, retentionYears: before.retentionYears, lenderAddress: before.lenderAddress, lenderPhone: before.lenderPhone, slaTargets: before.slaTargets }, after: data });
  revalidatePath("/admin", "layout");
  redirect("/admin/settings?notice=settings_saved");
}
