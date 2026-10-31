import type { PlatformSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULTS: Omit<PlatformSettings, "updatedAt"> = {
  id: "default",
  retentionYears: 7,
  staffIdleMinutes: 30,
  requireStaffMfa: true,
  offerSampleData: true,
  dualApprovalDrawCents: 5_000_000,
  dualApprovalDistributionCents: 25_000_000,
};

let cached: { at: number; value: Omit<PlatformSettings, "updatedAt"> } | null = null;

/** The settings row, cached for twenty seconds per process (as UPB caches its fee schedule). */
export async function getSettings() {
  if (cached && Date.now() - cached.at < 20_000) return cached.value;
  const row = await prisma.platformSettings.findUnique({ where: { id: "default" } });
  cached = { at: Date.now(), value: row ?? DEFAULTS };
  return cached.value;
}

export function resetSettingsCache() {
  cached = null;
}
