// Asking a contractor or borrower for photos of finished work: when a link still works, and the guide its page walks
// them through. No database or React here, so the staff screens, the public page and the tests can share it.
import type { Deal, DrawRequest, PhotoRequest } from "./mockData";

export const PHOTO_LINK_DAYS = 14;
export const MAX_PHOTOS_PER_LINK = 80;

export type Shot = { id: string; label: string; tip: string };
export type GuideStep = { id: string; title: string; shots: Shot[] };

const shot = (id: string, label: string, tip: string): Shot => ({ id, label, tip });

/** Always first: it ties the rest of the photos to the address. */
export const PROPERTY_STEP: GuideStep = { id: "property", title: "The property", shots: [shot("front", "Front of the building", "Stand far enough back to get the whole front, with the house number showing if you can.")] };

const ANY_WORK = [shot("wide", "The whole area", "Stand back so the finished work and the space around it are both in the shot."), shot("close", "Close up", "Get near enough to see the finished work clearly.")];

// Budget lines from lib/draws.ts. A line that isn't listed here gets ANY_WORK.
const SHOTS: Record<string, Shot[]> = {
  demolition: [shot("rooms", "Each cleared room", "Stand in the doorway and get the whole room."), shot("debris", "Where the debris was", "Show the yard or dumpster, cleared or full.")],
  structural: [shot("framing", "New framing or beams", "Get the whole wall or span, before it's covered if possible."), shot("connections", "Close up of the connections", "Hangers, bolts or new supports.")],
  exterior: [shot("sides", "Each side of the building", "Front, back and both sides."), shot("roof", "The roof", "From the ground is fine. Show as much as you safely can."), shot("openings", "New windows or doors", "Only if they were part of this work.")],
  plumbing: [shot("lines", "New lines or rough-in", "Show the pipes before walls close, or the finished connections."), shot("fixtures", "Fixtures installed", "Sinks, toilets, tubs and the water heater.")],
  electrical: [shot("panel", "The electrical panel", "With the door open so the breakers show."), shot("wiring", "Wiring or finished fixtures", "Rough wiring before walls close, or finished outlets and lights.")],
  hvac: [shot("outdoor", "The outdoor unit", "Include the label with the model number if you can."), shot("indoor", "Indoor unit and thermostat", "Plus any new ductwork that still shows.")],
  kitchen: [shot("room", "The whole kitchen", "Stand in the doorway."), shot("cabinets", "Cabinets and counters", "Doors on and counters in place."), shot("appliances", "Appliances", "Installed, not still in boxes.")],
  bathrooms: [shot("room", "Each bathroom", "Stand in the doorway and get the whole room."), shot("wet", "Shower or tub, and tile", "Close enough to see the finish."), shot("vanity", "Vanity and toilet", "Installed and connected.")],
  flooring: [shot("rooms", "Each finished room", "Stand in a corner so the floor and walls both show."), shot("detail", "Close up of the finish", "A transition or a corner where floor meets trim.")],
  site: [shot("foundation", "Foundation or slab", "Get the whole footprint, from a high spot if you can."), shot("utilities", "Grading and utilities", "Trenches, connections and drainage.")],
  framing: [shot("sides", "Each side of the structure", "Front, back and both sides."), shot("roof", "Roof framing or sheathing", "From inside and outside if you can.")],
  mechanical: [shot("roughin", "Rough-ins for each trade", "Plumbing, electrical and HVAC, before walls close."), shot("panel", "Panel and main lines", "With the panel door open.")],
  interior: [shot("rooms", "Each finished room", "Stand in the doorway."), shot("kitchen", "Kitchen and bathrooms", "Finished and with fixtures in.")],
  soft: [shot("paper", "Permit or invoice", "A clear, flat photo where every line can be read.")],
};

export const guideSteps = (lines: { id: string; division: string }[]): GuideStep[] => [PROPERTY_STEP, ...lines.map((line) => ({ id: line.id, title: line.division, shots: SHOTS[line.id] ?? ANY_WORK }))];

/** The budget lines this request covers, as they stand on the loan now. */
export const requestLines = (request: Pick<PhotoRequest, "scopeIds">, deal: Pick<Deal, "scope">) => (deal.scope ?? []).filter((line) => request.scopeIds.includes(line.id));

/** After a storm (lib/storms.ts): the property itself, all round, rather than finished work. */
export const STORM_STEP: GuideStep = { id: "storm", title: "After the storm", shots: [
  shot("sides", "Each side of the building", "Front, back and both sides, so the roof line and the windows show."),
  shot("roof", "The roof", "From the ground is fine. Show any missing shingles or tiles."),
  shot("damage", "Any damage, close up", "Water inside, broken windows, fallen trees or fences. Skip it if there's none."),
] };

/** The guide a request's link walks through: the property, then the budget lines asked for, or the storm's checks. */
export const requestSteps = (request: Pick<PhotoRequest, "scopeIds" | "stormId">, deal: Pick<Deal, "scope">): GuideStep[] => (request.stormId ? [PROPERTY_STEP, STORM_STEP] : guideSteps(requestLines(request, deal)));

export type LinkState = "open" | "expired" | "off" | "closed";

/**
 * True once photos can't change anything: the loan is paid off, or its draw has been decided. From approval on, the photos
 * are the evidence for that decision, so they can no longer be added to or taken back.
 */
export const photosClosed = (deal: Pick<Deal, "status"> | undefined, draw: Pick<DrawRequest, "status"> | undefined) => !deal || deal.status === "paid_off" || draw?.status === "approved" || draw?.status === "funded" || draw?.status === "rejected";

/** Whether a link can still take photos. */
export function photoRequestState(request: PhotoRequest, deal: Deal | undefined, draw: DrawRequest | undefined, now = Date.now()): LinkState {
  if (photosClosed(deal, draw)) return "closed";
  if (request.status === "off") return "off";
  if (new Date(request.expiresAt).getTime() < now) return "expired";
  return "open";
}

/** Shots in the guide with no photo yet, so nobody has to count them by eye. */
export function missingShots(steps: GuideStep[], photos: { scopeId: string; shot: string }[]) {
  return steps.flatMap((step) => step.shots.filter((item) => !photos.some((photo) => photo.scopeId === step.id && photo.shot === item.id)).map((item) => ({ step: step.title, shot: item.label })));
}

/** A photo whose file is dated well before it was sent may not show the work as it is now. */
export const looksOld = (takenAt: string | undefined, sentAt: string) => Boolean(takenAt) && new Date(takenAt!).getTime() < new Date(sentAt).getTime() - 3 * 86_400_000;
