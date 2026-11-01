import { extensionOf, safeBasename } from "@/lib/storage";

const PDF = (bytes: Buffer) => bytes.subarray(0, 5).toString("utf8").startsWith("%PDF");
const PNG = (bytes: Buffer) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
const JPEG = (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const WEBP = (bytes: Buffer) => bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
const HEIC = (bytes: Buffer) => bytes.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(bytes.subarray(8, 12).toString("latin1"));

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  pdf: PDF,
  png: PNG,
  jpg: JPEG,
  jpeg: JPEG,
  webp: WEBP,
  heic: HEIC,
  heif: HEIC,
};

export const documentNameContext = (id: string) => `Document.originalName:${id}`;

export function attachmentName(name: string) {
  return safeBasename(name).replace(/["\r\n]/g, "");
}

export function uploadProblem(name: string, size: number, bytes: Buffer, maxBytes = 15 * 1024 * 1024) {
  if (size <= 0 || bytes.length === 0) return "Choose a file.";
  if (size > maxBytes || bytes.length > maxBytes) return "That file is over the size limit.";
  const ext = extensionOf(name);
  if (!ext) return "That file type is not accepted.";
  const check = MAGIC[ext];
  if (check && !check(bytes)) return "The file contents do not match its type.";
  return null;
}

const PHOTO_TYPES = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);

/** The stricter check for the photo link, which is open to anyone holding it: pictures only. */
export function photoProblem(name: string, size: number, bytes: Buffer) {
  if (!PHOTO_TYPES.has(extensionOf(name) ?? "")) return "Only photos can be sent here.";
  return uploadProblem(name, size, bytes);
}

// Browsers can show these safely. Anything else, HEIC included, downloads instead.
const SHOWN_INLINE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Headers for sending a stored file back. Inline only ever applies to plain pictures. */
export function fileHeaders(mime: string, name: string, inline = false): Record<string, string> {
  const shown = inline && SHOWN_INLINE.has(mime);
  return {
    "Content-Type": mime,
    "Content-Disposition": `${shown ? "inline" : "attachment"}; filename="${name}"`,
    "Cache-Control": shown ? "private, max-age=300" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
