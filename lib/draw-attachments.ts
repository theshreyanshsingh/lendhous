// Receipts and a short video with a draw (docs/competitor-gaps-2026-11-09.md, rank 30). A phone video walking through the
// work, and the receipts for materials, give the team more to judge a photo review by than still photos. Videos keep to
// the same 15 MB as any upload, which is about 15 seconds from a phone: up to three clips. Pure.
import type { DrawAttachment } from "./mockData";

export const ATTACHMENT_RULES = { maxVideos: 3, maxReceipts: 20, maxBytes: 15 * 1024 * 1024 };
export const VIDEO_TYPES = new Set(["mp4", "mov", "webm"]);
export const RECEIPT_TYPES = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"]);

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** Why these files can't go with the draw, or null. */
export function attachmentProblem(files: { name: string; size: number; kind: DrawAttachment["kind"] }[]) {
  const videos = files.filter((file) => file.kind === "video");
  const receipts = files.filter((file) => file.kind === "receipt");
  if (videos.length > ATTACHMENT_RULES.maxVideos) return `Send up to ${ATTACHMENT_RULES.maxVideos} short videos.`;
  if (receipts.length > ATTACHMENT_RULES.maxReceipts) return `Send up to ${ATTACHMENT_RULES.maxReceipts} receipts.`;
  if (videos.some((file) => !VIDEO_TYPES.has(extension(file.name)))) return "Videos go as MP4, MOV or WebM.";
  if (receipts.some((file) => !RECEIPT_TYPES.has(extension(file.name)))) return "Receipts go as photos or PDFs.";
  const big = files.find((file) => file.size > ATTACHMENT_RULES.maxBytes);
  if (big) return big.kind === "video" ? `${big.name} is over 15 MB: record about 15 seconds at a time, or in 720p.` : `${big.name} is over 15 MB.`;
  return null;
}

/** A line on the team's draw card. */
export function attachmentSummary(attachments: DrawAttachment[] = []) {
  const videos = attachments.filter((item) => item.kind === "video").length;
  const receipts = attachments.filter((item) => item.kind === "receipt").length;
  const parts = [videos ? `${videos} video${videos === 1 ? "" : "s"}` : "", receipts ? `${receipts} receipt${receipts === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? `With the request: ${parts.join(" and ")}.` : null;
}
