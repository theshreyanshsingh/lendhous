import { describe, expect, it } from "vitest";
import { nextStep } from "@/lib/approvals";
import { sessionExpired } from "@/lib/auth";
import { decryptField, DEV_FIELD_KEY, encryptField, last4, needsRotation, parseFieldKeys } from "@/lib/crypto";
import { assertMongoUrl, assertReleaseEnv, demoSeedBlocked, DEV_AUTH_SECRET, DEV_DEMO_PASSWORD, secureCookies } from "@/lib/deploy";
import { can, grantFor, homeFor, needsMfa } from "@/lib/permissions";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { newRecoveryCodes, packHashes, takeRecoveryCode } from "@/lib/recovery";
import { totpCode, verifyTotp } from "@/lib/totp";

const key = (id: string, fill: number) => `${id}:${Buffer.alloc(32, fill).toString("base64")}`;

const release = {
  DATABASE_URL: "mongodb+srv://u:p@cluster.example.net/lendhous?retryWrites=true",
  AUTH_SECRET: "x".repeat(40),
  NEXT_PUBLIC_APP_URL: "https://lendhous.example.com",
  ADMIN_EMAIL: "owner@example.com",
  ADMIN_PASSWORD: "a-long-real-password",
  CRON_SECRET: "c".repeat(24),
  FIELD_ENCRYPTION_KEYS: key("k1", 7),
  S3_BUCKET: "lendhous",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("release guard (ported from UPB, Lendhous rules added)", () => {
  it("accepts a complete production environment", () => {
    expect(() => assertReleaseEnv(release)).not.toThrow();
  });
  it("names every missing variable, including the field-encryption keys", () => {
    expect(() => assertReleaseEnv({})).toThrow(/DATABASE_URL.*AUTH_SECRET.*FIELD_ENCRYPTION_KEYS.*S3_BUCKET/);
  });
  it("refuses the sibling apps' databases and system databases", () => {
    for (const db of ["synergifund", "upb_capital", "admin", "local", "config"]) {
      expect(() => assertMongoUrl(`mongodb+srv://u:p@cluster.example.net/${db}`)).toThrow(/keeps its own/);
    }
    expect(() => assertMongoUrl("mongodb+srv://u:p@cluster.example.net/")).toThrow(/must name the database/);
    expect(() => assertMongoUrl("postgres://localhost/lendhous")).toThrow(/mongodb/);
  });
  it("refuses demo secrets, demo accounts, the dev field key and plain http", () => {
    expect(() => assertReleaseEnv({ ...release, AUTH_SECRET: DEV_AUTH_SECRET })).toThrow(/AUTH_SECRET/);
    expect(() => assertReleaseEnv({ ...release, ADMIN_EMAIL: "olivia.owner@lendhous.test" })).toThrow(/demo account/);
    expect(() => assertReleaseEnv({ ...release, ADMIN_PASSWORD: DEV_DEMO_PASSWORD })).toThrow(/demo password/);
    expect(() => assertReleaseEnv({ ...release, FIELD_ENCRYPTION_KEYS: `k1:${DEV_FIELD_KEY.toString("base64")}` })).toThrow(/development key/);
    expect(() => assertReleaseEnv({ ...release, NEXT_PUBLIC_APP_URL: "http://lendhous.example.com" })).toThrow(/https/);
    expect(() => assertReleaseEnv({ ...release, ALLOW_HTTP_SESSIONS: "1" })).toThrow(/ALLOW_HTTP_SESSIONS/);
  });
  it("blocks the demo seed on Vercel and release builds; cookies are secure in production", () => {
    expect(demoSeedBlocked({ VERCEL: "1" })).toBe(true);
    expect(demoSeedBlocked({ LENDHOUS_RELEASE: "1" })).toBe(true);
    expect(demoSeedBlocked({})).toBe(false);
    expect(secureCookies({ NODE_ENV: "production" })).toBe(true);
    expect(secureCookies({ NODE_ENV: "production", ALLOW_HTTP_SESSIONS: "1" })).toBe(false);
  });
});

describe("field encryption (Spec v3 10.2)", () => {
  const keys = parseFieldKeys(key("k1", 1));
  it("round-trips and never stores the plain value", () => {
    const stored = encryptField("123-45-6789", "person.ssn:p1", keys);
    expect(stored).not.toContain("6789");
    expect(decryptField(stored, "person.ssn:p1", keys)).toBe("123-45-6789");
  });
  it("is bound to its field and row: a copied value will not decrypt elsewhere", () => {
    const stored = encryptField("123-45-6789", "person.ssn:p1", keys);
    expect(() => decryptField(stored, "person.ssn:p2", keys)).toThrow();
    expect(() => decryptField(stored, "person.dob:p1", keys)).toThrow();
  });
  it("rotates: new writes use the first key, old values still decrypt", () => {
    const old = encryptField("secret", "ctx", parseFieldKeys(key("k1", 1)));
    const rotated = parseFieldKeys(`${key("k2", 2)},${key("k1", 1)}`);
    expect(decryptField(old, "ctx", rotated)).toBe("secret");
    expect(needsRotation(old, rotated)).toBe(true);
    expect(needsRotation(encryptField("secret", "ctx", rotated), rotated)).toBe(false);
    expect(() => decryptField(old, "ctx", parseFieldKeys(key("k2", 2)))).toThrow(/k1 is not configured/);
  });
  it("rejects malformed keys; last4 strips formatting", () => {
    expect(() => parseFieldKeys("k1:short")).toThrow(/32 bytes/);
    expect(() => parseFieldKeys(`${key("k1", 1)},${key("k1", 2)}`)).toThrow(/repeats/);
    expect(last4("123-45-6789")).toBe("6789");
    expect(encryptField("", "ctx", keys)).toBe("");
  });
});

describe("permission matrix (Spec v3 Section 1)", () => {
  it("applies the default matrix", () => {
    expect(can(["UNDERWRITER"], "view_credit")).toBe(true);
    expect(can(["PROCESSOR"], "view_credit")).toBe(false);
    expect(can(["BORROWER"], "view_pipeline")).toBe(false);
    expect(can(["ADMIN_OWNER"], "manage_roles")).toBe(true);
  });
  it("enforces dollar limits: an underwriter issues term sheets up to $1.5M", () => {
    expect(can(["UNDERWRITER"], "issue_term_sheet", { amountCents: 150_000_000 })).toBe(true);
    expect(can(["UNDERWRITER"], "issue_term_sheet", { amountCents: 150_000_001 })).toBe(false);
    expect(can(["ADMIN_OWNER"], "issue_term_sheet", { amountCents: 300_000_000 })).toBe(true);
  });
  it("database overrides switch cells on or off and change limits", () => {
    const overrides = [
      { role: "PROCESSOR" as const, permission: "view_credit", enabled: true, limitCents: null },
      { role: "UNDERWRITER" as const, permission: "issue_term_sheet", enabled: true, limitCents: 50_000_000 },
      { role: "UNDERWRITER" as const, permission: "view_credit", enabled: false, limitCents: null },
    ];
    expect(can(["PROCESSOR"], "view_credit", { overrides })).toBe(true);
    expect(can(["UNDERWRITER"], "view_credit", { overrides })).toBe(false);
    expect(can(["UNDERWRITER"], "issue_term_sheet", { amountCents: 60_000_000, overrides })).toBe(false);
  });
  it("with several roles the most generous grant wins", () => {
    expect(grantFor(["UNDERWRITER", "ADMIN_OWNER"], "issue_term_sheet")).toEqual({ enabled: true });
    expect(can(["PROCESSOR", "UNDERWRITER"], "view_credit")).toBe(true);
  });
  it("requires two-factor for staff, partners and brokers, not borrowers", () => {
    expect(needsMfa(["UNDERWRITER"])).toBe(true);
    expect(needsMfa(["PARTNER_LENDER"])).toBe(true);
    expect(needsMfa(["BROKER"])).toBe(true);
    expect(needsMfa(["BORROWER", "GUARANTOR"])).toBe(false);
    expect(homeFor(["BORROWER"])).toBe("/borrower");
    expect(homeFor(["PARTNER_LENDER"])).toBe("/partner");
    expect(homeFor(["INSPECTOR"])).toBe("/admin");
  });
});

describe("dual control rules (Spec v3 Section 1, 10.4)", () => {
  const base = { initiatorId: "u1", step1ApproverId: null, step2ApproverId: null, status: "PENDING", subjectType: "FUNDING" as const };
  const owner = (id: string) => ({ id, roles: ["ADMIN_OWNER" as const] });
  it("the initiator cannot approve, even as owner-admin", () => {
    expect(nextStep(base, owner("u1"))).toEqual({ error: "The person who started this cannot approve it." });
  });
  it("the first approver cannot also be the second", () => {
    expect(nextStep(base, owner("u2"))).toEqual({ step: 1 });
    expect(nextStep({ ...base, step1ApproverId: "u2" }, owner("u2"))).toEqual({ error: "A second, different approver is required." });
    expect(nextStep({ ...base, step1ApproverId: "u2" }, owner("u3"))).toEqual({ step: 2 });
  });
  it("needs the right permission and an open request", () => {
    expect(nextStep(base, { id: "u2", roles: ["PROCESSOR"] })).toEqual({ error: "Your role cannot approve this." });
    expect(nextStep({ ...base, status: "APPROVED" }, owner("u2"))).toEqual({ error: "This approval is already decided." });
  });
});

describe("sessions and two-factor (ported from UPB, idle timeout added)", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const session = (idleMinutes: number) => ({ expiresAt: new Date(now + 86_400_000), lastSeenAt: new Date(now - idleMinutes * 60_000) });
  it("ends staff sessions after the idle window, not borrower sessions", () => {
    expect(sessionExpired(session(31), true, 30, now)).toBe(true);
    expect(sessionExpired(session(29), true, 30, now)).toBe(false);
    expect(sessionExpired(session(600), false, 30, now)).toBe(false);
    expect(sessionExpired({ expiresAt: new Date(now - 1), lastSeenAt: new Date(now) }, false, 30, now)).toBe(true);
  });
  it("accepts the current authenticator code and one step either side", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 120_000), now)).toBe(false);
  });
  it("recovery codes work once; the memory rate limiter caps attempts", () => {
    const codes = newRecoveryCodes(2);
    const left = takeRecoveryCode(packHashes(codes), codes[0]);
    expect(left).not.toBeNull();
    expect(takeRecoveryCode(left!, codes[0])).toBeNull();
    resetRateLimits();
    expect([1, 2, 3].map(() => rateLimit("k", 2, 1000, now))).toEqual([true, true, false]);
  });
});
