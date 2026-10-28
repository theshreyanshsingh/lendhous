// Field-level encryption for sensitive values (Spec v3 10.2): AES-256-GCM, a key id on every value so keys can rotate,
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
  return keys.length ? keys : [{ id: "dev", secret: DEV_FIELD_KEY }];
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

/** Last four characters, stored beside the encrypted value so screens never need to decrypt (Spec v3 3.2 person.ssn). */
export function last4(value: string) {
  return value.replace(/\D/g, "").slice(-4);
}
