// Proof a photo is of the property (docs/next-features-prompt.md, N): the phone's location when it was sent against the
// property's place on the map, and when it was taken against when it arrived. Flagged for the team, never blocked: a phone
// can be wrong, and a photo can be honest and old. Pure.
import type { Deal, RequestPhoto } from "./mockData";

/** PLACEHOLDER thresholds: farther than this from the property, or taken this long before it was sent. */
export const PHOTO_LIMITS = { meters: 200, hours: 48 };

/** Meters between two points on the earth (haversine). */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export type PhotoCheck = { meters?: number; far: boolean; old: boolean; located: boolean };

/** One photo's checks against the property. A photo with no location, or a property not yet placed, just isn't checked. */
export function photoCheck(photo: Pick<RequestPhoto, "lat" | "lng" | "takenAt" | "at">, geo: Deal["geo"]): PhotoCheck {
  const located = photo.lat !== undefined && photo.lng !== undefined;
  const meters = located && geo ? metersBetween({ lat: photo.lat!, lng: photo.lng! }, geo) : undefined;
  const old = Boolean(photo.takenAt && Date.parse(photo.at) - Date.parse(photo.takenAt) > PHOTO_LIMITS.hours * 3_600_000);
  return { meters, far: meters !== undefined && meters > PHOTO_LIMITS.meters, old, located };
}

const distance = (meters: number) => (meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`);

/** A line for the team on a set of photos: how many were at the property, how many weren't, and how many were old. */
export function photosSummary(photos: RequestPhoto[], geo: Deal["geo"]) {
  if (!photos.length) return null;
  const checks = photos.map((photo) => photoCheck(photo, geo));
  const far = checks.filter((item) => item.far);
  const near = checks.filter((item) => item.meters !== undefined && !item.far).length;
  const old = checks.filter((item) => item.old).length;
  const unlocated = checks.filter((item) => !item.located).length;
  const parts = [
    ...(geo ? [] : ["the property isn't on the map yet, so locations aren't checked"]),
    ...(near ? [`${near} taken at the property`] : []),
    ...(far.length ? [`${far.length} taken ${distance(Math.max(...far.map((item) => item.meters!)))} or so away`] : []),
    ...(old ? [`${old} taken more than ${PHOTO_LIMITS.hours} hours before it was sent`] : []),
    ...(unlocated ? [`${unlocated} without the phone's location`] : []),
  ];
  return { text: parts.join(" · "), flagged: far.length > 0 || old > 0 };
}
