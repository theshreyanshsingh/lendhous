// A Google Street View picture of a loan's property, for loans without a photo yet. The server fetches it with the same
// GOOGLE_MAPS_API_KEY address lookup uses, so the key never reaches a browser. The metadata call is free and says
// whether there's any imagery at the address; only then is the (billed) picture fetched. With no key, screens draw the
// program's house instead.
import { placesKey } from "./places";

const API = "https://maps.googleapis.com/maps/api/streetview";
export const STREET_VIEW_SIZE = "640x400";

export const streetViewOn = () => Boolean(placesKey());

/** The address as Street View looks it up. */
export const streetViewLocation = (deal: { address: string; city: string; zip: string; app?: { state?: string } }) => [deal.address, deal.city, `${deal.app?.state || "FL"} ${deal.zip}`.trim()].filter(Boolean).join(", ");

export const metadataUrl = (location: string, key: string) => `${API}/metadata?location=${encodeURIComponent(location)}&source=outdoor&key=${encodeURIComponent(key)}`;
export const imageUrl = (location: string, key: string) => `${API}?size=${STREET_VIEW_SIZE}&location=${encodeURIComponent(location)}&source=outdoor&fov=80&return_error_code=true&key=${encodeURIComponent(key)}`;

/** Whether the metadata answer found a picture. Anything else (ZERO_RESULTS, NOT_FOUND, an error) means draw instead. */
export const hasImagery = (body: { status?: string }) => body.status === "OK";

/** The picture's bytes, or null when there's no key, no imagery, or Google didn't answer. */
export async function streetViewImage(location: string, fetcher: typeof fetch = fetch): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  const key = placesKey();
  if (!key || !location.trim()) return null;
  try {
    const meta = await fetcher(metadataUrl(location, key));
    if (!meta.ok || !hasImagery(await meta.json())) return null;
    const image = await fetcher(imageUrl(location, key));
    if (!image.ok) return null;
    return { bytes: new Uint8Array(await image.arrayBuffer()) as Uint8Array<ArrayBuffer>, type: image.headers.get("content-type") || "image/jpeg" };
  } catch {
    return null;
  }
}
