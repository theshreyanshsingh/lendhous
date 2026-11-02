import { describe, expect, it } from "vitest";
import { nextStep } from "@/lib/approvals";
import { sessionExpired } from "@/lib/auth";
import { decryptBytes, decryptField, DEV_FIELD_KEY, encryptBytes, encryptField, fieldKeys, fieldNeedsSealing, fileNeedsSealing, isEncrypted, isEncryptedFile, jsonNeedsSealing, last4, needsRotation, openJson, parseFieldKeys, readField, sealJson } from "@/lib/crypto";
import { assertMongoUrl, assertReleaseEnv, demoSeedBlocked, DEV_AUTH_SECRET, DEV_DEMO_PASSWORD, isDemoEmail, secureCookies } from "@/lib/deploy";
import { accessChanges, accessError, accessFor, mixesWorkspaces, pickRole, removeError } from "@/lib/member-rules";
import { can, grantFor, homeFor, viewFor } from "@/lib/permissions";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

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
  RESEND_API_KEY: "re_key",
  EMAIL_FROM: "LendHous <noreply@example.com>",
};

describe("release guard (ported from UPB, Lendhous rules added)", () => {
  it("accepts a complete production environment", () => {
    expect(() => assertReleaseEnv(release)).not.toThrow();
  });
  it("refuses a build with no way to mail password links", () => {
    expect(() => assertReleaseEnv({ ...release, RESEND_API_KEY: "" })).toThrow(/RESEND_API_KEY/);
    expect(() => assertReleaseEnv({ ...release, EMAIL_FROM: "" })).toThrow(/EMAIL_FROM/);
    expect(() => assertReleaseEnv({ ...release, RESEND_API_KEY: "", SMTP_HOST: "smtp.example.com" })).not.toThrow();
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

describe("records and files at rest", () => {
  const keys = parseFieldKeys(key("k1", 1));
  const rotated = parseFieldKeys(`${key("k2", 2)},${key("k1", 1)}`);
  it("a whole record round-trips, with nothing readable while stored", () => {
    const record = { borrowerName: "Bonnie Borrower", app: { fico: 720 }, photos: [] };
    const sealed = sealJson(record, "BookRecord:deals:d1", keys);
    expect(JSON.stringify(sealed)).not.toContain("Bonnie");
    expect(JSON.stringify(sealed)).not.toContain("720");
    expect(openJson(sealed, "BookRecord:deals:d1", keys)).toEqual(record);
  });
  it("a record copied over another row won't open", () => {
    expect(() => openJson(sealJson({ a: 1 }, "BookRecord:deals:d1", keys), "BookRecord:deals:d2", keys)).toThrow();
  });
  it("a record saved before encryption still reads, and is marked to be sealed", () => {
    const old = { borrowerName: "Bonnie" };
    expect(openJson(old, "BookRecord:deals:d1", keys)).toEqual(old);
    expect(jsonNeedsSealing(old, keys)).toBe(true);
    expect(jsonNeedsSealing(sealJson(old, "c", keys), keys)).toBe(false);
    expect(jsonNeedsSealing(sealJson(old, "c", keys), rotated)).toBe(true);
    // A record that happens to have a field called enc is still just a record.
    expect(openJson({ enc: "not sealed" }, "c", keys)).toEqual({ enc: "not sealed" });
  });
  it("a field saved before encryption still reads", () => {
    expect(readField("dana@example.com", "Lead.email:1", keys)).toBe("dana@example.com");
    const sealed = encryptField("dana@example.com", "Lead.email:1", keys);
    expect(isEncrypted(sealed)).toBe(true);
    expect(readField(sealed, "Lead.email:1", keys)).toBe("dana@example.com");
    expect(() => readField(sealed, "Lead.email:2", keys)).toThrow();
    expect(fieldNeedsSealing("dana@example.com", keys)).toBe(true);
    expect(fieldNeedsSealing(sealed, keys)).toBe(false);
    expect(fieldNeedsSealing(sealed, rotated)).toBe(true);
    expect(fieldNeedsSealing("", keys)).toBe(false);
  });
  it("a file round-trips, and its bytes aren't readable while stored", () => {
    const plain = Buffer.from("%PDF-1.4 Bonnie Borrower bank statement");
    const stored = encryptBytes(plain, "file:loans/d1/a.pdf", keys);
    expect(isEncryptedFile(stored)).toBe(true);
    expect(stored.includes(Buffer.from("Bonnie"))).toBe(false);
    expect(stored.includes(Buffer.from("%PDF"))).toBe(false);
    expect(decryptBytes(stored, "file:loans/d1/a.pdf", keys).equals(plain)).toBe(true);
  });
  it("a tampered or moved file won't open", () => {
    const stored = encryptBytes(Buffer.from("real"), "file:a", keys);
    expect(() => decryptBytes(stored, "file:b", keys)).toThrow();
    const changed = Buffer.from(stored);
    changed[changed.length - 1] ^= 1;
    expect(() => decryptBytes(changed, "file:a", keys)).toThrow();
  });
  it("a file stored before encryption still opens, and rotation is noticed", () => {
    const plain = Buffer.from("%PDF-1.4 old");
    expect(decryptBytes(plain, "file:a", keys).equals(plain)).toBe(true);
    expect(fileNeedsSealing(plain, keys)).toBe(true);
    const stored = encryptBytes(plain, "file:a", keys);
    expect(fileNeedsSealing(stored, keys)).toBe(false);
    expect(fileNeedsSealing(stored, rotated)).toBe(true);
    expect(decryptBytes(stored, "file:a", rotated).equals(plain)).toBe(true);
    expect(() => decryptBytes(encryptBytes(plain, "file:a", rotated), "file:a", keys)).toThrow(/k2 is not configured/);
  });
  it("a live site refuses to run on the public development key", () => {
    expect(() => fieldKeys({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://portal.lendhous.com" })).toThrow(/required on a live site/);
    expect(fieldKeys({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" })[0].id).toBe("dev");
    expect(fieldKeys({ NODE_ENV: "development" })[0].id).toBe("dev");
    expect(fieldKeys({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://portal.lendhous.com", FIELD_ENCRYPTION_KEYS: key("k1", 1) })[0].id).toBe("k1");
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
  it("sends each role to its own home", () => {
    expect(homeFor(["BORROWER"])).toBe("/admin/borrower");
    expect(homeFor(["PARTNER_LENDER"])).toBe("/admin/partner");
    expect(homeFor(["INSPECTOR"])).toBe("/admin");
  });
  it("opens one workspace per account: staff before partner before borrower, none for brokers yet", () => {
    expect(viewFor(["BORROWER", "UNDERWRITER"])).toBe("admin");
    expect(viewFor(["BORROWER", "PARTNER_LENDER"])).toBe("partner");
    expect(viewFor(["BORROWER"])).toBe("borrower");
    expect(viewFor(["BROKER"])).toBe("broker");
    expect(homeFor(["BROKER"])).toBe("/admin/broker");
    expect(viewFor(["AUDITOR"])).toBe("admin");
    expect(viewFor(["CLOSING_AGENT"])).toBeNull();
    expect(homeFor(["CLOSING_AGENT"])).toBe("/admin/account/security");
  });
  it("only the reserved demo domain counts as a demo account", () => {
    expect(isDemoEmail("Alex.Sample@LendHous.test")).toBe(true);
    expect(isDemoEmail("alex@lendhous.com")).toBe(false);
    expect(isDemoEmail("alex@notlendhous.test")).toBe(false);
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

describe("loan buyers and per-person access", () => {
  it("gives a loan buyer their own workspace", () => {
    expect(viewFor(["LOAN_BUYER"])).toBe("buyer");
    expect(homeFor(["LOAN_BUYER"])).toBe("/admin/buyer");
    expect(viewFor(["UNDERWRITER", "LOAN_BUYER"])).toBe("admin");
  });
  it("applies one person's changes on top of their role", () => {
    expect(can(["PROCESSOR"], "view_audit", { member: { extraPermissions: ["view_audit"] } })).toBe(true);
    expect(can(["PROCESSOR"], "view_pipeline", { member: { deniedPermissions: ["view_pipeline"] } })).toBe(false);
    expect(can(["UNDERWRITER"], "issue_term_sheet", { amountCents: 200_000_000, member: { extraPermissions: ["issue_term_sheet"] } })).toBe(false);
  });
  it("stores only the differences from the role, and nothing for an owner", () => {
    const ticked = [...accessFor(["PROCESSOR"]).filter((permission) => permission !== "manage_conditions"), "view_audit"];
    expect(accessChanges(["PROCESSOR"], ticked)).toEqual({ extraPermissions: ["view_audit"], deniedPermissions: ["manage_conditions"] });
    expect(accessChanges(["PROCESSOR"], accessFor(["PROCESSOR"]))).toEqual({ extraPermissions: [], deniedPermissions: [] });
    expect(accessChanges(["ADMIN_OWNER"], [])).toEqual({ extraPermissions: [], deniedPermissions: [] });
  });
  it("won't let anyone raise their own access or give access they don't have", () => {
    const owner = { id: "o", roleCodes: ["ADMIN_OWNER" as const] };
    const manager = { id: "m", roleCodes: ["PROCESSOR" as const], extraPermissions: ["manage_users"] };
    expect(accessError(owner, null, { roles: [] })).toMatch(/at least one role/);
    // An account opens one workspace, team first, so a processor who is also a borrower never sees the borrower side.
    expect(accessError(owner, null, { roles: ["BORROWER", "PROCESSOR"] })).toMatch(/second email/);
    expect(accessError(owner, null, { roles: ["BROKER", "BORROWER"] })).toMatch(/second email/);
    expect(accessError(owner, null, { roles: ["BORROWER", "GUARANTOR"] })).toBeNull();
    expect(accessError(owner, null, { roles: ["UNDERWRITER", "SERVICER"] })).toBeNull();
    expect(accessError(owner, { id: "mixed", roles: ["BORROWER", "PROCESSOR"] }, { roles: ["BORROWER", "PROCESSOR"] })).toBeNull();
    expect(accessError(owner, { id: "mixed", roles: ["BORROWER", "PROCESSOR"] }, { roles: ["BORROWER"] })).toBeNull();
    expect(mixesWorkspaces(["BORROWER", "PROCESSOR"])).toBe(true);
    expect(mixesWorkspaces(["ADMIN_OWNER", "UNDERWRITER"])).toBe(false);
    expect(accessError(owner, null, { roles: ["ADMIN_OWNER"] })).toBeNull();
    expect(accessError(owner, { id: "o", roles: ["ADMIN_OWNER"] }, { roles: ["UNDERWRITER"] })).toMatch(/your own access/);
    expect(accessError(owner, { id: "o", roles: ["ADMIN_OWNER"] }, { roles: ["ADMIN_OWNER"] })).toBeNull();
    expect(accessError(manager, null, { roles: ["ADMIN_OWNER"] })).toMatch(/Only an owner/);
    expect(accessError(manager, { id: "x", roles: ["ADMIN_OWNER"] }, { roles: ["PROCESSOR"] })).toMatch(/Only an owner/);
    expect(accessError(manager, null, { roles: ["UNDERWRITER"] })).toMatch(/don't have yourself/);
    expect(accessError(manager, null, { roles: ["PROCESSOR"], extraPermissions: ["approve_funding"] })).toMatch(/don't have yourself/);
    expect(accessError(manager, null, { roles: ["PROCESSOR"] })).toBeNull();
    expect(accessError(manager, { id: "m", roles: ["PROCESSOR"], extraPermissions: ["manage_users"] }, { roles: ["PROCESSOR"], extraPermissions: ["manage_users", "view_audit"] })).toMatch(/your own access/);
  });
  it("won't let anyone remove themselves, or a non-owner remove an owner", () => {
    const owner = { id: "o", roleCodes: ["ADMIN_OWNER" as const] };
    const manager = { id: "m", roleCodes: ["PROCESSOR" as const] };
    expect(removeError(owner, { id: "o", roles: ["ADMIN_OWNER"] })).toMatch(/your own/);
    expect(removeError(manager, { id: "o", roles: ["ADMIN_OWNER"] })).toMatch(/Only an owner/);
    expect(removeError(owner, { id: "x", roles: ["ADMIN_OWNER"] })).toBeNull();
    expect(removeError(manager, { id: "x", roles: ["BROKER"] })).toBeNull();
  });
});

describe("sessions and rate limits (ported from UPB, idle timeout added)", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const session = (idleMinutes: number) => ({ expiresAt: new Date(now + 86_400_000), lastSeenAt: new Date(now - idleMinutes * 60_000) });
  it("ends staff sessions after the idle window, not borrower sessions", () => {
    expect(sessionExpired(session(31), true, 30, now)).toBe(true);
    expect(sessionExpired(session(29), true, 30, now)).toBe(false);
    expect(sessionExpired(session(600), false, 30, now)).toBe(false);
    expect(sessionExpired({ expiresAt: new Date(now - 1), lastSeenAt: new Date(now) }, false, 30, now)).toBe(true);
  });
  it("the memory rate limiter caps attempts", () => {
    resetRateLimits();
    expect([1, 2, 3].map(() => rateLimit("k", 2, 1000, now))).toEqual([true, true, false]);
  });
});

describe("the members page's role picker", () => {
  it("picking a borrower over the default processor leaves just the borrower", () => {
    expect(pickRole(["PROCESSOR"], "BORROWER")).toEqual(["BORROWER"]);
  });
  it("team roles add up, and picking one again takes it off", () => {
    expect(pickRole(["PROCESSOR"], "SERVICER")).toEqual(["PROCESSOR", "SERVICER"]);
    expect(pickRole(["PROCESSOR", "SERVICER"], "PROCESSOR")).toEqual(["SERVICER"]);
  });
  it("a team role replaces an outside one, and outside roles replace each other", () => {
    expect(pickRole(["BORROWER"], "UNDERWRITER")).toEqual(["UNDERWRITER"]);
    expect(pickRole(["BROKER"], "LOAN_BUYER")).toEqual(["LOAN_BUYER"]);
    expect(pickRole(["BORROWER"], "GUARANTOR")).toEqual(["BORROWER", "GUARANTOR"]);
    expect(pickRole([], "BORROWER")).toEqual(["BORROWER"]);
  });
});
