// The property's place on the map, from the U.S. Census Bureau's free geocoder (no key), for the photo checks.
import type { Deal } from "@/lib/mockData";

/** The address's coordinates, or null when the Census Bureau can't place it or doesn't answer. */
export async function geocode(deal: Pick<Deal, "address" | "city" | "zip">, fetcher: typeof fetch = fetch): Promise<{ lat: number; lng: number } | null> {
  const address = `${deal.address}, ${deal.city}, FL ${deal.zip}`;
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    const reply = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!reply.ok) return null;
    const match = (await reply.json())?.result?.addressMatches?.[0]?.coordinates;
    return typeof match?.x === "number" && typeof match?.y === "number" ? { lat: Number(match.y.toFixed(6)), lng: Number(match.x.toFixed(6)) } : null;
  } catch {
    return null;
  }
}
