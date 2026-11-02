// The link behind a photo request. Like a password link it's a random secret and only its hash is stored, but it can be
// opened many times until it expires, because a contractor may send photos over a few visits.
import { createHash, randomBytes } from "node:crypto";
import type { Viewer } from "@/lib/book-access";
import { readBook } from "@/lib/book-store";
import type { PhotoRequest } from "@/lib/mockData";
import { photoRequestState } from "@/lib/photo-requests";
import { prisma } from "@/lib/prisma";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/** Makes this request's link, replacing any earlier one. The address comes back once and is never stored. */
export async function createPhotoLink(requestId: string, expiresAt: string) {
  const token = randomBytes(32).toString("base64url");
  // One row per request, so two new links made at once still leave only one that works.
  const data = { tokenHash: hashOf(token), expiresAt: new Date(expiresAt) };
  await prisma.photoLink.upsert({ where: { requestId }, create: { requestId, ...data }, update: data });
  return `${origin()}/photos/${token}`;
}

/** What a link opens, or null if it's unknown or past its date. The caller still checks state before accepting anything. */
export async function openPhotoLink(token: string) {
  if (!token || token.length > 100) return null;
  const row = await prisma.photoLink.findUnique({ where: { tokenHash: hashOf(token) } });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const { book } = await readBook();
  const request = book.photoRequests.find((item) => item.id === row.requestId);
  const deal = book.deals.find((item) => item.id === request?.dealId);
  if (!request || !deal) return null;
  const draw = book.draws.find((item) => item.id === request.drawId);
  return { request, deal, draw, state: photoRequestState(request, deal, draw) };
}

/** Who the server acts as for someone holding a link. No roles, so it can do nothing a trusted step doesn't do for it. */
export const linkActor = (request: PhotoRequest): Viewer => ({ id: `photo-link:${request.id}`, name: request.to, roleCodes: [] });
