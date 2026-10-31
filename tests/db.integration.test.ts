// Runs against a real MongoDB replica set (mongodb-memory-server, version 7.0 like Atlas and docker-compose.yml).
// Proves the database-side mitigations work, not only the application checks.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { PrismaClient } from "@prisma/client";

let replSet: MongoMemoryReplSet;
let prisma: PrismaClient;
let lib: {
  approvals: typeof import("@/lib/approvals");
  jobs: typeof import("@/lib/jobs");
  indexes: typeof import("@/lib/mongo-indexes");
  validators: typeof import("@/lib/mongo-validators");
  access: typeof import("@/lib/member-rules").accessFor;
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ binary: { version: "7.0.24" }, replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.DATABASE_URL = replSet.getUri("lendhous_test");
  process.env.RATE_LIMIT_STORE = "memory";
  ({ prisma } = await import("@/lib/prisma"));
  lib = {
    approvals: await import("@/lib/approvals"),
    jobs: await import("@/lib/jobs"),
    indexes: await import("@/lib/mongo-indexes"),
    validators: await import("@/lib/mongo-validators"),
    access: (await import("@/lib/member-rules")).accessFor,
  };
  await lib.validators.syncValidators(prisma);
  await lib.indexes.syncIndexes(prisma);
});

afterAll(async () => {
  await prisma?.$disconnect();
  await replSet?.stop();
});

describe("Approval collection validator (MongoDB stands in for a CHECK constraint)", () => {
  it("rejects an approver who is also the initiator, written straight to the database", async () => {
    await expect(prisma.approval.create({ data: { subjectType: "FUNDING", subjectId: "loan-1", initiatorId: "u1", step1ApproverId: "u1" } })).rejects.toThrow(/validation/i);
  });
  it("rejects the same person on both steps, and a second step without a first", async () => {
    await expect(prisma.approval.create({ data: { subjectType: "FUNDING", subjectId: "loan-1", initiatorId: "u1", step1ApproverId: "u2", step2ApproverId: "u2" } })).rejects.toThrow(/validation/i);
    await expect(prisma.approval.create({ data: { subjectType: "FUNDING", subjectId: "loan-1", initiatorId: "u1", step2ApproverId: "u3" } })).rejects.toThrow(/validation/i);
  });
  it("rejects an update that would break the rule on an existing request", async () => {
    const row = await prisma.approval.create({ data: { subjectType: "DRAW", subjectId: "draw-1", initiatorId: "u1", step1ApproverId: "u2" } });
    await expect(prisma.approval.update({ where: { id: row.id }, data: { step2ApproverId: "u2" } })).rejects.toThrow(/validation/i);
    await expect(prisma.approval.update({ where: { id: row.id }, data: { step2ApproverId: "u3", status: "APPROVED" } })).resolves.toMatchObject({ status: "APPROVED" });
  });
  it("runs the full two-step flow through the app, with an audit row for each step", async () => {
    const { requestApproval, decideApproval, ApprovalError } = lib.approvals;
    const owner = (id: string) => ({ id, roles: ["ADMIN_OWNER" as const] });
    const request = await requestApproval({ subjectType: "FUNDING", subjectId: "loan-2", initiatorId: "proc", amountCents: 34_000_000 });
    await expect(decideApproval(request.id, owner("proc"), "APPROVED")).rejects.toBeInstanceOf(ApprovalError);
    expect((await decideApproval(request.id, owner("a1"), "APPROVED")).status).toBe("PENDING");
    await expect(decideApproval(request.id, owner("a1"), "APPROVED")).rejects.toThrow(/different approver/);
    expect((await decideApproval(request.id, owner("a2"), "APPROVED")).status).toBe("APPROVED");
    const trail = await prisma.auditEvent.findMany({ where: { entityId: request.id }, orderBy: { createdAt: "asc" } });
    expect(trail.map((row) => row.action)).toEqual(["approval.requested", "approval.step1.approved", "approval.step2.approved"]);
  });
});

