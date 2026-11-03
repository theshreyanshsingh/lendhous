// Address lookup through Google's Places API (New). The server holds the key and relays the two calls, so the key never
// reaches a browser and every lookup is rate limited. With no GOOGLE_MAPS_API_KEY the lookup is off and people type the
// address; nothing else changes.
import { currentPricing } from "./pricing-versions";

export type Suggestion = { id: string; main: string; secondary: string };
/** An address as forms keep it. County matters: it decides pricing. */
export type AddressValue = { street: string; city: string; state: string; zip: string; county: string };
export type FoundAddress = { street: string; city: string; state: string; zip: string; county: string; lat?: number; lng?: number };

const API = "https://places.googleapis.com/v1";
export const placesKey = () => process.env.GOOGLE_MAPS_API_KEY || "";

type Prediction = { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } };
type Component = { longText?: string; shortText?: string; types?: string[] };

/** The suggestions in Google's autocomplete reply, as the field shows them. */
export function readSuggestions(body: { suggestions?: Prediction[] }): Suggestion[] {
  return (body.suggestions ?? []).flatMap((item) => {
    const place = item.placePrediction;
    if (!place?.placeId) return [];
    return [{ id: place.placeId, main: place.structuredFormat?.mainText?.text ?? place.text?.text ?? "", secondary: place.structuredFormat?.secondaryText?.text ?? "" }];
  });
}

/**
 * A place's address in the parts the application uses. The county decides pricing, so Google's "Broward County" becomes
 * the "Broward" the pricing knows, and a Florida county pricing doesn't name becomes "Other FL".
 */
export function readAddress(body: { addressComponents?: Component[]; location?: { latitude?: number; longitude?: number } }): FoundAddress {
  const part = (type: string, short = false) => { const found = (body.addressComponents ?? []).find((item) => item.types?.includes(type)); return (short ? found?.shortText : found?.longText) ?? ""; };
  const state = part("administrative_area_level_1", true);
  const county = part("administrative_area_level_2").replace(/\s+County$/i, "").trim();
  const known = [...currentPricing().geography.core, ...currentPricing().geography.expansion];
  return {
    street: [part("street_number"), part("route", true)].filter(Boolean).join(" "),
    city: part("locality") || part("sublocality") || part("postal_town") || part("administrative_area_level_3"),
    state,
    zip: part("postal_code"),
    county: state === "FL" ? (known.includes(county) ? county : "Other FL") : county,
    lat: body.location?.latitude,
    lng: body.location?.longitude,
  };
}

/** Up to five U.S. addresses for what's been typed. */
export async function suggest(input: string, session: string, fetcher: typeof fetch = fetch): Promise<Suggestion[]> {
  const response = await fetcher(`${API}/places:autocomplete`, { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": placesKey() }, body: JSON.stringify({ input, sessionToken: session, includedRegionCodes: ["us"], languageCode: "en" }) });
  if (!response.ok) throw new Error(`Places autocomplete answered ${response.status}`);
  return readSuggestions(await response.json()).slice(0, 5);
}

/** The full address of a suggestion picked. Same session as the typing, so Google bills the pair as one lookup. */
export async function details(id: string, session: string, fetcher: typeof fetch = fetch): Promise<FoundAddress> {
  const response = await fetcher(`${API}/places/${encodeURIComponent(id)}?sessionToken=${encodeURIComponent(session)}`, { headers: { "X-Goog-Api-Key": placesKey(), "X-Goog-FieldMask": "addressComponents,location" } });
  if (!response.ok) throw new Error(`Places details answered ${response.status}`);
  return readAddress(await response.json());
}
