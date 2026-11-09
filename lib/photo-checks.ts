// Proof a photo is of the property (docs/next-features-prompt.md, N): the phone's location when it was sent against the
// property's place on the map, and when it was taken against when it arrived; and that it wasn't sent before, for another
// draw or loan (docs/competitor-gaps-2026-11-09.md, rank 3). Flagged for the team, never blocked: a phone can be wrong,
// and a photo can be honest and old. Pure.
import type { Deal, DrawRequest, PhotoRequest, RequestPhoto } from "./mockData";

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
export function photosSummary(photos: Pick<RequestPhoto, "lat" | "lng" | "takenAt" | "at">[], geo: Deal["geo"]) {
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

/**
 * PLACEHOLDER until there's a run of real draws to tune it on: how many of a 64-bit difference hash's bits may differ for
 * two photos to count as the same picture (resized, re-saved or lightly cropped). 0 is only exact copies.
 */
export const REUSE_BITS = 6;

/** The number of bits two hex fingerprints differ by. */
export function bitsApart(a: string, b: string) {
  if (a.length !== b.length) return Infinity;
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { bits += x & 1; x >>= 1; }
  }
  return bits;
}

type Printed = { id: string; sha256?: string; dhash?: string };
/** A fingerprinted photo LendHous already holds, and where it came in. */
export type HeldPhoto = Printed & { dealId: string; loanNumber: string; where: string; on: string; drawId?: string; requestId?: string };
type Book = { deals: Pick<Deal, "id" | "loanNumber">[]; draws: Pick<DrawRequest, "id" | "dealId" | "requestedAt" | "linePhotos">[]; photoRequests: Pick<PhotoRequest, "id" | "dealId" | "who" | "stormId" | "photos">[] };

/** Every fingerprinted photo in the book: the borrowers' line photos on draws, and the photos sent through photo links. */
export function heldPhotos(book: Book): HeldPhoto[] {
  const number = (dealId: string) => book.deals.find((deal) => deal.id === dealId)?.loanNumber ?? "another loan";
  return [
    ...book.draws.flatMap((draw) => (draw.linePhotos ?? []).filter((photo) => photo.sha256 || photo.dhash).map((photo) => ({ ...photo, dealId: draw.dealId, loanNumber: number(draw.dealId), where: "a draw request", on: draw.requestedAt.slice(0, 10), drawId: draw.id }))),
    ...book.photoRequests.flatMap((request) => request.photos.filter((photo) => photo.sha256 || photo.dhash).map((photo) => ({ id: photo.id, sha256: photo.sha256, dhash: photo.dhash, dealId: request.dealId, loanNumber: number(request.dealId), where: request.stormId ? "the photos after a storm" : `the ${request.who}'s photo link`, on: photo.at.slice(0, 10), requestId: request.id }))),
  ];
}

/** A difference hash with almost every bit the same is a plain wall or a dark frame, which looks like any other: not compared. */
const telling = (dhash: string) => { const set = bitsApart(dhash, "0".repeat(dhash.length)); return set > 6 && set < dhash.length * 4 - 6; };

/** Whether two fingerprinted photos are the same picture: the same file, or nearly the same image. */
export const samePicture = (a: Omit<Printed, "id">, b: Omit<Printed, "id">) => Boolean((a.sha256 && a.sha256 === b.sha256) || (a.dhash && b.dhash && telling(a.dhash) && telling(b.dhash) && bitsApart(a.dhash, b.dhash) <= REUSE_BITS));

/**
 * The photos in a set that match one LendHous already holds, or each other: the same picture sent again for another
 * draw, line or loan. Each match says where the earlier one came in. Flagged for the team, never blocked.
 */
export function reusedPhotos(book: Book, photos: Printed[]) {
  const ids = new Set(photos.map((photo) => photo.id));
  const held = heldPhotos(book).filter((photo) => !ids.has(photo.id));
  return photos.flatMap((photo) => {
    const earlier = held.filter((item) => samePicture(photo, item));
    const twice = photos.some((other) => other.id !== photo.id && samePicture(photo, other));
    return earlier.length || twice ? [{ photoId: photo.id, earlier, twice }] : [];
  });
}

/** A line for the team about photos that match others, or null. */
export function reusedSummary(book: Book, photos: Printed[]) {
  const reused = reusedPhotos(book, photos);
  if (!reused.length) return null;
  const first = reused.find((item) => item.earlier.length)?.earlier[0];
  return `${reused.length} photo${reused.length === 1 ? "" : "s"} match${reused.length === 1 ? "es" : ""} ${first ? `one on ${first.where} on ${first.loanNumber}, ${first.on}` : "another sent with it"}${reused.length > 1 && first ? ", and maybe others" : ""}.`;
}
