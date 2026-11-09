import type { PlatformSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULTS: Omit<PlatformSettings, "updatedAt"> = {
  id: "default",
  retentionYears: 7,
  staffIdleMinutes: 30,
  offerSampleData: true,
  allowSignup: true,
  dualApprovalDrawCents: 5_000_000,
  dualApprovalDistributionCents: 25_000_000,
  lenderAddress: "",
  lenderPhone: "",
  slaTargets: null,
  paymentInstructions: "",
  referralBonusCents: 0,
  reviewUrl: "",
  allowCallBooking: true,
  lateFeesToInvestors: false,
  nfipAuthorizedThrough: "2026-12-11",
  drawFeeInspectionCents: 0,
  drawFeeDeskCents: 0,
};

let cached: { at: number; value: Omit<PlatformSettings, "updatedAt"> } | null = null;

/** The settings row, cached for twenty seconds per process (as UPB caches its fee schedule). */
export async function getSettings() {
  if (cached && Date.now() - cached.at < 20_000) return cached.value;
  const row = await prisma.platformSettings.findUnique({ where: { id: "default" } });
  cached = { at: Date.now(), value: row ?? DEFAULTS };
  return cached.value;
}

/**
 * The settings as saved right now, skipping the cache: for a check that has to agree with what a page just showed, since
 * each part of the server keeps its own twenty-second copy and saving only clears one of them.
 */
export async function freshSettings() {
  cached = null;
  return getSettings();
}

export function resetSettingsCache() {
  cached = null;
}
