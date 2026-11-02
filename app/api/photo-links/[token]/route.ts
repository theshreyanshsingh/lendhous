import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { sendAlerts } from "@/lib/book-alerts";
import { runAction } from "@/lib/book-store";
import { encryptField } from "@/lib/crypto";
import { linkActor, openPhotoLink } from "@/lib/photo-links";
import { guideSteps, MAX_PHOTOS_PER_LINK, requestLines } from "@/lib/photo-requests";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { attachmentName, documentNameContext, photoProblem } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** The link if it can still take changes, or the reply explaining why not. Runs before any upload body is read. */
async function openForChanges(token: string) {
  const link = await openPhotoLink(token);
  if (!link) return { refused: refuse("This link has expired or isn't valid. Ask for a new one.", 404) };
  if (link.state !== "open") return { refused: refuse("This link has been turned off. Ask for a new one.", 410) };
  if (!(await consumeRateLimit(`photo-link:${link.request.id}`, 400, 60 * 60 * 1000))) return { refused: refuse("Too many photos at once. Wait a while and try again.", 429) };
  return { link };
}

// What the phone says about a photo. Useful to whoever reviews it, but never trusted beyond being a date and two numbers.
const about = z.object({
  takenAt: z.string().datetime().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** Adds one photo. They go up one at a time, so a dropped connection only ever costs the one being sent. */
export async function POST(request: Request, { params }: Context) {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return refuse("That photo is too large. The limit is 15 MB.", 413);
  const { refused, link } = await openForChanges((await params).token);
  if (!link) return refused;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return refuse("Choose a photo.", 400);
  if (link.request.photos.length >= MAX_PHOTOS_PER_LINK) return refuse(`This link is full at ${MAX_PHOTOS_PER_LINK} photos. Remove one or ask for a new link.`, 409);
  const scopeId = String(form.get("scopeId") || "");
  const shot = String(form.get("shot") || "");
  const step = guideSteps(requestLines(link.request, link.deal)).find((item) => item.id === scopeId);
  if (!step?.shots.some((item) => item.id === shot)) return refuse("That part of the guide is no longer on this request.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = photoProblem(file.name, file.size, bytes);
  if (problem) return refuse(problem, 400);
  const details = about.safeParse({ takenAt: form.get("takenAt") || undefined, lat: form.get("lat") || undefined, lng: form.get("lng") || undefined });

  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `loans/${safeBasename(link.deal.id)}/${id}.${ext}`;
  const name = attachmentName(file.name);
  const fileKeyId = await putBytes(key, bytes);
  await prisma.document.create({ data: { id, ownerType: "LOAN", ownerId: link.deal.id, documentType: "draw_photo", originalName: encryptField(name, documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
  const photo = { id, scopeId, shot, name, at: new Date().toISOString(), ...(details.success ? details.data : {}) };
  const saved = await runAction(linkActor(link.request), { t: "addRequestPhoto", requestId: link.request.id, photo }, { trusted: true });
  if ("error" in saved) {
    await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    return refuse(saved.error, 409);
  }
  await audit({ actorId: null, action: "document.uploaded", entityType: "Document", entityId: id, after: { dealId: link.deal.id, photoRequest: link.request.id, documentType: "draw_photo", size: bytes.length } });
  return NextResponse.json({ photo: { id, scopeId, shot, name } });
}

/** Takes back a photo sent through this link, and only this link. */
export async function DELETE(request: Request, { params }: Context) {
  const { refused, link } = await openForChanges((await params).token);
  if (!link) return refused;
  const photoId = new URL(request.url).searchParams.get("photo") ?? "";
  if (!link.request.photos.some((photo) => photo.id === photoId)) return refuse("That photo isn't on this request.", 404);
  const saved = await runAction(linkActor(link.request), { t: "removeRequestPhoto", requestId: link.request.id, photoId }, { trusted: true });
  if ("error" in saved) return refuse(saved.error, 409);
  await prisma.document.update({ where: { id: photoId }, data: { deletedAt: new Date() } });
  await audit({ actorId: null, action: "document.removed", entityType: "Document", entityId: photoId, after: { photoRequest: link.request.id } });
  return NextResponse.json({ ok: true });
}

const finish = z.object({ name: z.string().trim().min(1).max(120), note: z.string().trim().max(2000), confirmed: z.literal(true) });

/** "I'm done": tells the team. The link keeps working until its date, in case something was missed. */
export async function PATCH(request: Request, { params }: Context) {
  const { refused, link } = await openForChanges((await params).token);
  if (!link) return refused;
  // Each one can alert the team, so far fewer of these than photos.
  if (!(await consumeRateLimit(`photo-finish:${link.request.id}`, 10, 60 * 60 * 1000))) return refuse("That was sent a moment ago. Try again later.", 429);
  const parsed = finish.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("Add your name and confirm the photos.", 400);
  if (!link.request.photos.length) return refuse("Add at least one photo first.", 400);
  const action = { t: "finishPhotoRequest" as const, requestId: link.request.id, by: parsed.data.name, note: parsed.data.note };
  const saved = await runAction(linkActor(link.request), action, { trusted: true });
  if ("error" in saved) return refuse(saved.error, 409);
  await audit({ actorId: null, action: "photos.confirmed", entityType: "LoanBook", entityId: link.deal.id, after: { photoRequest: link.request.id, photos: link.request.photos.length } });
  await sendAlerts(saved.before, saved.after, saved.action);
  return NextResponse.json({ ok: true });
}
