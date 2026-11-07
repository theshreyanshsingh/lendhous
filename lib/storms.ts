// Storm mode (docs/next-features-prompt.md, L): every LendHous property is in Florida, so when the National Hurricane
// Center's five-day forecast cone for an Atlantic storm covers one, the owners hear at once which loans, how much is out
// on them, what's left to draw and whether the insurance covers wind. Once the storm is gone, each borrower is asked for
// photos of the property and draws on those loans need an inspection from after it. Pure: parsing NHC's files, the
// point-in-cone test and the bookkeeping, so the nightly job, the screens and the tests agree.
import { evaluate, fundedBalances } from "./engine";
import { policiesOf, policyWord } from "./insurance";
import type { Deal, DrawRequest } from "./mockData";
import { balanceOf, SERVICED } from "./servicing";

/** NHC's list of active storms (its tropical cyclone status JSON). */
export const ACTIVE_STORMS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";

/** NHC's classification codes, in plain words. */
export const CLASSIFICATION: Record<string, string> = { HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", STD: "Subtropical Depression", PTC: "Potential Tropical Cyclone", PC: "Post-tropical Cyclone", TY: "Typhoon" };

export type ActiveStorm = { id: string; name: string; label: string; classification: string; advisory: string; issuedAt: string; coneUrl?: string };

/**
 * The storms in NHC's file that can reach Florida: the Atlantic basin's (ids starting "al"). An eastern or central Pacific
 * storm's cone can't cover a Florida address, so its cone isn't fetched.
 */
export function parseActiveStorms(json: unknown): ActiveStorm[] {
  const list = (json as { activeStorms?: unknown[] } | null)?.activeStorms;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): ActiveStorm[] => {
    const storm = raw as { id?: unknown; name?: unknown; classification?: unknown; publicAdvisory?: { advNum?: unknown; issuance?: unknown }; trackCone?: { kmzFile?: unknown; advNum?: unknown; issuance?: unknown } | null };
    if (typeof storm.id !== "string" || !/^al\d{6}$/i.test(storm.id) || typeof storm.name !== "string") return [];
    const classification = typeof storm.classification === "string" ? storm.classification : "";
    const cone = storm.trackCone && typeof storm.trackCone.kmzFile === "string" && storm.trackCone.kmzFile.startsWith("https://www.nhc.noaa.gov/") ? storm.trackCone.kmzFile : undefined;
    const advisory = String(storm.trackCone?.advNum ?? storm.publicAdvisory?.advNum ?? "");
    const issuedAt = String(storm.trackCone?.issuance ?? storm.publicAdvisory?.issuance ?? "");
    return [{ id: storm.id.toLowerCase(), name: storm.name, classification, label: `${CLASSIFICATION[classification] ?? "Storm"} ${storm.name}`, advisory, issuedAt, ...(cone ? { coneUrl: cone } : {}) }];
  });
}

/** A ring of [longitude, latitude] points, as KML writes them. */
export type Ring = [number, number][];
export type Cone = { outer: Ring; holes: Ring[] }[];

const ring = (text: string): Ring => text.trim().split(/\s+/).map((point) => point.split(",").map(Number)).filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).map((point) => [point[0], point[1]]);

