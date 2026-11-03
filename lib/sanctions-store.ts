// Treasury's sanctions list in the database, and screening a loan against it. The nightly job downloads the list; each
// screening reads it once and keeps it in memory until a newer one is saved.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Deal, Screening } from "./mockData";
import { parseAliases, parseSdn, prepareList, screeningOf, screeningSubjects, type ListEntry, type PreparedList } from "./ofac";
import { prisma } from "./prisma";

const LIST_ID = "sdn";
// Treasury's own addresses; they redirect to its Sanctions List Service. Overridable in case Treasury moves them.
const SDN_URL = () => process.env.OFAC_SDN_URL || "https://www.treasury.gov/ofac/downloads/sdn.csv";
const ALT_URL = () => process.env.OFAC_ALT_URL || "https://www.treasury.gov/ofac/downloads/alt.csv";
// A real list has well over ten thousand names. Far fewer means a broken download, which must not replace a good list.
const MIN_NAMES = 5_000;

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Downloads the list and saves it if it changed. Keeps the old one if the download fails or looks wrong. */
export async function refreshSanctionsList(fetcher: Fetch = fetch, now = new Date()) {
  const get = async (url: string) => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`The OFAC list download failed (${response.status} from ${url}).`);
    return response.text();
  };
  const [sdn, alt] = await Promise.all([get(SDN_URL()), get(ALT_URL())]);
  const primaries = parseSdn(sdn);
  const entries = [...primaries, ...parseAliases(alt, primaries)];
  if (entries.length < MIN_NAMES) throw new Error(`The OFAC list download had only ${entries.length} names; kept the previous list.`);
  const hash = createHash("sha256").update(sdn).update(alt).digest("hex");
  const prior = await prisma.sanctionsList.findUnique({ where: { id: LIST_ID }, select: { hash: true } });
  const changed = prior?.hash !== hash;
  if (changed) await prisma.sanctionsList.upsert({ where: { id: LIST_ID }, create: { id: LIST_ID, fetchedAt: now, names: entries.length, hash, entries: entries as unknown as Prisma.InputJsonValue }, update: { fetchedAt: now, names: entries.length, hash, entries: entries as unknown as Prisma.InputJsonValue } });
  else await prisma.sanctionsList.update({ where: { id: LIST_ID }, data: { fetchedAt: now } });
  return { names: entries.length, changed };
}

let cached: { hash: string; fetchedAt: Date; list: PreparedList } | null = null;

/** The saved list, or null if it has never been downloaded. */
export async function sanctionsList() {
  const head = await prisma.sanctionsList.findUnique({ where: { id: LIST_ID }, select: { hash: true, fetchedAt: true } });
  if (!head) return null;
  if (cached?.hash !== head.hash) {
    const row = await prisma.sanctionsList.findUniqueOrThrow({ where: { id: LIST_ID } });
    cached = { hash: row.hash, fetchedAt: row.fetchedAt, list: prepareList(row.entries as unknown as ListEntry[]) };
  }
  return { ...cached, fetchedAt: head.fetchedAt };
}

export const sanctionsListDate = async () => (await prisma.sanctionsList.findUnique({ where: { id: LIST_ID }, select: { fetchedAt: true, names: true } })) ?? null;

/** Screens everyone on a loan. Errors if the list has never been downloaded: a screening against nothing proves nothing. */
export async function screenDeal(deal: Deal, by: string, now = new Date()): Promise<Screening | { error: string }> {
  const loaded = await sanctionsList();
  if (!loaded) return { error: "The OFAC list hasn't been downloaded yet. The nightly sanctions job does it; run it once to start." };
  return screeningOf(screeningSubjects(deal), loaded.list, { id: `ofac${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now.toISOString(), by, fetchedAt: loaded.fetchedAt.toISOString() });
}
