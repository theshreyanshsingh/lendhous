// Release guard, ported from UPB Capital's lib/deploy.ts. A production build refuses to start on demo values,
// a missing variable, or a database that belongs to another of GT's apps.
import { parseFieldKeys, DEV_FIELD_KEY } from "./crypto";

export const DEMO_DOMAIN = "lendhous.test";
export const DEV_AUTH_SECRET = "dev-only-lendhous-secret-change-me-2026";
export const DEV_DEMO_PASSWORD = "Lendhous2026!";

export const DEMO_LOGINS = [
  { role: "Admin (owner)", email: `olivia.owner@${DEMO_DOMAIN}` },
  { role: "Underwriter", email: `uma.underwriter@${DEMO_DOMAIN}` },
  { role: "Processor", email: `pat.processor@${DEMO_DOMAIN}` },
  { role: "Capital manager", email: `cam.capital@${DEMO_DOMAIN}` },
  { role: "Borrower", email: `alex.sample@${DEMO_DOMAIN}` },
  { role: "Partner lender", email: `pia.partner@${DEMO_DOMAIN}` },
  { role: "Broker", email: `bea.broker@${DEMO_DOMAIN}` },
  { role: "Draw inspector", email: `ivan.inspector@${DEMO_DOMAIN}` },
];
export const DEMO_EMAILS = DEMO_LOGINS.map((login) => login.email);

export const isDemoEmail = (email: string) => email.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`);

export function demoSeedBlocked(env: Record<string, string | undefined>) {
  return env.VERCEL === "1" || env.NODE_ENV === "production" || env.LENDHOUS_RELEASE === "1";
}

export function assertDemoSeedAllowed(env: Record<string, string | undefined> = process.env) {
  if (!demoSeedBlocked(env)) return;
  throw new Error(
    "Demo seed is refused when VERCEL, LENDHOUS_RELEASE, or NODE_ENV=production is set. Production creates one admin with npm run db:bootstrap.",
  );
}

export function isReleaseBuild(env: Record<string, string | undefined>) {
  return env.VERCEL === "1" || env.LENDHOUS_RELEASE === "1";
}

// Production cookies are https-only. An internal server reached over plain http opts out with ALLOW_HTTP_SESSIONS=1;
// release builds refuse that setting.
export function secureCookies(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production" && env.ALLOW_HTTP_SESSIONS !== "1";
}

export function showDemoDesk(env: Record<string, string | undefined>, demoAccounts: number) {
  return !isReleaseBuild(env) && demoAccounts > 0;
}

// The Atlas cluster is shared with SynergyFund and UPB Capital; Lendhous must never write into their databases.
const RESERVED_DATABASES = new Set(["admin", "local", "config", "synergifund", "upb_capital"]);

export function assertMongoUrl(url: string | undefined) {
  if (!url) throw new Error("DATABASE_URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "mongodb+srv:" && parsed.protocol !== "mongodb:") {
    throw new Error("DATABASE_URL must be a mongodb+srv:// or mongodb:// URL.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must name the database, for example /lendhous.");
  if (RESERVED_DATABASES.has(database.toLowerCase())) {
    throw new Error(`DATABASE_URL points at the ${database} database. Lendhous keeps its own, for example /lendhous.`);
  }
}

export function remoteStorageConfigured(env: Record<string, string | undefined>) {
  const s3 = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
  const blob = Boolean(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID);
  return s3 || blob;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertReleaseEnv(env: Record<string, string | undefined>) {
  const missing: string[] = [];
  for (const key of ["DATABASE_URL", "AUTH_SECRET", "NEXT_PUBLIC_APP_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD", "CRON_SECRET", "FIELD_ENCRYPTION_KEYS"]) {
    if (!env[key]) missing.push(key);
  }
  if (!remoteStorageConfigured(env)) missing.push("S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY, or BLOB_READ_WRITE_TOKEN");
  if (missing.length) throw new Error(`Production build is missing ${missing.join(", ")}.`);
  assertMongoUrl(env.DATABASE_URL);
  if ((env.AUTH_SECRET || "").length < 32 || env.AUTH_SECRET === DEV_AUTH_SECRET) {
    throw new Error("AUTH_SECRET must be a new random string of at least 32 characters.");
  }
  if ((env.CRON_SECRET || "").length < 16) throw new Error("CRON_SECRET must be at least 16 characters.");
  const keys = parseFieldKeys(env.FIELD_ENCRYPTION_KEYS || "");
  if (keys.some((key) => key.secret.equals(DEV_FIELD_KEY))) throw new Error("FIELD_ENCRYPTION_KEYS still holds the development key.");
  const email = (env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("ADMIN_EMAIL is not an email address.");
  if (isDemoEmail(email)) throw new Error("ADMIN_EMAIL cannot be a demo account.");
  const team = (env.TEAM_EMAIL || "").trim().toLowerCase();
  if (team && !EMAIL.test(team)) throw new Error("TEAM_EMAIL is not an email address.");
  if (isDemoEmail(team)) throw new Error("TEAM_EMAIL cannot be a demo account.");
  if ((env.ADMIN_PASSWORD || "").length < 12 || env.ADMIN_PASSWORD === DEV_DEMO_PASSWORD) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters and cannot be the demo password.");
  }
  if (!/^https:\/\//.test(env.NEXT_PUBLIC_APP_URL || "")) throw new Error("NEXT_PUBLIC_APP_URL must be an https URL.");
  if (env.ALLOW_HTTP_SESSIONS === "1") throw new Error("ALLOW_HTTP_SESSIONS is for an internal http server. A release build serves https.");
}
