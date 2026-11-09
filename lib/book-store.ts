// Keeps the loan book in the database. Each change reads the book, runs the rules, and saves only the records that changed,
// all or nothing, and only if nobody else changed the book first. A clash just runs the action again on the newer book.
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

const LISTS = ["deals", "bids", "partners", "buyers", "brokers", "sales", "offers", "draws", "payoffs", "messages", "sources", "photoRequests", "conditionLibrary", "storms"] as const;
const AUDIT_ID = "activity:feed";
const VERSION_ID = "main";
const ATTEMPTS = 6;

const rowId = (kind: string, id: string) => `${kind}:${id}`;
/** What each record is bound to when it's encrypted, so a row copied over another won't open. */
export const rowContext = (id: string) => `BookRecord:${id}`;
// Newest first, as the reducer builds these lists. Messages read oldest first.
const NEWEST_FIRST = new Set<string>(["deals", "bids", "sales", "offers", "draws", "payoffs", "photoRequests", "storms"]);

export async function readBook() {
  const [rows, versionRow] = await Promise.all([prisma.bookRecord.findMany({ orderBy: { createdAt: "asc" } }), prisma.bookVersion.findUnique({ where: { id: VERSION_ID } })]);
  const book = emptyBook();
  for (const row of rows) {
    const data = openJson(row.data, rowContext(row.id));
    if (row.id === AUDIT_ID) book.audit = data as Book["audit"];
    else if ((LISTS as readonly string[]).includes(row.kind)) (book[row.kind as (typeof LISTS)[number]] as unknown[]).push(data);
  }
  for (const list of LISTS) if (NEWEST_FIRST.has(list)) book[list].reverse();
  // Loans saved before pricing had versions were priced on the code's numbers, and stay on them.
  book.deals = book.deals.map((deal) => (deal.app.pricingVersion ? deal : { ...deal, app: { ...deal.app, pricingVersion: BASE_VERSION } }));
  await loadPricing(book.deals.map((deal) => deal.app.pricingVersion));
  return { book, version: versionRow?.version ?? 0 };
}

/** One read per request, however many components ask. */
export const loadBook = cache(() => readBook());

class Conflict extends Error {}

async function saveChanges(before: Book, after: Book, version: number) {
  const writes: { id: string; kind: string; data: Prisma.InputJsonValue }[] = [];
  const sealed = (id: string, kind: string, value: unknown) => ({ id, kind, data: sealJson(value, rowContext(id)) });
  const removes: string[] = [];
  for (const kind of LISTS) {
    const old = new Map((before[kind] as { id: string }[]).map((item) => [item.id, JSON.stringify(item)]));
    for (const item of after[kind] as { id: string }[]) {
      if (old.get(item.id) !== JSON.stringify(item)) writes.push(sealed(rowId(kind, item.id), kind, item));
      old.delete(item.id);
    }
    for (const id of old.keys()) removes.push(rowId(kind, id));
  }
  if (JSON.stringify(before.audit) !== JSON.stringify(after.audit)) writes.push(sealed(AUDIT_ID, "activity", after.audit));
  try {
    await prisma.$transaction(async (tx) => {
      await tx.bookVersion.upsert({ where: { id: VERSION_ID }, create: { id: VERSION_ID, version: 0 }, update: {} });
      const { count } = await tx.bookVersion.updateMany({ where: { id: VERSION_ID, version }, data: { version: { increment: 1 } } });
      if (!count) throw new Conflict();
      for (const write of writes) await tx.bookRecord.upsert({ where: { id: write.id }, create: write, update: { data: write.data } });
      if (removes.length) await tx.bookRecord.deleteMany({ where: { id: { in: removes } } });
    });
  } catch (error) {
    // P2034 is MongoDB reporting the same clash from inside the transaction.
    if (error instanceof Conflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) throw new Conflict();
    throw error;
  }
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
  // The owner's settings the rules follow: the NFIP's date and the draw fees (lib/settings-rules.ts).
  applyRules(rulesFrom(await getSettings()));
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { book, version } = await readBook();
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
      await saveChanges(book, after, version);
      return { before: book, after, action: checked.action };
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
    }
  }
  return { error: "Someone else was saving at the same moment. Try again." };
}

export const scopedBook = async (viewer: Viewer) => scopeBook((await loadBook()).book, viewer);
