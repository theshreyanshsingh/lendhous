// Which rates, limits and loan terms each loan was priced on. A loan keeps the pricing version it was quoted on, so
// publishing new numbers changes new quotes only: a funded loan's rate, payment and late fee never move under it.
// The code's config is the first version; versions published in the app are added here on the server (lib/pricing-store.ts)
// and in the browser (from the book it's sent).
import { pricingConfig, type PricingConfig } from "./pricing-config";

/** The version every loan priced before versions existed was priced on: the numbers in lib/pricing-config.ts. */
export const BASE_VERSION = pricingConfig.version;

const known = new Map<string, PricingConfig>([[BASE_VERSION, pricingConfig]]);
let current: PricingConfig = pricingConfig;

/** What the browser is sent: the version new quotes use, and every version its loans were priced on. */
export type PricingPayload = { current: string; versions: PricingConfig[] };

/** Learns these versions, and which one new quotes use. Safe to call again with the same ones. */
export function adoptPricing(payload?: PricingPayload) {
  if (!payload) return;
  for (const config of payload.versions) known.set(config.version, config);
  current = known.get(payload.current) ?? current;
}

/** The pricing new quotes use. */
export const currentPricing = () => current;

/**
 * The pricing a loan was quoted on. A quote not yet saved has no version and uses the current one. A version this
 * process hasn't been told about can't be priced safely, so it says so instead of quietly using today's numbers.
 */
export function pricingFor(version?: string): PricingConfig {
  if (!version) return current;
  const config = known.get(version);
  if (!config) throw new Error(`Pricing version ${version} isn't loaded`);
  return config;
}

export const isKnownVersion = (version: string) => known.has(version);

/** The payload for a set of loans: the current version and the ones they use. */
export function pricingPayload(versions: Iterable<string | undefined>): PricingPayload {
  const wanted = new Set([current.version, ...[...versions].filter((item): item is string => Boolean(item))]);
  return { current: current.version, versions: [...wanted].filter((item) => known.has(item)).map((item) => known.get(item)!) };
}
