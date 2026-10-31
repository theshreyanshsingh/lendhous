import fs from "fs/promises";
import path from "path";

export function storageRoot() {
  return path.join(process.cwd(), "storage");
}

export function uploadDir() {
  return path.join(storageRoot(), "uploads");
}

export function tmpDirFor(userId: string) {
  return path.join(storageRoot(), "tmp", userId);
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function safeBasename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
}

const ALLOWED = new Set(["pdf", "png", "jpg", "jpeg", "webp", "heic", "csv", "xls", "xlsx", "doc", "docx", "txt"]);

export function extensionOf(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED.has(ext) ? ext : null;
}

export function mimeFor(ext: string, fallback: string) {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    heic: "image/heic",
    csv: "text/csv",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
  };
  return map[ext] ?? fallback ?? "application/octet-stream";
}

export function storageMode(env: Record<string, string | undefined> = process.env): "s3" | "blob" | "local" {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) return "s3";
  if (env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID) return "blob";
  return "local";
}

function assertRemoteOnVercel() {
  if (process.env.VERCEL === "1" && storageMode() === "local") {
    throw new Error("Vercel has no durable disk. Set S3_* for R2, or connect a private Vercel Blob store.");
  }
}

export function assertStorageKey(key: string) {
  if (!key || key.length > 240 || key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Bad storage key");
  }
}

function localPath(key: string) {
  assertStorageKey(key);
  const root = path.resolve(uploadDir());
  const full = path.resolve(root, key);
  if (!full.startsWith(`${root}${path.sep}`) && full !== root) throw new Error("Bad storage key");
  return full;
}

// A bucket shared with another app keeps Lendhous files under one folder, e.g. S3_PREFIX="lendhous".
export function s3Key(key: string, env: Record<string, string | undefined> = process.env) {
  const prefix = (env.S3_PREFIX || "").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${key}` : key;
}

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
}

export async function putBytes(key: string, bytes: Buffer, mime = "application/octet-stream") {
  assertStorageKey(key);
  assertRemoteOnVercel();
  if (storageMode() === "blob") {
    const { put } = await import("@vercel/blob");
    await put(key, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: mime });
    return;
  }
  if (storageMode() === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: s3Key(key),
        Body: bytes,
        ContentType: mime,
      }),
    );
    return;
  }
  const full = localPath(key);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, bytes);
}

/**
 * A short-lived private link to a stored file (Spec v3 10.2, placeholder five minutes). Only S3/R2 can sign links;
 * Vercel Blob and local disk return null, and the caller streams the file through an authenticated route instead.
 */
export async function signedDownloadUrl(key: string, filename: string, ttlSeconds = 300) {
  assertStorageKey(key);
  if (storageMode() !== "s3") return null;
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = await s3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: s3Key(key),
    ResponseContentDisposition: `attachment; filename="${filename.replace(/["\r\n]/g, "")}"`,
  });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

export async function getBytes(key: string) {
  assertStorageKey(key);
  assertRemoteOnVercel();
  if (storageMode() === "blob") {
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: "private" });
    if (!result?.stream) throw new Error("Missing blob");
    const chunks: Uint8Array[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  }
  if (storageMode() === "s3") {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client();
      const result = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s3Key(key) }));
      const body = result.Body;
      if (!body) throw new Error("Empty object");
      return Buffer.from(await body.transformToByteArray());
    } catch {
      // Fall through to disk so files written before S3 was configured still open.
    }
  }
  return fs.readFile(localPath(key));
}
