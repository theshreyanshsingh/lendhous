// Keeps the loan book in the database. Each change reads the book, runs the rules, and saves only the records that changed,
// all or nothing, and only if nobody else changed the book first. Changes in this process take turns, so they never clash
// with each other; a clash with another process (the nightly jobs) waits a moment and runs again on the newer book.
// The decrypted book is kept in memory and reused until the database says it changed (docs/stress-test-2026-11-22.md).
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { openJson, sealJson } from "@/lib/crypto";
import { can, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadPricing } from "@/lib/pricing-store";
import { BASE_VERSION } from "@/lib/pricing-versions";
import { applyRules, rulesFrom } from "@/lib/settings-rules";
import { getSettings } from "@/lib/settings";

const LISTS = ["deals", "bids", "partners", "buyers", "brokers", "sales", "offers", "draws", "payoffs", "messages", "sources", "photoRequests", "conditionLibrary", "storms", "away"] as const;
const AUDIT_ID = "activity:feed";
const VERSION_ID = "main";
/** Tries at a change that clashes with another process, and at reading the book when the database drops a read. */
const ATTEMPTS = 8;
const READ_ATTEMPTS = 3;
export const BUSY = "We couldn't reach the database just now. Please try again.";

const rowId = (kind: string, id: string) => `${kind}:${id}`;
/** What each record is bound to when it's encrypted, so a row copied over another won't open. */
export const rowContext = (id: string) => `BookRecord:${id}`;
// Newest first, as the reducer builds these lists. Messages read oldest first.
const NEWEST_FIRST = new Set<string>(["deals", "bids", "sales", "offers", "draws", "payoffs", "photoRequests", "storms"]);

/** A wait before trying again: longer each time and random, so two processes don't keep meeting. */
const pause = (attempt: number) => new Promise((resolve) => setTimeout(resolve, Math.min(400, 15 * 2 ** attempt) * (0.5 + Math.random())));

/** The database dropping a connection or a read part way, which reading again can get past. Never a write: it may have landed. */
export function dropped(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code) || (error.code === "P2010" && /I\/O error|early eof|connection|timed out/i.test(error.message));
  return error instanceof Prisma.PrismaClientUnknownRequestError && /I\/O error|early eof|connection/i.test(error.message);
}

/**
 * What the stored book is right now, cheaply: its version (moved by every change), how many records it has and when the
 * latest changed (so a record written some other way, like a key rotation, counts too), and the keys that open it.
 */
type Fingerprint = { version: number; count: number; latest: number; keys: string };
const sameBook = (a: Fingerprint, b: Fingerprint) => a.version === b.version && a.count === b.count && a.latest === b.latest && a.keys === b.keys;
async function fingerprint(client: Prisma.TransactionClient = prisma): Promise<Fingerprint> {
  // The version first, then the records: a change landing in between makes the records newer than the version, which only
  // makes the next save run again. Read the other way round, a save could pass its check on records older than the version.
  const versionRow = await client.bookVersion.findUnique({ where: { id: VERSION_ID } });
  const { _count, _max } = await client.bookRecord.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { version: versionRow?.version ?? 0, count: _count._all, latest: _max.updatedAt?.getTime() ?? 0, keys: process.env.FIELD_ENCRYPTION_KEYS ?? "" };
}

/** The last book read or saved in this process, and what the database looked like then. Never changed in place. */
let kept: { key: Fingerprint; book: Book } | null = null;
/** Forgets the kept book, for tests that rewrite the database underneath it. */
export const forgetBook = () => { kept = null; };

function bookFrom(rows: { id: string; kind: string; data: Prisma.JsonValue }[]) {
  const book = emptyBook();
  for (const row of rows) {
    const data = openJson(row.data, rowContext(row.id));
    if (row.id === AUDIT_ID) book.audit = data as Book["audit"];
    else if ((LISTS as readonly string[]).includes(row.kind)) (book[row.kind as (typeof LISTS)[number]] as unknown[]).push(data);
  }
  for (const list of LISTS) if (NEWEST_FIRST.has(list)) book[list]?.reverse();
  // Loans saved before pricing had versions were priced on the code's numbers, and stay on them.
  book.deals = book.deals.map((deal) => (deal.app.pricingVersion ? deal : { ...deal, app: { ...deal.app, pricingVersion: BASE_VERSION } }));
  return book;
}

/** Reading every record, kept apart so tests can stand in for a database that drops a read. */
export const records = { readAll: () => prisma.bookRecord.findMany({ orderBy: { createdAt: "asc" } }) };

