// Flood zones from FEMA's National Flood Hazard Layer (docs/next-features-prompt.md, L). The borrower used to type whether
// the house was in a flood zone ("I'm not sure" allowed); now the server looks the property's point up on FEMA's map. A
// zone A or V property is in a special flood hazard area: the loan gets a flood insurance condition, and a rental loan
// counts a flood premium in its DSCR. An empty answer means FEMA has no digital map there, which isn't the same as no risk.
// Pure: parsing FEMA's answers and what follows from them.
import { addDays } from "./servicing";
import type { Deal, FloodMap, LoanCondition } from "./mockData";

/** FEMA's public map service. The flood zones layer's number is read from its directory, since it differs between releases. */
export const NFHL_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
export const FLOOD_LAYER_NAME = "Flood Hazard Zones";
/** The layer's number when the directory can't be read (it was 28 when this was written). */
export const FALLBACK_LAYER = 28;

/** The flood zones layer's number from the service directory, or null if it isn't listed. */
export function floodLayerId(directory: unknown) {
  const layers = (directory as { layers?: { id?: unknown; name?: unknown }[] } | null)?.layers;
  const layer = Array.isArray(layers) ? layers.find((item) => typeof item.name === "string" && item.name.trim().toLowerCase() === FLOOD_LAYER_NAME.toLowerCase()) : undefined;
  return typeof layer?.id === "number" ? layer.id : null;
}

