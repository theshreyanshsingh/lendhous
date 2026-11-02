"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { canAskForPhotos, scopeBook, type Viewer } from "@/lib/book-access";
import { permissionCheck, readBook, runAction } from "@/lib/book-store";
import { requireUser } from "@/lib/auth";
import type { Book } from "@/lib/book";
import { isDemoEmail } from "@/lib/deploy";
import { sendPhotoLinkMail } from "@/lib/email";
import type { Deal, PhotoRequest } from "@/lib/mockData";
import { viewFor } from "@/lib/permissions";
import { createPhotoLink } from "@/lib/photo-links";
import { PHOTO_LINK_DAYS } from "@/lib/photo-requests";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

export type PhotoLinkReply = { book?: Book; error?: string; link?: string; mail?: "sent" | "logged" | "failed" | "none"; requestId?: string; sentTo?: string };

const expiry = () => new Date(Date.now() + PHOTO_LINK_DAYS * 86_400_000).toISOString();
const longDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

const input = z.object({
  dealId: z.string().min(1).max(120),
  drawId: z.string().min(1).max(120).optional(),
  who: z.enum(["contractor", "borrower"]),
  to: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(200).refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
  scopeIds: z.array(z.string().min(1).max(120)).min(1).max(60),
});

/** Who can act, or why not. Demo seats keep their records in the browser, so they never reach this. */
async function asker(dealId: string) {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  const { book } = await readBook();
  return canAskForPhotos(book, viewer, dealId, await permissionCheck(viewer)) ? { viewer } : { error: "Your account can't ask for photos on this loan." };
}

async function mailLink(request: Pick<PhotoRequest, "to" | "sentBy" | "email" | "expiresAt">, deal: Deal, link: string) {
  if (!request.email) return "none" as const;
  return sendPhotoLinkMail(request.email, { to: request.to, sentBy: request.sentBy, address: `${deal.address}, ${deal.city}`, link, expires: longDate(request.expiresAt) });
}

/** Sends a borrower or contractor a link to a guided page for photos of finished work. They need no account. */
export async function askForPhotos(raw: unknown): Promise<PhotoLinkReply> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "Add a name, a valid email or none, and at least one budget line." };
  const { viewer, error } = await asker(parsed.data.dealId);
  if (!viewer) return { error };
  if (!(await consumeRateLimit(`photo-ask:${viewer.id}`, 30, 60 * 60 * 1000))) return { error: "Too many links for now. Wait a while and try again." };
  const staff = viewFor(viewer.roleCodes) === "admin";
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === parsed.data.dealId)!;
  const scopeIds = parsed.data.scopeIds.filter((id) => deal.scope?.some((line) => line.id === id));
  if (!scopeIds.length) return { error: "Choose at least one budget line on this loan." };
  if (parsed.data.drawId && !book.draws.some((draw) => draw.id === parsed.data.drawId && draw.dealId === deal.id)) return { error: "That draw is no longer on this loan." };
  // A borrower with an account doesn't need their address typed in again.
  const account = !parsed.data.email && parsed.data.who === "borrower" ? await prisma.user.findUnique({ where: { id: deal.borrowerId }, select: { email: true } }) : null;
  const requestId = randomUUID();
  const expiresAt = expiry();
  const sentBy = staff ? `${viewer.name} at LendHous` : viewer.name;
  const email = parsed.data.email || account?.email || undefined;
  const result = await runAction(viewer, { t: "askForPhotos", requestId, dealId: deal.id, drawId: parsed.data.drawId, to: parsed.data.to, email, who: staff ? parsed.data.who : "contractor", scopeIds, by: sentBy, byTeam: staff, expiresAt }, { trusted: true });
  if ("error" in result) return { error: result.error };
  const link = await createPhotoLink(requestId, expiresAt);
  const mail = await mailLink({ to: parsed.data.to, sentBy, email, expiresAt }, deal, link);
  await audit({ actorId: viewer.id, action: "photos.requested", entityType: "LoanBook", entityId: deal.id, after: { photoRequest: requestId, who: parsed.data.who, mail } });
  return { book: scopeBook(result.after, viewer), link, mail, requestId, sentTo: email };
}

/**
 * Only the team changes a link the team sent. Otherwise a borrower could take over the contractor's link and send photos
 * that look like the contractor's.
 */
const mayChange = (viewer: Viewer, request: PhotoRequest) => viewFor(viewer.roleCodes) === "admin" || !request.byTeam;

/** A new link for the same request: for one that expired or got lost, since only its hash is kept. The old one stops working. */
export async function renewPhotoLink(requestId: string): Promise<PhotoLinkReply> {
  const request = (await readBook()).book.photoRequests.find((item) => item.id === String(requestId));
  if (!request) return { error: "That request no longer exists." };
  const { viewer, error } = await asker(request.dealId);
  if (!viewer) return { error };
  if (!mayChange(viewer, request)) return { error: "Only the LendHous team can change a link it sent." };
  const expiresAt = expiry();
  const result = await runAction(viewer, { t: "renewPhotoRequest", requestId: request.id, expiresAt }, { trusted: true });
  if ("error" in result) return { error: result.error };
  const link = await createPhotoLink(request.id, expiresAt);
  const mail = await mailLink({ ...request, expiresAt }, result.after.deals.find((item) => item.id === request.dealId)!, link);
  await audit({ actorId: viewer.id, action: "photos.link_renewed", entityType: "LoanBook", entityId: request.dealId, after: { photoRequest: request.id, mail } });
  return { book: scopeBook(result.after, viewer), link, mail, requestId: request.id, sentTo: request.email };
}

/** Stops a link at once. Photos already sent stay on the loan. */
export async function turnOffPhotoLink(requestId: string): Promise<PhotoLinkReply> {
  const request = (await readBook()).book.photoRequests.find((item) => item.id === String(requestId));
  if (!request) return { error: "That request no longer exists." };
  const { viewer, error } = await asker(request.dealId);
  if (!viewer) return { error };
  if (!mayChange(viewer, request)) return { error: "Only the LendHous team can change a link it sent." };
  const result = await runAction(viewer, { t: "turnOffPhotoRequest", requestId: request.id }, { trusted: true });
  if ("error" in result) return { error: result.error };
  await prisma.photoLink.deleteMany({ where: { requestId: request.id } });
  await audit({ actorId: viewer.id, action: "photos.link_off", entityType: "LoanBook", entityId: request.dealId, after: { photoRequest: request.id } });
  return { book: scopeBook(result.after, viewer) };
}