/** Only what's stored: the lists and the activity feed, as a fresh read would give them. */
const storedPart = (book: Book): Book => ({ ...emptyBook(), ...Object.fromEntries(LISTS.map((list) => [list, book[list] ?? []])), audit: book.audit });

/**
 * The book and its version. Reuses the book kept in memory when the database hasn't changed since; otherwise reads and
 * decrypts every record. A read the database drops part way is tried again.
 */
export async function readBook(): Promise<{ book: Book; version: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const key = await fingerprint();
      let book = kept && sameBook(kept.key, key) ? kept.book : null;
      if (!book) {
        book = bookFrom(await records.readAll());
        kept = { key, book };
      }
      await loadPricing(book.deals.map((deal) => deal.app.pricingVersion));
      return { book, version: key.version };
    } catch (error) {
      if (attempt >= READ_ATTEMPTS - 1 || !dropped(error)) throw error;
      await pause(attempt + 2);
    }
  }
}

/** One read per request, however many components ask. */
export const loadBook = cache(() => readBook());

class Conflict extends Error {}

/** Saves what changed, if the book is still at this version, and gives back what the database looks like after. */
async function saveChanges(before: Book, after: Book, version: number): Promise<Fingerprint> {
  const writes: { id: string; kind: string; data: Prisma.InputJsonValue }[] = [];
  const sealed = (id: string, kind: string, value: unknown) => ({ id, kind, data: sealJson(value, rowContext(id)) });
  const removes: string[] = [];
  for (const kind of LISTS) {
    const old = new Map(((before[kind] ?? []) as { id: string }[]).map((item) => [item.id, JSON.stringify(item)]));
    for (const item of (after[kind] ?? []) as { id: string }[]) {
      if (old.get(item.id) !== JSON.stringify(item)) writes.push(sealed(rowId(kind, item.id), kind, item));
      old.delete(item.id);
    }
    for (const id of old.keys()) removes.push(rowId(kind, id));
  }
  if (JSON.stringify(before.audit) !== JSON.stringify(after.audit)) writes.push(sealed(AUDIT_ID, "activity", after.audit));
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.bookVersion.upsert({ where: { id: VERSION_ID }, create: { id: VERSION_ID, version: 0 }, update: {} });
      const { count } = await tx.bookVersion.updateMany({ where: { id: VERSION_ID, version }, data: { version: { increment: 1 } } });
      if (!count) throw new Conflict();
      for (const write of writes) await tx.bookRecord.upsert({ where: { id: write.id }, create: write, update: { data: write.data } });
      if (removes.length) await tx.bookRecord.deleteMany({ where: { id: { in: removes } } });
      // Inside the transaction, so it describes exactly this save.
      return fingerprint(tx);
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    // P2034 is MongoDB reporting the same clash from inside the transaction.
    if (error instanceof Conflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) throw new Conflict();
    throw error;
  }
}

/** Changes in this process wait their turn: run together, they'd only clash with each other. */
let line: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const turn = line.then(work, work);
  line = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Runs the role matrix for this person, including any change to one role and any made just for them. */
export async function permissionCheck(viewer: Viewer) {
  const overrides = await prisma.rolePermission.findMany({ where: { role: { in: viewer.roleCodes } } });
  return (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, overrides: overrides.filter((row) => row.permission === permission), member: viewer });
}

export type BookResult = { error: string } | { before: Book; after: Book; action: BookAction };

/** Checks and runs one action. trusted is for the server's own steps, like recording a file it has just stored. */
export async function runAction(viewer: Viewer, action: BookAction, options: { trusted?: boolean } = {}): Promise<BookResult> {
  const allowed = await permissionCheck(viewer);
  const rules = rulesFrom(await getSettings());
  return inTurn(async () => {
    // The owner's settings the rules follow: the NFIP's date and the draw fees (lib/settings-rules.ts).
    applyRules(rules);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      let read: Awaited<ReturnType<typeof readBook>>;
      try {
        read = await readBook();
      } catch (error) {
        if (dropped(error)) return { error: BUSY };
        throw error;
      }
      const { book, version } = read;
      const checked = authorize(book, viewer, action, allowed, options.trusted);
      if ("error" in checked) return checked;
      let after: Book;
      try {
        after = reducer(book, checked.action);
      } catch {
        return { error: "That record no longer exists." };
      }
      // The rules said no: nothing changed.
      if (after === book) return { error: "That can't be done right now." };
      try {
        const key = await saveChanges(book, after, version);
        kept = { key, book: storedPart(after) };
        return { before: book, after, action: checked.action };
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        await pause(attempt);
      }
    }
    return { error: "Someone else was saving at the same moment. Try again." };
  });
}

export const scopedBook = async (viewer: Viewer) => scopeBook((await loadBook()).book, viewer);