describe("soft delete and team alerts", () => {
  it("counts a user whose deletedAt was never written, and skips a deleted one", async () => {
    const { notDeleted } = await import("@/lib/prisma");
    const base = { name: "Owner", passwordHash: "x", accountStatus: "APPROVED" as const, roles: { create: [{ role: "ADMIN_OWNER" as const }] } };
    await prisma.user.create({ data: { ...base, email: "owner.live@lendhous.com" } });
    await prisma.user.create({ data: { ...base, email: "owner.gone@lendhous.com", deletedAt: new Date() } });
    const found = await prisma.user.findMany({ where: { email: { startsWith: "owner." }, ...notDeleted }, select: { email: true } });
    expect(found.map((user) => user.email)).toEqual(["owner.live@lendhous.com"]);
  });
  it("notifyTeam reaches an approved owner-admin", async () => {
    const { notifyTeam } = await import("@/lib/email");
    await notifyTeam("New project brief", "Details", "lead.new");
    const notices = await prisma.notification.findMany({ where: { eventCode: "lead.new" }, select: { toEmail: true } });
    expect(notices.map((notice) => notice.toEmail)).toEqual(["owner.live@lendhous.com"]);
  });
});

describe("emailed sign-in codes", () => {
  type Sent = { url: string; to: string[]; from: string; text: string };
  let sent: Sent[];
  let login: typeof import("@/lib/login-code");
  let user: { id: string; email: string };
  const lastCode = () => sent.at(-1)!.text.match(/\b\d{6}\b/)![0];
  const stubResend = (status: number) =>
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push({ url, ...JSON.parse(init.body) });
      return new Response(status === 200 ? "{}" : "refused", { status });
    });

  beforeAll(async () => {
    process.env.AUTH_SECRET = "x".repeat(40);
    login = await import("@/lib/login-code");
    user = await prisma.user.create({ data: { email: "uma@lendhous.com", name: "Uma", passwordHash: "x", accountStatus: "APPROVED" } });
  });
  beforeEach(async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "LendHous <noreply@synergifund.com>";
    sent = [];
    stubResend(200);
    (await import("@/lib/rate-limit")).resetRateLimits();
    await prisma.loginCode.deleteMany();
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mails the code through Resend, and the code works once", async () => {
    expect(await login.issueLoginCode(user)).toBe("sent");
    expect(sent[0]).toMatchObject({ url: "https://api.resend.com/emails", to: ["uma@lendhous.com"], from: "LendHous <noreply@synergifund.com>" });
    expect(await login.takeLoginCode(user.id, ` ${lastCode().slice(0, 3)} ${lastCode().slice(3)} `)).toBe(true);
    expect(await login.takeLoginCode(user.id, lastCode())).toBe(false);
    expect(await prisma.notification.count({ where: { toEmail: user.email } })).toBe(0);
  });
  it("refuses a wrong code, another account's code and an expired code", async () => {
    await login.issueLoginCode(user);
    const code = lastCode();
    expect(await login.takeLoginCode(user.id, code === "000000" ? "000001" : "000000")).toBe(false);
    expect(await login.takeLoginCode("someone-else", code)).toBe(false);
    await prisma.loginCode.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await login.takeLoginCode(user.id, code)).toBe(false);
  });
  it("using a code retires the others sent to that account", async () => {
    await login.issueLoginCode(user);
    const first = lastCode();
    await login.issueLoginCode(user);
    expect(await login.takeLoginCode(user.id, lastCode())).toBe(true);
    expect(await login.takeLoginCode(user.id, first)).toBe(false);
  });
  it("when Resend refuses, says so, keeps no code and logs no code", async () => {
    stubResend(401);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await login.issueLoginCode(user)).toBe("failed");
    expect(await prisma.loginCode.count({ where: { userId: user.id } })).toBe(0);
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify([...error.mock.calls, ...info.mock.calls], (_key, value) => (value instanceof Error ? value.message : value))).not.toContain(lastCode());
  });
  it("stops mailing after five codes in ten minutes", async () => {
    for (let i = 0; i < 5; i++) expect(await login.issueLoginCode(user)).toBe("sent");
    expect(await login.issueLoginCode(user)).toBe("limited");
    expect(sent).toHaveLength(5);
  });
  it("leaves a demo address's code in the server log, not with Resend", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await login.issueLoginCode({ id: user.id, email: "uma.underwriter@lendhous.test" })).toBe("sent");
    expect(sent).toHaveLength(0);
    expect(String(info.mock.calls[0][0])).toMatch(/sign-in code is \d{6}/);
  });
  it("the release build clears old authenticator data and keeps the sign-in code setting", async () => {
    const { dropAuthenticatorData } = await import("@/lib/bootstrap");
    await prisma.user.update({ where: { id: user.id }, data: { emailCodeEnabled: true } });
    await prisma.$runCommandRaw({ update: "User", updates: [{ q: { _id: user.id }, u: { $set: { totpSecretEnc: "enc", totpEnabled: true, recoveryHashes: "h", recoveryRevealEnc: "r" } } }] });
    await dropAuthenticatorData();
    await dropAuthenticatorData();
    const raw = (await prisma.$runCommandRaw({ find: "User", filter: { _id: user.id } })) as { cursor: { firstBatch: Record<string, unknown>[] } };
    const doc = raw.cursor.firstBatch[0];
    for (const field of ["totpSecretEnc", "totpEnabled", "recoveryHashes", "recoveryRevealEnc"]) expect(doc).not.toHaveProperty(field);
    expect(doc.emailOtpFallback).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailCodeEnabled).toBe(true);
  });
});