/** The cone's polygons from NHC's cone KML: each outer boundary, with any holes. */
export function parseCone(kml: string): Cone {
  const polygons = kml.match(/<Polygon\b[\s\S]*?<\/Polygon>/g) ?? [];
  return polygons.flatMap((polygon) => {
    const outer = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(polygon);
    if (!outer) return [];
    const holes = [...polygon.matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map((match) => ring(match[1]));
    const points = ring(outer[1]);
    return points.length >= 3 ? [{ outer: points, holes }] : [];
  });
}

/** Whether a point is inside a ring (ray casting). */
function insideRing(lng: number, lat: number, points: Ring) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]; const [xj, yj] = points[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a property's point is inside the forecast cone. */
export const insideCone = (point: { lat: number; lng: number }, cone: Cone) => cone.some((polygon) => insideRing(point.lng, point.lat, polygon.outer) && !polygon.holes.some((hole) => insideRing(point.lng, point.lat, hole)));

/** The loans storm mode watches: funded ones, whose properties secure money already out. */
export const watched = (deal: Pick<Deal, "status">) => SERVICED.includes(deal.status);

/** The watched loans whose property is inside a cone. Loans not yet on the map can't be checked: the job places them first. */
export const loansInCone = (deals: Deal[], cone: Cone) => deals.filter((deal) => watched(deal) && deal.geo && insideCone(deal.geo, cone)).map((deal) => deal.id);

/** A storm whose cone has covered LendHous properties, as the book keeps it. */
export interface StormWatch {
  id: string; name: string; label: string; advisory: string;
  firstSeen: string; lastSeen: string;
  /** Every watched loan the cone has covered at any advisory. A loan once in the cone is followed up even if the cone moved off. */
  dealIds: string[];
  /** The ones the latest cone covers. */
  nowIn: string[];
  status: "active" | "passed";
  passedAt?: string;
  /** Loans whose borrower has been asked for photos of the property since it passed. */
  followedUp?: string[];
}

export type StormCheck = { id: string; name: string; label: string; advisory: string; dealIds: string[] };

/**
 * The book's storms after a check: storms covering loans are added or brought up to date; a storm on the list that's no
 * longer in NHC's file has passed. A storm whose cone covers no loan and never has isn't kept.
 */
export function afterCheck(storms: StormWatch[], check: StormCheck[], at: string) {
  const seen = new Set(check.map((storm) => storm.id));
  const updated = storms.map((storm): StormWatch => {
    const now = check.find((item) => item.id === storm.id);
    if (now && storm.status === "active") return { ...storm, label: now.label, advisory: now.advisory, lastSeen: at, nowIn: now.dealIds, dealIds: [...new Set([...storm.dealIds, ...now.dealIds])] };
    if (!seen.has(storm.id) && storm.status === "active") return { ...storm, status: "passed", passedAt: at, nowIn: [] };
    return storm;
  });
  const added = check.filter((storm) => storm.dealIds.length && !storms.some((item) => item.id === storm.id)).map((storm): StormWatch => ({ id: storm.id, name: storm.name, label: storm.label, advisory: storm.advisory, firstSeen: at, lastSeen: at, dealIds: storm.dealIds, nowIn: storm.dealIds, status: "active" }));
  const passed = updated.filter((storm, index) => storm.status === "passed" && storms[index].status === "active");
  return { storms: [...added, ...updated], added, passed, newlyIn: updated.flatMap((storm, index) => storm.nowIn.filter((id) => !storms[index].dealIds.includes(id)).map((dealId) => ({ storm, dealId }))) };
}

/** The storms on watch now: active, with at least one property in the latest cone. */
export const activeWatches = (storms: StormWatch[] | undefined) => (storms ?? []).filter((storm) => storm.status === "active" && storm.nowIn.length > 0);

/** What's at stake on one loan in a cone, for the owners' email and the storm page. */
export function exposure(deal: Deal, today: string) {
  const policies = policiesOf(deal);
  const ends = policies.map((item) => item.expiresOn).sort()[0];
  const wind = policies.some((item) => item.kind === "windstorm" && item.expiresOn >= today) || policies.some((item) => (item.kind === "hazard" || item.kind === "builders_risk") && item.windIncluded && item.expiresOn >= today);
  const undrawn = Math.max(0, fundedBalances(evaluate(deal.app), deal.app, deal.disbursedDraws).holdbackRemaining);
  return { balance: balanceOf(deal), undrawn, insuranceEnds: ends, lapsed: policies.filter((item) => item.expiresOn < today).map((item) => policyWord(item.kind)), wind };
}

const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/** One line per loan for the owners' email: plain text, nothing past the loan number and its numbers. */
export function exposureLines(deals: Deal[], ids: string[], today: string) {
  return deals.filter((deal) => ids.includes(deal.id)).map((deal) => {
    const at = exposure(deal, today);
    return `${deal.loanNumber}, ${deal.city}: ${dollars(at.balance)} out, ${dollars(at.undrawn)} left to draw, insurance ${at.insuranceEnds ? `to ${day(`${at.insuranceEnds}T12:00:00Z`)}` : "not on file"}${at.lapsed.length ? ` (${at.lapsed.join(", ")} lapsed)` : ""}, wind ${at.wind ? "covered" : "NOT covered"}.`;
  });
}

/**
 * Why a draw needs another inspection before it's approved or released, or null: a storm passed over the property after
 * this draw was last inspected. One not inspected yet will be, after the storm.
 */
export function freshInspectionNeeded(deal: Pick<Deal, "stormHold">, draw: Pick<DrawRequest, "status" | "inspection">) {
  const hold = deal.stormHold;
  if (!hold || (draw.status !== "inspected" && draw.status !== "approved")) return null;
  if (draw.inspection && draw.inspection.at >= hold.passedAt) return null;
  return `${hold.name} passed on ${day(hold.passedAt)}, after this draw's inspection. Order a fresh inspection of the property first.`;
}

/**
 * PLACEHOLDER demo storm for demo seats, which never reach NHC: a made-up cone over Miami-Dade and Broward. The first
 * check in the demo finds it, the next finds it gone, so the whole cycle can be seen.
 */
export const DEMO_STORM = { id: "al992026", name: "Sample", label: "Hurricane Sample (FAKE)", advisory: "12", cone: [{ outer: [[-80.75, 25.35], [-79.85, 25.35], [-79.85, 26.25], [-80.75, 26.25], [-80.75, 25.35]] as Ring, holes: [] }] as Cone };
