// Wind mitigation and flood history (docs/competitor-gaps-2026-11-09.md, rank 15). Florida insurers have to offer
// discounts for a building's hurricane-resistant features (Fla. Stat. 627.0629), and take the uniform mitigation
// verification form (OIR-B1-1802) signed by a licensed inspector as proof of them (627.711). The processor records the
// form's answers on the insurance file: a lower premium is a lower payment, which lifts a rental's coverage. On a
// purchase, the seller has to give the buyer a flood disclosure at or before the contract (689.302): whether they know
// of flooding that damaged it, filed a flood claim, or got FEMA or other help for flood damage. A "yes" is worth knowing
// before LendHous lends on it, even outside a special flood hazard area. A landlord's matching disclosure on leases of a
// year or more (83.512) is a standard condition for rentals (lib/conditions.ts). Pure.
import type { Deal, FloodDisclosure, MitigationForm } from "./mockData";

/** PLACEHOLDER until the attorney confirms it: how long insurers treat an inspection as current (OIR's form says five years). */
export const MITIGATION_RULES = { validYears: 5 };

export const ROOF_DECK: Record<MitigationForm["roofDeck"], string> = { A: "A: 6d nails, 6\" edge / 12\" field", B: "B: 8d nails, 6\" / 12\"", C: "C: 8d nails, 6\" / 6\"", D: "D: reinforced concrete deck", other: "Other or unknown" };
export const ROOF_TO_WALL: Record<MitigationForm["roofToWall"], string> = { toe_nails: "Toe nails", clips: "Clips", single_wraps: "Single wraps", double_wraps: "Double wraps", structural: "Structural (anchor bolts, poured)", unknown: "Unknown or not verified" };
export const ROOF_SHAPE: Record<MitigationForm["roofShape"], string> = { hip: "Hip roof", flat: "Flat roof", other: "Other (gable and the rest)" };
export const OPENINGS: Record<MitigationForm["openings"], string> = { all: "Every opening impact-rated or shuttered", some: "Some openings protected", none: "No opening protection" };

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);
const yearsAfter = (day: string, years: number) => `${Number(day.slice(0, 4)) + years}${day.slice(4)}`;

/** The features on the form that insurers give wind credits for. */
export function mitigationCredits(form: MitigationForm): string[] {
  const credits: string[] = [];
  if (form.builtToCode) credits.push("Built to the 2001 Florida Building Code or later");
  if (form.roofCovering) credits.push("Roof covering meets the Florida Building Code");
  if (form.roofDeck === "B" || form.roofDeck === "C" || form.roofDeck === "D") credits.push(`Roof deck attachment ${form.roofDeck}`);
  if (form.roofToWall !== "toe_nails" && form.roofToWall !== "unknown") credits.push(`Roof-to-wall ${ROOF_TO_WALL[form.roofToWall].toLowerCase().replace(/ \(.*\)$/, "")}`);
  if (form.roofShape === "hip") credits.push("Hip roof");
  if (form.swr) credits.push("Secondary water resistance");
  if (form.openings === "all") credits.push("Every opening protected");
  return credits;
}

/** The day the inspection stops counting. */
export const mitigationValidUntil = (form: Pick<MitigationForm, "inspectedOn">) => yearsAfter(form.inspectedOn, MITIGATION_RULES.validYears);

export type MitigationNote = { tone: "good" | "warn" | "note"; text: string };

/** What to say about the loan's wind mitigation form, if anything. */
export function mitigationNote(deal: Pick<Deal, "insurance" | "app">, today: string): MitigationNote | null {
  const form = deal.insurance?.mitigation;
  if (!form) {
    if (deal.app.product !== "dscr" && deal.app.product !== "bridge") return null;
    return { tone: "note", text: "No wind mitigation form on file. Insurers have to give credits for hurricane features (Fla. Stat. 627.0629); a form from a licensed inspector (627.711) can lower the premium and lift the rental's coverage." };
  }
  const until = mitigationValidUntil(form);
  const credits = mitigationCredits(form);
  if (until < today) return { tone: "warn", text: `The wind mitigation inspection from ${longDay(form.inspectedOn)} ran out ${longDay(until)}: a new one keeps the credits at renewal.` };
  return { tone: credits.length ? "good" : "note", text: credits.length ? `${credits.length} wind credit${credits.length === 1 ? "" : "s"} on the form, good to ${longDay(until)}. Make sure the insurer has it.` : `The form shows no wind credits; it's good to ${longDay(until)}.` };
}

export type MitigationInput = Omit<MitigationForm, "by" | "at">;

/** Why the form can't be saved as entered, or null. */
export function mitigationProblem(input: MitigationInput, today: string) {
  if (!isDay(input.inspectedOn) || input.inspectedOn > today) return "Enter the day of the inspection, not after today.";
  if (!input.inspector.trim()) return "Add who signed the form.";
  if (!(input.roofDeck in ROOF_DECK) || !(input.roofToWall in ROOF_TO_WALL) || !(input.roofShape in ROOF_SHAPE) || !(input.openings in OPENINGS)) return "Answer each part of the form.";
  return null;
}

/** A purchase is where the seller's disclosure applies. */
export const sellerDisclosureApplies = (deal: Pick<Deal, "app">) => deal.app.purpose === "purchase";

export type FloodFlag = { level: "bad" | "warn" | "note"; text: string };

/** What the seller's flood disclosure says that the team should act on, worst first. Empty when it's clean. */
export function sellerFloodFlags(deal: Pick<Deal, "app" | "insurance">): FloodFlag[] {
  if (!sellerDisclosureApplies(deal)) return [];
  const disclosure = deal.insurance?.sellerFlood;
  if (!disclosure) return [{ level: "note", text: "The seller's flood disclosure (Fla. Stat. 689.302) isn't recorded. Ask for it from the contract package." }];
  if (!disclosure.given) return [{ level: "warn", text: "The seller didn't give the flood disclosure Florida requires at the contract (689.302). Ask the seller, through the title company, whether it has flooded." }];
  const yes = [disclosure.flooding && "knows of flooding that damaged it", disclosure.claim && "filed a flood insurance claim", disclosure.assistance && "received FEMA or other help for flood damage"].filter((item): item is string => Boolean(item));
  if (!yes.length) return [];
  const flags: FloodFlag[] = [{ level: "bad", text: `The seller ${yes.length === 1 ? yes[0] : `${yes.slice(0, -1).join(", ")} and ${yes[yes.length - 1]}`}. Ask for the dates, the claim and what was repaired, and check the inspection and appraisal for water damage.` }];
  if (deal.insurance?.flood && !deal.insurance.flood.sfha) flags.push({ level: "warn", text: "It has flooded though it isn't in a special flood hazard area: consider asking for flood insurance anyway." });
  return flags;
}

export type FloodDisclosureInput = Omit<FloodDisclosure, "by" | "at">;

/** Why the disclosure can't be saved as entered, or null. */
export function floodDisclosureProblem(deal: Pick<Deal, "app">, input: FloodDisclosureInput) {
  if (!sellerDisclosureApplies(deal)) return "Only a purchase has a seller's flood disclosure.";
  if (input.given && [input.flooding, input.claim, input.assistance].some((answer) => answer === undefined)) return "Answer each of the three questions as the seller did.";
  return null;
}