describe("members and password links", () => {
  let members: typeof import("@/lib/members");
  let owner: { id: string; name: string; organizationId: string | null; roleCodes: "ADMIN_OWNER"[] };
  const input = (email: string, roles: import("@prisma/client").RoleCode[] = ["PROCESSOR"]) => ({ name: "New Person", email, title: "", roles, permissions: lib.access(roles) });
  const issue = async (email: string, roles?: import("@prisma/client").RoleCode[]) => {
    const result = await members.inviteMember(owner, input(email, roles));
    if ("error" in result) throw new Error(result.error);
    return result.issued;
  };
  const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "x".repeat(40);
    process.env.NEXT_PUBLIC_APP_URL = "https://portal.example.com";
    members = await import("@/lib/members");
    const row = await prisma.user.create({ data: { email: "boss@lendhous.com", name: "Boss", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    owner = { id: row.id, name: row.name, organizationId: null, roleCodes: ["ADMIN_OWNER"] };
  });
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invites someone with a link that sets their password once", async () => {
    const issued = await issue("first@example.com");
    expect(issued.link).toMatch(/^https:\/\/portal\.example\.com\/login\/set-password\?token=/);
    expect(issued.mail).toBe("logged");
    const token = tokenOf(issued.link);
    expect(await members.peekPasswordLink(token)).toEqual({ email: "first@example.com" });
    expect(await members.usePasswordLink(token, "too-short")).toMatchObject({ error: expect.stringMatching(/at least 12/) });
    expect(await members.usePasswordLink(token, "a-long-enough-password")).toHaveProperty("userId");
    expect(await members.peekPasswordLink(token)).toBeNull();
    expect(await members.usePasswordLink(token, "another-long-password")).toMatchObject({ error: expect.stringMatching(/expired or was already used/) });
    const bcrypt = (await import("bcryptjs")).default;
    const saved = await prisma.user.findUniqueOrThrow({ where: { email: "first@example.com" } });
    expect(await bcrypt.compare("a-long-enough-password", saved.passwordHash)).toBe(true);
  });
  it("stores only a hash of the link, and keeps it out of the notifications", async () => {
    const issued = await issue("hash@example.com");
    const row = await prisma.passwordLink.findFirstOrThrow({ where: { user: { email: "hash@example.com" } } });
    expect(row.tokenHash).not.toBe(tokenOf(issued.link));
    expect(await prisma.notification.count({ where: { toEmail: "hash@example.com" } })).toBe(0);
  });
  it("refuses an expired link, and a new link replaces the old one", async () => {
    const issued = await issue("expired@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "expired@example.com" } });
    const second = await members.reissueLink(owner, user.id);
    if ("error" in second) throw new Error(second.error);
    expect(await members.peekPasswordLink(tokenOf(issued.link))).toBeNull();
    await prisma.passwordLink.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await members.peekPasswordLink(tokenOf(second.issued.link))).toBeNull();
    expect(await members.usePasswordLink(tokenOf(second.issued.link), "a-long-enough-password")).toHaveProperty("error");
  });
  it("won't let a non-owner get a link for someone with more access", async () => {
    await issue("senior@example.com", ["UNDERWRITER"]);
    const senior = await prisma.user.findUniqueOrThrow({ where: { email: "senior@example.com" } });
    const manager = { id: "manager", roleCodes: ["PROCESSOR" as const], extraPermissions: ["manage_users"] };
    expect(await members.reissueLink(manager, senior.id)).toMatchObject({ error: expect.stringMatching(/more access than you/) });
    expect(await members.reissueLink(manager, owner.id)).toMatchObject({ error: expect.stringMatching(/more access than you/) });
  });
  it("refuses a duplicate, a demo address and a bad address", async () => {
    await issue("twice@example.com");
    expect(await members.inviteMember(owner, input("twice@example.com"))).toMatchObject({ error: expect.stringMatching(/already belongs/) });
    expect(await members.inviteMember(owner, input("someone@lendhous.test"))).toMatchObject({ error: expect.stringMatching(/demo accounts/) });
    expect(await members.inviteMember(owner, input("not-an-address"))).toMatchObject({ error: expect.stringMatching(/valid email/) });
    expect(await members.inviteMember(owner, { ...input("noroles@example.com"), roles: [] })).toMatchObject({ error: expect.stringMatching(/at least one role/) });
  });
  it("changes roles and access, and keeps only the differences", async () => {
    await issue("change@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "change@example.com" } });
    expect(await members.updateMember(owner, user.id, { ...input("change@example.com", ["SERVICER"]), title: "Servicing lead", permissions: [...lib.access(["SERVICER"]).filter((p) => p !== "waive_fee"), "view_audit"] })).toEqual({ ok: true });
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { roles: true } });
    expect(saved.roles.map((row) => row.role)).toEqual(["SERVICER"]);
    expect(saved).toMatchObject({ title: "Servicing lead", extraPermissions: ["view_audit"], deniedPermissions: ["waive_fee"] });
  });
  it("removing someone ends their sessions and kills their link, and they can be invited back", async () => {
    const issued = await issue("gone@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "gone@example.com" } });
    await prisma.serverSession.create({ data: { id: "gone-session", userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
    expect(await members.removeMember(owner, user.id)).toEqual({ ok: true });
    expect(await prisma.serverSession.count({ where: { userId: user.id } })).toBe(0);
    expect(await members.peekPasswordLink(tokenOf(issued.link))).toBeNull();
    expect(await members.removeMember(owner, owner.id)).toMatchObject({ error: expect.stringMatching(/your own/) });
    const back = await issue("gone@example.com", ["BROKER"]);
    expect(await members.peekPasswordLink(tokenOf(back.link))).toEqual({ email: "gone@example.com" });
    const { notDeleted } = await import("@/lib/prisma");
    const row = await prisma.user.findFirstOrThrow({ where: { email: "gone@example.com", ...notDeleted }, include: { roles: true } });
    expect(row.id).toBe(user.id);
    expect(row.roles.map((item) => item.role)).toEqual(["BROKER"]);
  });
  it("reads an account saved before these fields existed", async () => {
    await prisma.$runCommandRaw({ insert: "User", documents: [{ _id: "old-account", email: "old@example.com", name: "Old", passwordHash: "x", phone: "", accountStatus: "APPROVED", emailOtpFallback: false, notifyEmail: true, notifyInApp: true, createdAt: { $date: new Date().toISOString() }, updatedAt: { $date: new Date().toISOString() } }] });
    const old = await prisma.user.findUniqueOrThrow({ where: { id: "old-account" } });
    expect(old).toMatchObject({ extraPermissions: [], deniedPermissions: [], title: null });
  });
});

describe("indexes and jobs", () => {
  it("enforces unique emails and one role row per user", async () => {
    const user = await prisma.user.create({ data: { email: "a@example.com", name: "A", passwordHash: "x", roles: { create: [{ role: "BORROWER" }] } } });
    await expect(prisma.user.create({ data: { email: "a@example.com", name: "B", passwordHash: "x" } })).rejects.toThrow();
    await expect(prisma.userRole.create({ data: { userId: user.id, role: "BORROWER" } })).rejects.toThrow();
  });
  it("runs each job once per day however often cron calls it", async () => {
    const now = new Date("2026-10-28T06:00:00Z");
    expect((await lib.jobs.runJob("sessions", now)).skipped).toBe(false);
    expect((await lib.jobs.runJob("sessions", now)).skipped).toBe(true);
    expect((await lib.jobs.runJob("sessions", new Date("2026-10-29T06:00:00Z"))).skipped).toBe(false);
  });
});
