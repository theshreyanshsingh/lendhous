// Asks FEMA's National Flood Hazard Layer for the flood zone at a point (lib/flood-zones.ts has the parsing). Free, no key.
// FEMA's servers reset connections from some networks, so check it answers from the production server (DEPLOY.md). A
// lookup that fails records nothing and is tried again. Server only.
import { FALLBACK_LAYER, floodLayerId, floodQuery, NFHL_URL, parseFloodAnswer, type FloodAnswer } from "@/lib/flood-zones";

// The flood zones layer's number, read once per process from FEMA's directory. A failed read isn't kept, so it's tried again.
let layer: number | null = null;
async function floodLayer(fetcher: typeof fetch) {
  if (layer !== null) return layer;
  try {
    const reply = await fetcher(`${NFHL_URL}?f=json`, { signal: AbortSignal.timeout(10_000) });
    const id = reply.ok ? floodLayerId(await reply.json()) : null;
    if (id !== null) { layer = id; return id; }
  } catch {}
  return FALLBACK_LAYER;
}

/** FEMA's flood zone at a point, or why it couldn't be had. */
export async function floodAt(point: { lat: number; lng: number }, fetcher: typeof fetch = fetch): Promise<FloodAnswer> {
  try {
    const reply = await fetcher(floodQuery(await floodLayer(fetcher), point), { signal: AbortSignal.timeout(15_000) });
    if (!reply.ok) return { error: `FEMA's flood map answered with an error (${reply.status}). Try again later.` };
    return parseFloodAnswer(await reply.json());
  } catch {
    return { error: "FEMA's flood map didn't answer. Try again later." };
  }
}
