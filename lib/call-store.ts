// Calls booked from the site, kept encrypted like leads (lib/calls.ts for the times).
import { encryptField, readField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { CallRequest } from "@/lib/calls";

const SEALED = ["name", "email", "phone", "notes"] as const;
const context = (field: (typeof SEALED)[number], id: string) => `CallBooking.${field}:${id}`;

/** The times already taken from now on, for the slots. */
export async function bookedTimes(now = new Date()) {
  const rows = await prisma.callBooking.findMany({ where: { startsAt: { gte: now } }, select: { startsAt: true } });
  return rows.map((row) => row.startsAt.toISOString());
}

/** Saves a booking. A time someone else just took fails on the unique index, and that's reported as taken. */
export async function saveBooking(input: CallRequest): Promise<{ id: string } | { taken: true }> {
  const id = crypto.randomUUID();
  try {
    await prisma.callBooking.create({ data: { id, startsAt: new Date(input.startsAt), topic: input.topic, name: encryptField(input.name.trim(), context("name", id)), email: encryptField(input.email.trim().toLowerCase(), context("email", id)), phone: encryptField(input.phone.trim(), context("phone", id)), notes: encryptField(input.notes.trim(), context("notes", id)) } });
    return { id };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { taken: true };
    throw error;
  }
}

/** The calls from today on, opened for the team. */
export async function upcomingCalls(now = new Date()) {
  const start = new Date(now.getTime() - 12 * 3_600_000);
  const rows = await prisma.callBooking.findMany({ where: { startsAt: { gte: start } }, orderBy: { startsAt: "asc" }, take: 100 });
  return rows.map((row) => ({ id: row.id, startsAt: row.startsAt.toISOString(), topic: row.topic, ...Object.fromEntries(SEALED.map((field) => [field, readField(row[field], context(field, row.id))])) as Record<(typeof SEALED)[number], string> }));
}
