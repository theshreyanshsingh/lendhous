// Encryption at rest for sensitive values and files (Spec v3 10.2): AES-256-GCM, a key id on every value so keys can rotate,
// and a context string bound in as associated data so a value copied to another field or row will not decrypt.
// MVP keys come from FIELD_ENCRYPTION_KEYS; moving to AWS KMS envelope keys is a pre-launch item (see README).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type FieldKey = { id: string; secret: Buffer };

// Local development only. The release guard refuses it.
export const DEV_FIELD_KEY = Buffer.from("bGVuZGhvdXMtZGV2LWZpZWxkLWtleS0wMDAwMDAwMDA=", "base64");

/** "k2:<base64 32 bytes>,k1:<base64 32 bytes>". The first key encrypts; every key decrypts. */
export function parseFieldKeys(raw: string): FieldKey[] {
  const keys = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(":");
      if (at < 1) throw new Error("FIELD_ENCRYPTION_KEYS entries look like id:base64key.");
      const id = part.slice(0, at);
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error(`Key id "${id}" must be 1-16 letters, digits, - or _.`);
      const secret = Buffer.from(part.slice(at + 1), "base64");
      if (secret.length !== 32) throw new Error(`Key ${id} must be 32 bytes, base64 encoded (openssl rand -base64 32).`);
      return { id, secret };
    });
  if (new Set(keys.map((key) => key.id)).size !== keys.length) throw new Error("FIELD_ENCRYPTION_KEYS repeats a key id.");
  return keys;
}

export function fieldKeys(env: Record<string, string | undefined> = process.env): FieldKey[] {
  const keys = parseFieldKeys(env.FIELD_ENCRYPTION_KEYS || "");
  if (keys.length) return keys;
  // The development key is public, so a live site must stop rather than quietly protect real records with it.
  if (env.NODE_ENV === "production" && (env.NEXT_PUBLIC_APP_URL || "").startsWith("https://")) throw new Error("FIELD_ENCRYPTION_KEYS is required on a live site.");
  return [{ id: "dev", secret: DEV_FIELD_KEY }];
}

export function encryptionMode(env: Record<string, string | undefined> = process.env) {
  return parseFieldKeys(env.FIELD_ENCRYPTION_KEYS || "").length ? "keys" : "dev-key";
}

const PREFIX = "enc1";

export function encryptField(plain: string, context: string, keys = fieldKeys()) {
  if (plain === "") return "";
  const key = keys[0];
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.secret, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, key.id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":");
}

export function decryptField(stored: string, context: string, keys = fieldKeys()) {
  if (stored === "") return "";
  const [prefix, keyId, iv, tag, body] = stored.split(":");
  if (prefix !== PREFIX || !body) throw new Error("Not an encrypted field value.");
  const key = keys.find((item) => item.id === keyId);
  if (!key) throw new Error(`Encryption key ${keyId} is not configured.`);
  const decipher = createDecipheriv("aes-256-gcm", key.secret, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** True when a value was written with a key other than the current one, so a rotation job can rewrite it. */
export function needsRotation(stored: string, keys = fieldKeys()) {
  return stored !== "" && stored.split(":")[1] !== keys[0].id;
}

export const isEncrypted = (stored: string) => stored.startsWith(`${PREFIX}:`);

/** Reads a value that may have been saved before encryption was switched on. */
export function readField(stored: string, context: string, keys = fieldKeys()) {
  return isEncrypted(stored) ? decryptField(stored, context, keys) : stored;
}

/** A whole JSON record as one encrypted value, for records that are only ever read in full. */
export const sealJson = (value: unknown, context: string, keys = fieldKeys()) => ({ enc: encryptField(JSON.stringify(value), context, keys) });

const sealedValue = (stored: unknown) => {
  const enc = (stored as { enc?: unknown } | null)?.enc;
  return typeof enc === "string" && isEncrypted(enc) ? enc : null;
};

export const fieldNeedsSealing = (stored: string, keys = fieldKeys()) => stored !== "" && (!isEncrypted(stored) || needsRotation(stored, keys));

/** True for a record saved before encryption, or under an older key. */
export const jsonNeedsSealing = (stored: unknown, keys = fieldKeys()) => {
  const enc = sealedValue(stored);
  return !enc || needsRotation(enc, keys);
};

export function openJson(stored: unknown, context: string, keys = fieldKeys()): unknown {
  const enc = sealedValue(stored);
  return enc ? JSON.parse(decryptField(enc, context, keys)) : stored;
}

// Files carry their own header, so a file stored before encryption still opens and nothing else needs to say which is which.
const FILE_MAGIC = Buffer.from("LHENC1\n", "utf8");

export const isEncryptedFile = (stored: Buffer) => stored.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);

/** magic, key id length, key id, iv, auth tag, then the encrypted bytes. */
export function encryptBytes(plain: Buffer, context: string, keys = fieldKeys()) {
  const key = keys[0];
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.secret, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const keyId = Buffer.from(key.id, "utf8");
  return Buffer.concat([FILE_MAGIC, Buffer.from([keyId.length]), keyId, iv, cipher.getAuthTag(), body]);
}

const fileKeyId = (stored: Buffer) => {
  const length = stored[FILE_MAGIC.length];
  return stored.subarray(FILE_MAGIC.length + 1, FILE_MAGIC.length + 1 + length).toString("utf8");
};

export function decryptBytes(stored: Buffer, context: string, keys = fieldKeys()) {
  if (!isEncryptedFile(stored)) return stored;
  const keyId = fileKeyId(stored);
  const key = keys.find((item) => item.id === keyId);
  if (!key) throw new Error(`Encryption key ${keyId} is not configured.`);
  const start = FILE_MAGIC.length + 1 + Buffer.byteLength(keyId, "utf8");
  const decipher = createDecipheriv("aes-256-gcm", key.secret, stored.subarray(start, start + 12));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(stored.subarray(start + 12, start + 28));
  return Buffer.concat([decipher.update(stored.subarray(start + 28)), decipher.final()]);
}

export const fileNeedsSealing = (stored: Buffer, keys = fieldKeys()) => !isEncryptedFile(stored) || fileKeyId(stored) !== keys[0].id;

/** Last four characters, stored beside the encrypted value so screens never need to decrypt (Spec v3 3.2 person.ssn). */
export function last4(value: string) {
  return value.replace(/\D/g, "").slice(-4);
}
