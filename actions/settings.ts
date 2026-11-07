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
    allowCallBooking: formData.get("allowCallBooking") === "on",
    lateFeesToInvestors: formData.get("lateFeesToInvestors") === "on",
    staffIdleMinutes: clamp(formData.get("staffIdleMinutes"), 5, 480, before.staffIdleMinutes),
    retentionYears: clamp(formData.get("retentionYears"), 1, 30, before.retentionYears),
    lenderAddress: String(formData.get("lenderAddress") ?? before.lenderAddress).trim().slice(0, 300),
    lenderPhone: String(formData.get("lenderPhone") ?? before.lenderPhone).trim().slice(0, 40),
    paymentInstructions: String(formData.get("paymentInstructions") ?? before.paymentInstructions).trim().slice(0, 1500),
    // Whole dollars, up to $5,000; blank or 0 turns the referral program off.
    // Only an https link is kept: it's put in front of borrowers.
    reviewUrl: (() => { const url = String(formData.get("reviewUrl") ?? before.reviewUrl).trim().slice(0, 500); return /^https:\/\/[^\s]+$/.test(url) ? url : ""; })(),
    referralBonusCents: clamp(formData.get("referralBonus") || "0", 0, 5000, before.referralBonusCents / 100) * 100,
    // Each target in hours; anything outside 1 to 240 keeps what was there.
    slaTargets: Object.fromEntries(SLA_KEYS.map((key) => { const was = targetsFrom(before.slaTargets as never)[key].hours; return [key, clamp(formData.get(`sla-${key}`), 1, 240, was)]; })),
  };
  await prisma.platformSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  resetSettingsCache();
  await audit({ actorId: actor.id, action: "settings.updated", entityType: "PlatformSettings", entityId: "default", before: { offerSampleData: before.offerSampleData, allowSignup: before.allowSignup, staffIdleMinutes: before.staffIdleMinutes, retentionYears: before.retentionYears, lenderAddress: before.lenderAddress, lenderPhone: before.lenderPhone, slaTargets: before.slaTargets, paymentInstructions: before.paymentInstructions, referralBonusCents: before.referralBonusCents, reviewUrl: before.reviewUrl, allowCallBooking: before.allowCallBooking, lateFeesToInvestors: before.lateFeesToInvestors }, after: data });
  revalidatePath("/admin", "layout");
  redirect("/admin/settings?notice=settings_saved");
}
