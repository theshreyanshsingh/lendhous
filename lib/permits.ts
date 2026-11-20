// Permits by budget line (docs/competitor-gaps-2026-11-09.md, rank 18). In Florida a roof, electrical, plumbing, HVAC,
// structural, window and door, or demolition job needs a building permit, so LendHous flags those lines of the scope, holds
// a line's draw until a permit covering it is issued, and holds the final draw while any permit is still open or has
// lapsed: unpermitted work is a code case the property carries after LendHous is repaid, and a buyer's lender won't take
// it. The team records each permit (one can cover several lines) or marks a line as not needing one, with why. An owner
// can still release a draw past a hold, with a reason, as with the lien-law holds (lib/lien-law.ts), and turns the holds
// off in Settings. Pure, given that setting.
import type { Deal, DrawRequest, Permit, ScopeLine } from "./mockData";

/** The work that usually takes a permit, by words in the line's name or id. PLACEHOLDER until GT and the attorney confirm the list. */
const PERMIT_WORK: [RegExp, string][] = [
  [/roof/i, "a roofing permit"],
  [/electric|mechanical|\bmep\b/i, "an electrical permit"],
  [/plumb|water heater|mechanical|\bmep\b/i, "a plumbing permit"],
  [/hvac|a\/c|air condition|mechanical|\bmep\b/i, "a mechanical (HVAC) permit"],
  [/structur|framing|foundation|load.?bearing|addition/i, "a building permit"],
  [/window|door|shutter|exterior opening/i, "a window and door permit"],
  [/demoli/i, "a demolition permit"],
  [/pool|solar|gas\b|generator|fence|seawall|dock/i, "a permit"],
];

// Off until Settings switches it on (on by default there); tests and pages set it the way they set the title search.
let holdOn = false;
export const permitHoldsOn = () => holdOn;
export const setPermitHolds = (on: boolean) => { holdOn = on !== false; };

export const PERMIT_STATUS: Record<Permit["status"], string> = { applied: "Applied for", issued: "Issued", finaled: "Finaled (closed)", expired: "Expired" };

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);

/** The permits a line usually needs, or none. */
export function permitsFor(line: Pick<ScopeLine, "id" | "division">): string[] {
  const words = `${line.id} ${line.division}`;
  return [...new Set(PERMIT_WORK.filter(([pattern]) => pattern.test(words)).map(([, permit]) => permit))];
}

/** The lines that need a permit, and whether the team has said one isn't needed. */
export function permitLines(deal: Pick<Deal, "scope" | "permitWaivers">) {
  return (deal.scope ?? []).flatMap((line) => {
    const needs = permitsFor(line);
    if (!needs.length) return [];
    return [{ line, needs, waived: (deal.permitWaivers ?? []).find((item) => item.scopeId === line.id) }];
  });
}

/** A permit counts once issued, until it lapses; a finaled one is done. */
export const permitLive = (permit: Permit, today: string) => permit.status === "finaled" || (permit.status === "issued" && !(permit.expiresOn && permit.expiresOn < today));
const permitLapsed = (permit: Permit, today: string) => permit.status === "expired" || (permit.status === "issued" && Boolean(permit.expiresOn && permit.expiresOn < today));

export type LineState = "not_needed" | "missing" | "applied" | "issued" | "finaled" | "lapsed";

/** Where one line's permit stands. */
export function lineState(deal: Pick<Deal, "permits" | "permitWaivers">, scopeId: string, today: string): LineState {
  if ((deal.permitWaivers ?? []).some((item) => item.scopeId === scopeId)) return "not_needed";
  const covering = (deal.permits ?? []).filter((permit) => permit.scopeIds.includes(scopeId));
  if (covering.some((permit) => permit.status === "finaled")) return "finaled";
  if (covering.some((permit) => permitLive(permit, today))) return "issued";
  if (covering.some((permit) => permitLapsed(permit, today))) return "lapsed";
  return covering.length ? "applied" : "missing";
}

export const LINE_STATE: Record<LineState, string> = { not_needed: "Not needed", missing: "No permit on file", applied: "Applied for", issued: "Issued", finaled: "Finaled", lapsed: "Lapsed" };

/**
 * What the permits hold on this draw: each line it pays that needs a permit without a live one, and on the last draw
 * every permit that isn't finaled.
 */
export function permitHolds(deal: Pick<Deal, "scope" | "permits" | "permitWaivers">, draw: Pick<DrawRequest, "lines">, final: boolean, today: string): string[] {
  const holds: string[] = [];
  if (!holdOn) return holds;
  const asked = new Set(draw.lines.filter((line) => line.requested > 0).map((line) => line.scopeId));
  for (const { line, needs } of permitLines(deal)) {
    if (!asked.has(line.id)) continue;
    const state = lineState(deal, line.id, today);
    if (state === "missing" || state === "applied") holds.push(`${line.division} needs ${needs[0]} before its draw, and ${state === "applied" ? "it's only applied for" : "none is on file"}.`);
    else if (state === "lapsed") holds.push(`The permit for ${line.division} has lapsed; it's renewed before its draw.`);
  }
  if (final) {
    for (const permit of deal.permits ?? []) {
      if (permit.status === "finaled") continue;
      holds.push(`Permit ${permit.number} isn't finaled yet: the building department closes it before the last draw.`);
    }
  }
  return holds;
}

/** Lines the scope says need a permit with none issued yet, for the team's list. */
export function permitsMissing(deal: Pick<Deal, "scope" | "permits" | "permitWaivers">, today: string) {
  return permitLines(deal).filter(({ line }) => ["missing", "applied", "lapsed"].includes(lineState(deal, line.id, today)));
}

export type PermitInput = Omit<Permit, "id" | "by" | "at"> & { id?: string };

/** Why a permit can't be saved as entered, or null. */
export function permitProblem(deal: Pick<Deal, "scope" | "permits">, input: PermitInput, today: string) {
  if (!input.number.trim()) return "Add the permit number.";
  if (!input.jurisdiction.trim()) return "Add the city or county that issued it.";
  if (!input.scopeIds.length) return "Choose the budget lines it covers.";
  if (input.scopeIds.some((id) => !(deal.scope ?? []).some((line) => line.id === id))) return "That budget line isn't on this loan.";
  if (!(input.status in PERMIT_STATUS)) return "Choose where the permit stands.";
  if (input.id && !(deal.permits ?? []).some((item) => item.id === input.id)) return "That permit isn't on this loan any more.";
  for (const [day, label] of [[input.issuedOn, "issued"], [input.finaledOn, "finaled"]] as const) if (day && (!isDay(day) || day > today)) return `Enter the day it was ${label}, today or earlier.`;
  if (input.expiresOn && !isDay(input.expiresOn)) return "Enter the day it expires.";
  if ((input.status === "issued" || input.status === "finaled") && !input.issuedOn) return "Add the day it was issued.";
  if (input.status === "finaled" && !input.finaledOn) return "Add the day the final inspection passed.";
  return null;
}

/** A short line on a permit for the list. */
export function permitWords(permit: Permit, today: string) {
  if (permit.status === "finaled") return `Finaled ${longDay(permit.finaledOn!)}`;
  if (permitLapsed(permit, today)) return permit.expiresOn ? `Lapsed ${longDay(permit.expiresOn)}` : "Expired";
  if (permit.status === "issued") return `Issued ${longDay(permit.issuedOn!)}${permit.expiresOn ? `, good to ${longDay(permit.expiresOn)}` : ""}`;
  return "Applied for";
}
