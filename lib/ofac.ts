// Sanctions (OFAC) screening, the part that needs no database: reading Treasury's list, comparing names to it, and
// deciding whether a loan may move. Every U.S. lender is strictly liable for dealing with someone on the list (31 CFR
// 501), so the borrowing company, the borrower and each guarantor are checked at application, re-checked every night,
// and checked again within a few days of any money going out. A possible match stops the loan until someone reviews it.
import type { Deal, Screening, ScreeningHit, ScreeningRole } from "./mockData";
import { servicingDate } from "./servicing";

/** PLACEHOLDER policy until counsel sets it: how recent a clean check must be before money goes out, and how close a name must be to flag. */
export const OFAC = { freshDays: 3, flagScore: 0.9 };

/** One name on Treasury's list: [entry number, name, type, programs]. Aliases share their entry's number. */
export type ListEntry = [number, string, string, string];

/** Parses one CSV line the way Treasury writes them: commas, double quotes, and "-0-" for empty. */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { out.push(field); field = ""; } else field += char;
  }
  out.push(field);
  return out.map((value) => (value.trim() === "-0-" ? "" : value.trim()));
}

/** SDN.CSV: entry number, name, type (blank for a company), programs, and more columns that aren't needed here. */
export function parseSdn(text: string): ListEntry[] {
  return text.split(/\r?\n/).filter((line) => /^\d/.test(line)).map(csvLine).filter((row) => row[1]).map((row) => [Number(row[0]), row[1], row[2] || "entity", row[3]]);
}

/** ALT.CSV: entry number, alias number, kind (a.k.a., f.k.a.), alias. Each takes its entry's type and programs. */
export function parseAliases(text: string, primaries: ListEntry[]): ListEntry[] {
  const byUid = new Map(primaries.map((entry) => [entry[0], entry]));
  return text.split(/\r?\n/).filter((line) => /^\d/.test(line)).map(csvLine).flatMap((row) => {
    const main = byUid.get(Number(row[0]));
    return main && row[3] ? [[main[0], row[3], main[2], main[3]] as ListEntry] : [];
  });
}

// Words that say what kind of company it is, not which one.
const NOISE = new Set(["LLC", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "LP", "LLP", "PLLC", "PA", "SA", "THE", "FAKE"]);