/** The query for one point (longitude, latitude), asking only for the zone's fields. */
export const floodQuery = (layer: number, point: { lat: number; lng: number }) => `${NFHL_URL}/${layer}/query?${new URLSearchParams({ geometry: `${point.lng},${point.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF", returnGeometry: "false", f: "json" })}`;

/** A special flood hazard area: the 1% annual chance zones, A and V in all their forms (AE, AH, AO, AR, A99, VE). */
export const isSfhaZone = (zone: string) => /^[AV]/i.test(zone.trim());

// When a point sits on a boundary FEMA returns both zones: the riskier one counts.
const RISK = (zone: string) => (/^V/i.test(zone) ? 4 : /^A/i.test(zone) ? 3 : /^D/i.test(zone) ? 2 : 1);

export type FloodAnswer = { mapped: true; zone: string; sfha: boolean; subtype?: string } | { mapped: false } | { error: string };

/** FEMA's answer for a point: the zone, whether it's a special flood hazard area, or not mapped. */
export function parseFloodAnswer(json: unknown): FloodAnswer {
  const body = json as { error?: { message?: unknown }; features?: { attributes?: { FLD_ZONE?: unknown; ZONE_SUBTY?: unknown; SFHA_TF?: unknown } }[] } | null;
  if (!body || typeof body !== "object") return { error: "FEMA's map sent back something unreadable." };
  if (body.error) return { error: `FEMA's map refused the lookup${typeof body.error.message === "string" ? `: ${body.error.message.replace(/\.+$/, "")}` : ""}.` };
  if (!Array.isArray(body.features)) return { error: "FEMA's map sent back something unreadable." };
  const zones = body.features
    .map((feature) => ({ zone: typeof feature.attributes?.FLD_ZONE === "string" ? feature.attributes.FLD_ZONE.trim().toUpperCase() : "", subtype: typeof feature.attributes?.ZONE_SUBTY === "string" ? feature.attributes.ZONE_SUBTY.trim() : undefined, flag: feature.attributes?.SFHA_TF }))
    // "AREA NOT INCLUDED" is a part of the county FEMA's map leaves out: not mapped.
    .filter((item) => item.zone && item.zone !== "AREA NOT INCLUDED");
  if (!zones.length) return { mapped: false };
  const worst = zones.sort((a, b) => RISK(b.zone) - RISK(a.zone))[0];
  return { mapped: true, zone: worst.zone, sfha: worst.flag === "T" || isSfhaZone(worst.zone), ...(worst.subtype ? { subtype: worst.subtype } : {}) };
}

/** What the map says, in the team's words. */
export function floodMapWords(map: FloodMap) {
  if (!map.mapped) return "FEMA's flood map has no digital flood zone at this address. That means it isn't mapped, not that there's no risk: get the zone from a flood zone determination.";
  if (map.sfha) return `Zone ${map.zone}: a special flood hazard area, so flood insurance is required.`;
  if (/^D/.test(map.zone)) return "Zone D: FEMA hasn't studied the flood risk here, so it's possible but undetermined. Get a flood zone determination.";
  if (/0\.2 PCT/i.test(map.subtype ?? "")) return `Zone ${map.zone} (shaded): a moderate risk, outside the special flood hazard area. Flood insurance isn't required, but it's worth having.`;
  return `Zone ${map.zone}: outside the special flood hazard area, so flood insurance isn't required.`;
}

/** PLACEHOLDER: a year's flood premium a rental loan counts in its DSCR in a special flood hazard area until the real quote is in. */
export const FLOOD_PREMIUM_ESTIMATE = 2_400;
/** The flood insurance condition a loan in a special flood hazard area gets on its own. */
export const FLOOD_CONDITION = "auto-flood";
const BEFORE_TERM_SHEET = ["submitted", "initial_review", "underwriting"];
const BEFORE_FUNDING = [...BEFORE_TERM_SHEET, "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"];

/**
 * A loan once it's known to be in a special flood hazard area: a flood insurance condition before funding, if it hasn't
 * one, and on a rental loan not yet given a term sheet, a flood premium in its DSCR until the real one is typed in.
 */
export function withFloodFollowUps(deal: Deal, sfha: boolean, today: string, at: string): Deal {
  if (!sfha || !BEFORE_FUNDING.includes(deal.status)) return deal;
  const has = (deal.conditions ?? []).some((item) => item.templateId === FLOOD_CONDITION);
  const condition: LoanCondition = { id: `${FLOOD_CONDITION}-${deal.id}`, templateId: FLOOD_CONDITION, title: "Flood insurance naming LendHous", detail: `The property is in flood zone ${deal.insurance?.flood?.zone || deal.floodMap?.zone || "A or V"}, a special flood hazard area. A flood policy (NFIP or private) for at least the loan amount or the most available, with LendHous as mortgagee.`, category: "prior_to_funding", owner: "borrower", needsUpload: true, dueOn: addDays(today, 10), status: "open", addedBy: "FEMA flood map", addedAt: at, files: [] };
  const premium = deal.app.product === "dscr" && deal.app.floodAnnual === undefined && BEFORE_TERM_SHEET.includes(deal.status);
  return { ...deal, ...(has ? {} : { conditions: [...(deal.conditions ?? []), condition] }), ...(premium ? { app: { ...deal.app, floodAnnual: FLOOD_PREMIUM_ESTIMATE } } : {}) };
}

/** FEMA's answer on a loan: kept as asked, and used as the loan's flood zone unless someone recorded one from a determination. */
export function applyFloodMap(deal: Deal, map: FloodMap, today: string): Deal {
  const recorded = deal.insurance?.flood;
  const use = map.mapped && (!recorded || recorded.source === "fema");
  const insurance = use ? { policies: deal.insurance?.policies ?? [], ...deal.insurance, flood: { sfha: map.sfha, zone: map.zone, by: "FEMA flood map", at: map.at, source: "fema" as const } } : deal.insurance;
  return withFloodFollowUps({ ...deal, floodMap: map, ...(insurance ? { insurance } : {}) }, use ? map.sfha : false, today, map.at);
}

/** Someone's recorded zone and FEMA's map disagree on whether flood insurance is needed: worth a second look. */
export const floodDisagrees = (deal: Pick<Deal, "floodMap" | "insurance">) => Boolean(deal.floodMap?.mapped && deal.insurance?.flood && deal.insurance.flood.source !== "fema" && deal.insurance.flood.sfha !== deal.floodMap.sfha);
