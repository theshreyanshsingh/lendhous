// Published pricing, kept in the database. Every server step that prices a loan loads it first, so the web app and the
// nightly jobs (a separate process) agree on which numbers each loan uses.
import type { PricingConfig } from "./pricing-config";
import { prisma } from "./prisma";
import { adoptPricing, BASE_VERSION, isKnownVersion } from "./pricing-versions";

const FRESH_MS = 15_000;
let loadedAt = 0;

/**
 * Learns every published version and which one new quotes use. It reads again when a loan uses a version this process
 * hasn't seen (published by the other process), and otherwise at most every 15 seconds.
 */
export async function loadPricing(needed: Iterable<string | undefined> = [], force = false) {
  const unknown = [...needed].some((version) => version && !isKnownVersion(version));
  if (!force && !unknown && Date.now() - loadedAt < FRESH_MS) return;
  const rows = await prisma.pricingVersion.findMany({ orderBy: { publishedAt: "asc" } });
  adoptPricing({ current: rows.at(-1)?.version ?? BASE_VERSION, versions: rows.map((row) => row.config as unknown as PricingConfig) });
  loadedAt = Date.now();
}

export const pricingHistory = () => prisma.pricingVersion.findMany({ orderBy: { publishedAt: "desc" }, select: { version: true, note: true, publishedBy: true, publishedAt: true } });