/** Upper case, no accents or punctuation, no company-type words. "Peña Holdings, L.L.C." → ["PENA", "HOLDINGS"]. */
export function nameTokens(name: string) {
  const plain = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/&/g, " AND ").replace(/['’.]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  return [...new Set(plain.split(" ").filter((token) => token.length > 1 && !NOISE.has(token)))];
}

/** Jaro-Winkler similarity, 0 to 1: forgiving of typos and transliterations, strict about different names. */
export function jaroWinkler(a: string, b: string) {
  if (a === b) return 1;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aUsed = new Array<boolean>(a.length).fill(false);
  const bUsed = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bUsed[j] || a[i] !== b[j]) continue;
      aUsed[i] = bUsed[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0, swaps = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aUsed[i]) continue;
    while (!bUsed[k]) k++;
    if (a[i] !== b[k]) swaps++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - swaps / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * How closely two names match, 0 to 1. Word order doesn't matter ("SMITH, John" is John Smith), and every word of the
 * shorter name has to be close to a word in the longer one, so one shared surname or word isn't a match.
 */
export function nameScore(query: string[], candidate: string[]) {
  const need = Math.min(query.length, candidate.length);
  if (!need) return 0;
  const [short, long] = query.length <= candidate.length ? [query, candidate] : [candidate, query];
  const best = short.map((token) => Math.max(...long.map((other) => jaroWinkler(token, other)))).sort((x, y) => y - x);
  // A one-word name only matches a one-word name, and closely: "CIMEX" is a company; "SMITH" alone is nobody.
  if (need === 1 && (long.length > 1 || short[0].length < 4 || best[0] < 0.95)) return 0;
  if (best.some((score) => score < 0.85)) return 0;
  return best.reduce((sum, score) => sum + score, 0) / best.length;
}

export type PreparedList = { entries: ListEntry[]; tokens: string[][] };
export const prepareList = (entries: ListEntry[]): PreparedList => ({ entries, tokens: entries.map((entry) => nameTokens(entry[1])) });

/** The list entries close to a name, best first, one per listed party. */
export function screenName(name: string, list: PreparedList): ScreeningHit[] {
  const query = nameTokens(name);
  if (!query.length) return [];
  const initials = new Set(query.map((token) => token[0]));
  const byUid = new Map<number, ScreeningHit>();
  list.entries.forEach((entry, index) => {
    const tokens = list.tokens[index];
    if (!tokens.some((token) => initials.has(token[0]))) return;
    const score = nameScore(query, tokens);
    if (score < OFAC.flagScore) return;
    const prior = byUid.get(entry[0]);
    if (!prior || prior.score < score) byUid.set(entry[0], { uid: entry[0], name: entry[1], type: entry[2], program: entry[3], score: Math.round(score * 1000) / 1000 });
  });
  return [...byUid.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Who on a loan is screened: the borrowing company, the borrower, and each guarantor, once each. */
export function screeningSubjects(deal: Pick<Deal, "entityName" | "borrowerName" | "sponsor">): { name: string; role: ScreeningRole }[] {
  const all: { name: string; role: ScreeningRole }[] = [
    { name: deal.entityName, role: "entity" as const },
    { name: deal.borrowerName, role: "borrower" as const },
    ...(deal.sponsor?.guarantors ?? []).map((guarantor) => ({ name: guarantor.name, role: "guarantor" as const })),
  ].filter((subject) => subject.name.trim());
  const seen = new Set<string>();
  return all.filter((subject) => { const key = nameTokens(subject.name).join(" "); if (seen.has(key)) return false; seen.add(key); return true; });
}

export const latestScreening = (deal: Pick<Deal, "screenings">) => deal.screenings?.at(-1);

/** Names on the loan now that the latest screening didn't check: a guarantor added since, or a renamed company. */
export function unscreenedNames(deal: Pick<Deal, "entityName" | "borrowerName" | "sponsor" | "screenings">) {
  const checked = new Set((latestScreening(deal)?.subjects ?? []).map((subject) => nameTokens(subject.name).join(" ")));
  return screeningSubjects(deal).filter((subject) => !checked.has(nameTokens(subject.name).join(" "))).map((subject) => subject.name);
}

/** The result of checking a loan's names: clear, or a possible match for someone to review. */
export function screeningOf(subjects: { name: string; role: ScreeningRole }[], list: PreparedList, meta: { id: string; at: string; by: string; fetchedAt: string }): Screening {
  const checked = subjects.map((subject) => ({ ...subject, hits: screenName(subject.name, list) }));
  return { id: meta.id, at: meta.at, by: meta.by, checkedAt: meta.at, list: { fetchedAt: meta.fetchedAt, names: list.entries.length }, subjects: checked, status: checked.some((subject) => subject.hits.length) ? "review" : "clear" };
}

/** Two screenings found the same names and the same hits. */
export const sameResult = (a: Screening, b: Screening) => JSON.stringify(a.subjects.map((subject) => [nameTokens(subject.name).join(" "), subject.hits.map((hit) => hit.uid)])) === JSON.stringify(b.subjects.map((subject) => [nameTokens(subject.name).join(" "), subject.hits.map((hit) => hit.uid)]));

/**
 * What stops a loan on sanctions grounds, or null. Needs a clean (or reviewed and cleared) screening of everyone on the
 * loan; when money is about to go out, one from the last few days.
 */
export function ofacBlocker(deal: Pick<Deal, "entityName" | "borrowerName" | "sponsor" | "screenings">, today?: string) {
  const latest = latestScreening(deal);
  if (!latest) return "Not screened against the OFAC sanctions list yet";
  if (latest.status === "match") return "Confirmed OFAC sanctions match: no money can move on this loan";
  if (latest.status === "review") return "A possible OFAC sanctions match needs review";
  const missing = unscreenedNames(deal);
  if (missing.length) return `${missing.join(", ")} not screened against the OFAC list yet`;
  if (today) {
    const since = new Date(Date.parse(today) - OFAC.freshDays * 86_400_000).toISOString().slice(0, 10);
    // Days are Florida days, like everything else about these loans.
    if (servicingDate(new Date(latest.checkedAt)) < since) return `The OFAC screening is more than ${OFAC.freshDays} days old: screen again before money goes out`;
  }
  return null;
}
