// What the server looks up about a property for itself (docs/next-features-prompt.md, L): its place on the map, from the
// U.S. Census geocoder, and its flood zone, from FEMA's National Flood Hazard Layer. Both are free and need no key. They run
// after an application or a draw comes in, from the button on a loan, and nightly for any funded or open loan still
// missing them. A failed lookup records nothing, so it's simply tried again. Server only.
import type { Viewer } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import type { Book } from "@/lib/book";
import { readBook, runAction } from "@/lib/book-store";
import { floodAt } from "@/lib/fema";
import type { FloodAnswer } from "@/lib/flood-zones";
import { geocode } from "@/lib/geocode";
import { PRE_FUNDING } from "@/lib/loan-exits";
import { SERVICED } from "@/lib/servicing";

/** Who the server acts as. No roles: placing and mapping are server-only steps. */
export const PROPERTY_FACTS: Viewer = { id: "system", name: "LendHous property facts", roleCodes: [] };

export type MapResult = { placed: boolean; flood: FloodAnswer | null; after?: Book; error?: string };

/**
 * Puts a loan's property on the map and looks up its flood zone: whichever it's missing, or the flood zone again when asked.
 * The flood zone needs the place, so a property the geocoder can't find stops there.
 */
export async function mapProperty(dealId: string, options: { again?: boolean; actor?: Viewer; fetcher?: typeof fetch } = {}): Promise<MapResult> {
  const actor = options.actor ?? PROPERTY_FACTS;
  const fetcher = options.fetcher ?? fetch;
  let { book } = await readBook();
  let deal = book.deals.find((item) => item.id === dealId);
  if (!deal) return { placed: false, flood: null, error: "That loan no longer exists." };
  let placed = false;
  if (!deal.geo) {
    const place = await geocode(deal, fetcher);
    if (!place) return { placed: false, flood: null, error: "The Census Bureau's geocoder couldn't place this address. Check the street, city and ZIP." };
    const result = await runAction(actor, { t: "placeProperty", dealId, ...place }, { trusted: true });
    if ("error" in result) return { placed: false, flood: null, error: result.error };
    book = result.after; deal = book.deals.find((item) => item.id === dealId)!; placed = true;
  }
  if (deal.floodMap && !options.again) return { placed, flood: null, after: book };
  const flood = await floodAt(deal.geo!, fetcher);
  if ("error" in flood) return { placed, flood, after: book, error: flood.error };
  const map = flood.mapped ? { mapped: true, zone: flood.zone, sfha: flood.sfha, ...(flood.subtype ? { subtype: flood.subtype } : {}), at: new Date().toISOString() } : { mapped: false, zone: "", sfha: false, at: new Date().toISOString() };
  const result = await runAction(actor, { t: "recordFloodMap", dealId, map }, { trusted: true });
  if ("error" in result) return { placed, flood, after: book, error: result.error };
  await sendAlerts(result.before, result.after, result.action);
  return { placed, flood, after: result.after };
}

/** The nightly pass: open and funded loans not yet on the map or without a flood zone, a few a night so neither service is hammered. */
export async function mapMissing(limit = 25, fetcher: typeof fetch = fetch) {
  const { book } = await readBook();
  const open = book.deals.filter((deal) => (PRE_FUNDING.includes(deal.status) || SERVICED.includes(deal.status)) && (!deal.geo || !deal.floodMap)).slice(0, limit);
  let placed = 0; let mapped = 0; let failed = 0;
  for (const deal of open) {
    const result = await mapProperty(deal.id, { fetcher });
    if (result.placed) placed++;
    if (result.flood && !("error" in result.flood)) mapped++;
    if (result.error) failed++;
  }
  return `placed ${placed} properties and looked up ${mapped} flood zones${failed ? `; ${failed} couldn't be looked up` : ""}`;
}
