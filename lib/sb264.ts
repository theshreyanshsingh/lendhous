// Florida's limits on buyers from countries of concern, SB 264 (docs/competitor-gaps-2026-11-09.md, rank 11). A
// "foreign principal" from China, Russia, Iran, North Korea, Cuba, Venezuela's Maduro regime or Syria (Fla. Stat.
// 692.201) can't buy agricultural land (692.202), or land within 10 miles of a military installation or critical
// infrastructure facility (692.203); and one domiciled in China can't buy any Florida real property (692.204). A person
// who is a U.S. citizen or permanent resident isn't a foreign principal. The one exception: a person lawfully here on a
// non-tourist visa or with asylum may buy one home on 2 acres or less, more than 5 miles from a military installation.
// Property bought in breach is forfeited to the state, subject to bona fide lienholders, so the risk to LendHous is the
// borrower's, the title's and the exit's. The buyer signs an affidavit at closing, which the title company collects. A
// partner or buyer that is a foreign principal and takes a property at foreclosure must sell it within 3 years.
// From LendHous's notes on the statutes as amended by ch. 2026-66; the attorney confirms the reading. Pure.
import type { Deal, Sb264Answers } from "./mockData";

/** Countries of concern (692.201(3)), as the codes the screen stores. */
export const COUNTRIES: Record<string, string> = { CN: "China", RU: "Russia", IR: "Iran", KP: "North Korea", CU: "Cuba", VE: "Venezuela (the Maduro regime)", SY: "Syria" };
export const DOMICILES: Record<string, string> = { US: "The United States", ...COUNTRIES, OTHER: "Another country" };
const RESIDENTIAL = ["sfr", "2_4", "condo", "townhome"];

/** The people on the loan as the application already records them: U.S. citizens and permanent residents need no answers. */
export function prefilledPeople(deal: Pick<Deal, "borrowerName" | "sponsor" | "app">): Sb264Answers["people"] {
  const guarantors = deal.sponsor?.guarantors ?? [];
  if (!guarantors.length) return [{ name: deal.borrowerName, domicile: deal.app.foreignNational ? "" : "US", status: deal.app.foreignNational ? "other" : "citizen", visa: "none" }];
  return guarantors.map((item) => ({ name: item.name, domicile: item.citizenship === "foreign" ? "" : "US", status: item.citizenship === "us" ? "citizen" : item.citizenship === "resident" ? "permanent_resident" : "other", visa: "none" }));
}

export type Sb264State = "clear" | "answers_needed" | "stop";

/** What Florida's limits say about this purchase, with why. Null when the loan isn't buying property. */
export function sb264Check(deal: Pick<Deal, "app" | "borrowerName" | "sponsor" | "sb264">): { state: Sb264State; lines: string[] } | null {
  if (deal.app.purpose !== "purchase") return null;
  const answers = deal.sb264;
  const people = answers?.people.length ? answers.people : prefilledPeople(deal);
  const entityCountry = answers?.entityCountry ?? "US";
  const lines: string[] = [];
  const unanswered = people.filter((person) => person.status === "other" && !person.domicile);
  // A citizen or permanent resident isn't a foreign principal, wherever they live.
  const concern = people.filter((person) => person.status === "other" && person.domicile in COUNTRIES);
  const entityConcern = entityCountry in COUNTRIES;
  const exceptionFits = (person: Sb264Answers["people"][number]) => person.visa !== "none" && RESIDENTIAL.includes(deal.app.propertyType) && (answers?.acres ?? Infinity) <= 2 && answers?.militaryWithin5 === "no";
  const stops: string[] = [];
  if (unanswered.length) lines.push(`Say where ${unanswered.map((person) => person.name).join(" and ")} ${unanswered.length === 1 ? "is" : "are"} domiciled.`);
  if (answers?.agricultural && (concern.length || entityConcern)) stops.push("A foreign principal from a country of concern can't buy agricultural land (692.202).");
  if (entityCountry === "CN") stops.push("The borrowing entity is organized in, or run from, China, so it can't buy Florida real property (692.204).");
  for (const person of concern.filter((item) => item.domicile === "CN")) {
    if (exceptionFits(person)) lines.push(`${person.name} is domiciled in China and relies on the one-home exception: a non-tourist visa or asylum, one home on 2 acres or less, more than 5 miles from a military installation (692.204(2)). The attorney confirms it and that it's their only such property.`);
    else stops.push(`${person.name} is domiciled in China and isn't a U.S. citizen or permanent resident, so can't buy Florida real property (692.204), unless the one-home exception fits.`);
  }
  const others = [...concern.filter((item) => item.domicile !== "CN"), ...(entityConcern && entityCountry !== "CN" ? [{ name: "The borrowing entity", visa: "none" as const, domicile: entityCountry, status: "other" as const }] : [])];
  if (others.length) {
    const near = answers?.sensitiveWithin10 ?? "unknown";
    if (near === "unknown") lines.push(`${others.map((item) => item.name).join(" and ")} ${others.length === 1 ? "is" : "are"} from ${[...new Set(others.map((item) => COUNTRIES[item.domicile]))].join(" and ")}: find out whether the property is within 10 miles of a military installation or critical infrastructure facility (692.203).`);
    else if (near === "yes") for (const item of others) {
      if (item.name !== "The borrowing entity" && exceptionFits(item)) lines.push(`${item.name} relies on the one-home exception near a military installation or critical infrastructure (692.203). The attorney confirms it.`);
      else stops.push(`${item.name}, from ${COUNTRIES[item.domicile]}, can't buy property within 10 miles of a military installation or critical infrastructure facility (692.203).`);
    }
  }
  if (stops.length) return { state: "stop", lines: [...stops, ...lines] };
  if (unanswered.length || lines.some((line) => line.startsWith("Say where") || line.includes("find out whether"))) return { state: "answers_needed", lines };
  return { state: "clear", lines: lines.length ? lines : ["No buyer is a foreign principal from a country of concern."] };
}

/** What holds a purchase at clear to close under SB 264, or null. */
export function sb264Blocker(deal: Pick<Deal, "app" | "borrowerName" | "sponsor" | "sb264">) {
  const result = sb264Check(deal);
  if (result?.state === "stop") return "Florida's limits on buyers from countries of concern stop this purchase (SB 264, Credit review tab)";
  if (result?.state === "answers_needed") return "Answer the SB 264 questions on buyers from countries of concern (Credit review tab)";
  return null;
}

export type Sb264Input = Omit<Sb264Answers, "by" | "at">;

/** Why the answers can't be saved, or null. */
export function sb264Problem(deal: Pick<Deal, "app"> | undefined, input: Sb264Input) {
  if (!deal) return "That loan no longer exists.";
  if (deal.app.purpose !== "purchase") return "These questions are for a purchase.";
  if (!input.people.length) return "Add each buyer.";
  if (input.people.some((person) => !person.name.trim() || (person.domicile && !(person.domicile in DOMICILES)))) return "Give each person's name and where they're domiciled.";
  if (!(input.entityCountry in DOMICILES)) return "Say where the borrowing entity is organized or run from.";
  if (input.acres !== undefined && !(input.acres > 0 && input.acres < 100_000)) return "Enter the lot's size in acres, or leave it blank.";
  return null;
}
