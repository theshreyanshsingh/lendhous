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
  it("an alert about a brief can be answered straight to the person who sent it", async () => {
    const { notify } = await import("@/lib/email");
    const sent: { reply_to?: string }[] = [];
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "LendHous <noreply@example.net>";
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response("{}");
    });
    await notify("team@lendhous.com", "New brief", "Details", { replyTo: "dana@lendhous-client.com" });
    await notify("team@lendhous.com", "Other alert", "Details");
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    vi.unstubAllGlobals();
    expect(sent[0].reply_to).toBe("dana@lendhous-client.com");
    expect(sent[1].reply_to).toBeUndefined();
  });
  it("notifyTeam reaches an approved owner-admin", async () => {
    const { notifyTeam } = await import("@/lib/email");
    await notifyTeam("New project brief", "Details", "lead.new");
    const notices = await prisma.notification.findMany({ where: { eventCode: "lead.new" }, select: { toEmail: true } });
    expect(notices.map((notice) => notice.toEmail)).toEqual(["owner.live@lendhous.com"]);
  });
});

describe("mailing a password link", () => {
  type Sent = { url: string; to: string[]; from: string; text: string };
  const LINK = "https://portal.example.com/login/set-password?token=live-token";
  let sent: Sent[];
  let email: typeof import("@/lib/email");
  const stubResend = (status: number) =>
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push({ url, ...JSON.parse(init.body) });
      return new Response(status === 200 ? "{}" : "refused", { status });
    });

  beforeAll(async () => {
    email = await import("@/lib/email");
  });
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "LendHous <noreply@synergifund.com>";
    sent = [];
    stubResend(200);
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mails it through Resend and keeps it out of the notifications", async () => {
    expect(await email.sendPasswordLink("uma@lendhous.com", LINK, "self")).toBe("sent");
    expect(sent[0]).toMatchObject({ url: "https://api.resend.com/emails", to: ["uma@lendhous.com"], from: "LendHous <noreply@synergifund.com>" });
    expect(sent[0].text).toContain(LINK);
    expect(await prisma.notification.count({ where: { toEmail: "uma@lendhous.com" } })).toBe(0);
  });
  it("when Resend refuses, says so and logs no link", async () => {
    stubResend(401);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await email.sendPasswordLink("uma@lendhous.com", LINK, "self")).toBe("failed");
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify([...error.mock.calls, ...info.mock.calls], (_key, value) => (value instanceof Error ? value.message : value))).not.toContain("live-token");
  });
  it("leaves a demo address's link in the server log, not with Resend", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await email.sendPasswordLink("uma.underwriter@lendhous.test", LINK, "self")).toBe("logged");
    expect(sent).toHaveLength(0);
    expect(String(info.mock.calls[0][0])).toContain("live-token");
  });
});

describe("the release build's cleanup", () => {
  const rawDoc = async (collection: string, id: string) => ((await prisma.$runCommandRaw({ find: collection, filter: { _id: id } })) as { cursor: { firstBatch: Record<string, unknown>[] } }).cursor.firstBatch[0];
  it("clears what two-factor left behind, runs twice, and leaves people signed in", async () => {
    const { dropSecondFactorData } = await import("@/lib/bootstrap");
    const user = await prisma.user.create({ data: { email: "signed.in@lendhous.com", name: "Signed In", passwordHash: "x", accountStatus: "APPROVED" } });
    await prisma.serverSession.create({ data: { id: "open-session", userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.platformSettings.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
    await prisma.$runCommandRaw({ update: "User", updates: [{ q: { _id: user.id }, u: { $set: { totpSecretEnc: "enc", totpEnabled: true, recoveryHashes: "h", recoveryRevealEnc: "r", emailOtpFallback: true } } }] });
    await prisma.$runCommandRaw({ update: "ServerSession", updates: [{ q: { _id: "open-session" }, u: { $set: { secondFactorAt: { $date: new Date().toISOString() } } } }] });
    await prisma.$runCommandRaw({ update: "PlatformSettings", updates: [{ q: { _id: "default" }, u: { $set: { requireStaffMfa: true } } }] });
    await prisma.$runCommandRaw({ insert: "LoginCode", documents: [{ _id: "old-code", userId: user.id, codeHash: "h" }] });

    await dropSecondFactorData();
    await dropSecondFactorData();

    const account = await rawDoc("User", user.id);
    for (const field of ["totpSecretEnc", "totpEnabled", "recoveryHashes", "recoveryRevealEnc", "emailOtpFallback"]) expect(account).not.toHaveProperty(field);
    expect(account.email).toBe("signed.in@lendhous.com");
    expect(await rawDoc("ServerSession", "open-session")).not.toHaveProperty("secondFactorAt");
    expect(await prisma.serverSession.count({ where: { id: "open-session" } })).toBe(1);
    expect(await rawDoc("PlatformSettings", "default")).not.toHaveProperty("requireStaffMfa");
    const collections = (await prisma.$runCommandRaw({ listCollections: 1, filter: { name: "LoginCode" } })) as { cursor: { firstBatch: unknown[] } };
    expect(collections.cursor.firstBatch).toHaveLength(0);
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
  it("a forgotten-password link goes only to an active account", async () => {
    await issue("forgetful@example.com");
    await prisma.passwordLink.deleteMany({ where: { user: { email: "forgetful@example.com" } } });
    await members.sendSelfServiceLink("forgetful@example.com");
    expect(await prisma.passwordLink.count({ where: { user: { email: "forgetful@example.com" } } })).toBe(1);
    const before = await prisma.passwordLink.count();
    await expect(members.sendSelfServiceLink("nobody@example.com")).resolves.toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "forgetful@example.com" } });
    await members.removeMember(owner, user.id);
    await members.sendSelfServiceLink("forgetful@example.com");
    expect(await prisma.passwordLink.count()).toBe(before - 1);
  });
  it("reads an account saved before these fields existed", async () => {
    await prisma.$runCommandRaw({ insert: "User", documents: [{ _id: "old-account", email: "old@example.com", name: "Old", passwordHash: "x", phone: "", accountStatus: "APPROVED", emailOtpFallback: false, notifyEmail: true, notifyInApp: true, createdAt: { $date: new Date().toISOString() }, updatedAt: { $date: new Date().toISOString() } }] });
    const old = await prisma.user.findUniqueOrThrow({ where: { id: "old-account" } });
    expect(old).toMatchObject({ extraPermissions: [], deniedPermissions: [], title: null });
  });
});

describe("in-app notifications", () => {
  it("counts unread notices that never had readAt written, and marks them read", async () => {
    const { markAllRead, recentNotices, unreadCount } = await import("@/lib/notifications");
    const person = await prisma.user.create({ data: { email: "reader@example.com", name: "Reader", passwordHash: "x", accountStatus: "APPROVED" } });
    const other = { id: "someone-else", email: "other@example.com" };
    await prisma.notification.create({ data: { toEmail: person.email, userId: person.id, subject: "First", body: "One" } });
    await prisma.notification.create({ data: { toEmail: person.email, subject: "Second", body: "Two" } });
    await prisma.notification.create({ data: { toEmail: other.email, subject: "Not yours", body: "Three" } });
    expect(await unreadCount(person)).toBe(2);
    expect((await recentNotices(person)).map((notice) => notice.subject).sort()).toEqual(["First", "Second"]);
    await markAllRead(person);
    expect(await unreadCount(person)).toBe(0);
    expect(await unreadCount(other)).toBe(1);
  });
});

describe("encryption at rest", () => {
  const staff = { id: "staff-1", name: "Sam Staff", roleCodes: ["ADMIN_OWNER" as const] };
  const key = (id: string, fill: number) => `${id}:${Buffer.alloc(32, fill).toString("base64")}`;
  const raw = async (collection: string) => ((await prisma.$runCommandRaw({ find: collection, filter: {} })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch;
  const startLoan = async () => {
    const { demoBook } = await import("@/lib/book");
    const { runAction } = await import("@/lib/book-store");
    const app = demoBook().deals.find((deal) => deal.id === "d2")!.app;
    const done = await runAction(staff, { t: "submitApp", app, address: "100 Secret Street", city: "Hollywood", zip: "33020", entityName: "Secret Flips LLC", exitStrategy: "Sell", client: { name: "Bonnie Borrower" } });
    if ("error" in done) throw new Error(done.error);
    return done.after.deals[0];
  };
  afterEach(() => {
    delete process.env.FIELD_ENCRYPTION_KEYS;
  });

  it("the loan book is ciphertext in the database, and reads back whole", async () => {
    const { readBook } = await import("@/lib/book-store");
    const deal = await startLoan();
    const stored = JSON.stringify(await raw("BookRecord"));
    for (const secret of ["Bonnie Borrower", "100 Secret Street", "Secret Flips", '"fico"']) expect(stored).not.toContain(secret);
    expect((await readBook()).book.deals.find((item) => item.id === deal.id)).toMatchObject({ borrowerName: "Bonnie Borrower", address: "100 Secret Street" });
  });
  it("a brief's contact details and notes are ciphertext too, and open for staff", async () => {
    const { sealLead, openLead } = await import("@/lib/lead-store");
    const details = { name: "Dana Investor", email: "dana@example.com", phone: "555-0100", strategy: "Fix & flip", experience: "", city: "Dallas", state: "TX", propertyValueCents: 100, renovationCents: 0, requestedLoanCents: 80, targetClosing: "", notes: "Selling in spring." };
    const row = await prisma.lead.create({ data: sealLead(details) });
    const stored = JSON.stringify(await raw("Lead"));
    for (const secret of ["Dana Investor", "dana@example.com", "555-0100", "Dallas", "Selling in spring"]) expect(stored).not.toContain(secret);
    expect(openLead(row)).toMatchObject({ name: "Dana Investor", email: "dana@example.com", notes: "Selling in spring.", requestedLoanCents: 80 });
  });
  it("a saved alert is ciphertext, and reads back for the person it went to", async () => {
    const { notify } = await import("@/lib/email");
    const { recentNotices } = await import("@/lib/notifications");
    await notify("sealed@example.com", "New brief: Dallas", "Name: Dana Investor", { eventCode: "lead.new" });
    const stored = JSON.stringify(await raw("Notification"));
    expect(stored).not.toContain("Dana Investor");
    expect(stored).not.toContain("New brief: Dallas");
    expect((await recentNotices({ id: "nobody", email: "sealed@example.com" }))[0]).toMatchObject({ subject: "New brief: Dallas", body: "Name: Dana Investor" });
  });
  it("the migration seals what came before, loses nothing, and changes nothing the second time", async () => {
    const { encryptStoredData } = await import("@/lib/encrypt-data");
    const { readBook } = await import("@/lib/book-store");
    const { openLead } = await import("@/lib/lead-store");
    const { recentNotices } = await import("@/lib/notifications");
    const { getBytes, uploadDir } = await import("@/lib/storage");
    const { readField } = await import("@/lib/crypto");
    const { documentNameContext } = await import("@/lib/uploads");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await encryptStoredData();

    // What an older build left behind: plain records, written straight to the database and the disk.
    const { demoBook } = await import("@/lib/book");
    const old = { ...demoBook().deals[0], id: "old-deal", borrowerName: "Olive Older" };
    await prisma.bookRecord.create({ data: { id: "deals:old-deal", kind: "deals", data: JSON.parse(JSON.stringify(old)) } });
    const lead = await prisma.lead.create({ data: { name: "Olive Older", email: "olive@example.com", strategy: "Fix & flip", city: "Reno", state: "NV", propertyValueCents: 1, requestedLoanCents: 1, notes: "Old note" } });
    await prisma.notification.create({ data: { toEmail: "olive@example.com", subject: "Old subject", body: "Old body" } });
    const storageKey = "test-encrypt/old-statement.pdf";
    const file = path.join(uploadDir(), storageKey);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "%PDF-1.4 Olive Older statement");
    const document = await prisma.document.create({ data: { ownerType: "LOAN", ownerId: "old-deal", documentType: "bank", originalName: "olive-statement.pdf", storageKey, mime: "application/pdf", size: 10, sha256: "x" } });
    try {
      expect((await readBook()).book.deals.some((deal) => deal.borrowerName === "Olive Older")).toBe(true);
      expect(await encryptStoredData()).toEqual({ records: 1, leads: 1, notices: 1, documentNames: 1, files: 1, missing: 0 });

      expect(JSON.stringify(await raw("BookRecord"))).not.toContain("Olive Older");
      expect(JSON.stringify(await raw("Lead"))).not.toContain("Olive Older");
      expect(JSON.stringify(await raw("Notification"))).not.toContain("Old body");
      expect(JSON.stringify(await raw("Document"))).not.toContain("olive-statement");
      expect((await fs.readFile(file)).includes(Buffer.from("Olive Older"))).toBe(false);

      expect((await readBook()).book.deals.find((deal) => deal.id === "old-deal")?.borrowerName).toBe("Olive Older");
      expect(openLead(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).notes).toBe("Old note");
      expect((await recentNotices({ id: "nobody", email: "olive@example.com" }))[0].body).toBe("Old body");
      expect((await getBytes(storageKey)).toString()).toBe("%PDF-1.4 Olive Older statement");
      const name = (await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).originalName;
      expect(readField(name, documentNameContext(document.id))).toBe("olive-statement.pdf");

      expect(await encryptStoredData()).toEqual({ records: 0, leads: 0, notices: 0, documentNames: 0, files: 0, missing: 0 });
      // A file already under the current key isn't read again: with it gone from disk, nothing is reported missing.
      await fs.rm(file);
      expect((await encryptStoredData()).missing).toBe(0);
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true });
      await prisma.document.deleteMany({ where: { id: document.id } });
      await prisma.bookRecord.deleteMany({ where: { id: "deals:old-deal" } });
    }
  });
  it("moves everything to a new key, and then the old key can go", async () => {
    const { encryptStoredData } = await import("@/lib/encrypt-data");
    const { readBook } = await import("@/lib/book-store");
    const dev = `dev:${(await import("@/lib/crypto")).DEV_FIELD_KEY.toString("base64")}`;
    process.env.FIELD_ENCRYPTION_KEYS = `${key("k1", 1)},${dev}`;
    await encryptStoredData();
    process.env.FIELD_ENCRYPTION_KEYS = `${key("k2", 2)},${key("k1", 1)}`;
    expect((await encryptStoredData()).records).toBeGreaterThan(0);
    process.env.FIELD_ENCRYPTION_KEYS = key("k2", 2);
    expect((await readBook()).book.deals.length).toBeGreaterThan(0);
    process.env.FIELD_ENCRYPTION_KEYS = key("k1", 1);
    await expect(readBook()).rejects.toThrow(/is not configured/);
    process.env.FIELD_ENCRYPTION_KEYS = `${dev},${key("k2", 2)}`;
    await encryptStoredData();
  });
  it("one lost file doesn't stop the rest", async () => {
    const { encryptStoredData } = await import("@/lib/encrypt-data");
    const row = await prisma.document.create({ data: { ownerType: "LOAN", ownerId: "x", documentType: "bank", originalName: "gone.pdf", storageKey: "test-encrypt/not-there.pdf", mime: "application/pdf", size: 1, sha256: "x" } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await encryptStoredData()).missing).toBe(1);
    quiet.mockRestore();
    await prisma.document.delete({ where: { id: row.id } });
  });
});

describe("a photo link", () => {
  const staff = { id: "staff-2", name: "Sam Staff", roleCodes: ["ADMIN_OWNER" as const] };
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  let links: typeof import("@/lib/photo-links");
  let store: typeof import("@/lib/book-store");
  let route: typeof import("@/app/api/photo-links/[token]/route");
  let dealId: string;

  const params = (token: string) => ({ params: Promise.resolve({ token }) });
  const expires = (days = 14) => new Date(Date.now() + days * 86_400_000).toISOString();
  const openRequest = async (requestId: string, scopeIds = ["kitchen"]) => {
    const done = await store.runAction(staff, { t: "askForPhotos", requestId, dealId, to: "Carl Contractor", who: "contractor", scopeIds, by: "Sam at LendHous", byTeam: true, expiresAt: expires() }, { trusted: true });
    if ("error" in done) throw new Error(done.error);
    return new URL(await links.createPhotoLink(requestId, expires()), "http://x").pathname.split("/").pop()!;
  };
  const upload = (token: string, fields: Record<string, string> = {}, file = new File([JPEG], "kitchen.jpg", { type: "image/jpeg" })) => {
    const form = new FormData();
    form.set("file", file);
    form.set("scopeId", "kitchen");
    form.set("shot", "room");
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return route.POST(new Request(`http://x/api/photo-links/${token}`, { method: "POST", body: form }), params(token));
  };
  const request = async (id: string) => (await store.readBook()).book.photoRequests.find((item) => item.id === id)!;

  beforeAll(async () => {
    links = await import("@/lib/photo-links");
    store = await import("@/lib/book-store");
    route = await import("@/app/api/photo-links/[token]/route");
    const { demoBook } = await import("@/lib/book");
    const done = await store.runAction(staff, { t: "submitApp", app: demoBook().deals.find((deal) => deal.id === "d2")!.app, address: "200 Link Street", city: "Hollywood", zip: "33020", entityName: "Link LLC", exitStrategy: "Sell", client: { name: "Lena Link" } });
    if ("error" in done) throw new Error(done.error);
    dealId = done.after.deals[0].id;
  });

  it("stores only a hash, and opens from the real token", async () => {
    const token = await openRequest("req-hash");
    const row = await prisma.photoLink.findFirstOrThrow({ where: { requestId: "req-hash" } });
    expect(row.tokenHash).not.toContain(token);
    expect(token.length).toBeGreaterThan(40);
    expect((await links.openPhotoLink(token))?.request.id).toBe("req-hash");
    expect(await links.openPhotoLink("not-a-real-token")).toBeNull();
    expect(await links.openPhotoLink(row.tokenHash)).toBeNull();
    expect(await links.openPhotoLink("")).toBeNull();
  });
  it("won't open past its date", async () => {
    const token = await openRequest("req-old");
    await prisma.photoLink.updateMany({ where: { requestId: "req-old" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await links.openPhotoLink(token)).toBeNull();
    expect((await upload(token)).status).toBe(404);
  });
  it("a new link replaces the old one", async () => {
    const old = await openRequest("req-new");
    const next = new URL(await links.createPhotoLink("req-new", expires()), "http://x").pathname.split("/").pop()!;
    expect(await links.openPhotoLink(old)).toBeNull();
    expect((await links.openPhotoLink(next))?.request.id).toBe("req-new");
  });
  it("takes a photo, encrypted, with what the phone says about it", async () => {
    const token = await openRequest("req-photo");
    const response = await upload(token, { takenAt: "2026-11-01T10:00:00.000Z", lat: "26.01", lng: "-80.15" });
    expect(response.status).toBe(200);
    const { photo } = await response.json();
    expect((await request("req-photo")).photos[0]).toMatchObject({ id: photo.id, scopeId: "kitchen", shot: "room", name: "kitchen.jpg", takenAt: "2026-11-01T10:00:00.000Z", lat: 26.01, lng: -80.15 });
    const document = await prisma.document.findUniqueOrThrow({ where: { id: photo.id } });
    expect(document).toMatchObject({ ownerId: dealId, documentType: "draw_photo", mime: "image/jpeg", uploadedById: null, fileKeyId: "dev" });
    expect(document.originalName).not.toContain("kitchen");
    const { getBytes, uploadDir } = await import("@/lib/storage");
    expect((await getBytes(document.storageKey)).equals(JPEG)).toBe(true);
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    expect((await fs.readFile(path.join(uploadDir(), document.storageKey))).includes(JPEG)).toBe(false);
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { entityId: photo.id, action: "document.uploaded" } })).actorId).toBeNull();
  });
  it("ignores nonsense from the phone rather than refusing the photo", async () => {
    const token = await openRequest("req-junk");
    expect((await upload(token, { takenAt: "yesterday", lat: "999" })).status).toBe(200);
    const saved = (await request("req-junk")).photos[0];
    expect(saved.takenAt).toBeUndefined();
    expect(saved.lat).toBeUndefined();
  });
  it("refuses anything that isn't a photo, and shots that aren't on the request", async () => {
    const token = await openRequest("req-bad");
    expect((await upload(token, {}, new File(["<script>"], "evil.jpg", { type: "image/jpeg" }))).status).toBe(400);
    expect((await upload(token, {}, new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" }))).status).toBe(400);
    expect((await upload(token, { scopeId: "plumbing", shot: "lines" })).status).toBe(400);
    expect((await upload(token, { shot: "not-a-shot" })).status).toBe(400);
    expect((await upload(token, { scopeId: "property", shot: "front" })).status).toBe(200);
    expect((await request("req-bad")).photos).toHaveLength(1);
  });
  it("gives back only its own photos", async () => {
    const mine = await openRequest("req-mine");
    const other = await openRequest("req-other");
    const { photo } = await (await upload(mine)).json();
    const remove = (token: string) => route.DELETE(new Request(`http://x/api/photo-links/${token}?photo=${photo.id}`, { method: "DELETE" }), params(token));
    expect((await remove(other)).status).toBe(404);
    expect((await request("req-mine")).photos).toHaveLength(1);
    expect((await remove(mine)).status).toBe(200);
    expect((await request("req-mine")).photos).toHaveLength(0);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: photo.id } })).deletedAt).toBeTruthy();
  });
  it("shows the person holding the link their own photos, and nothing else", async () => {
    const { GET } = await import("@/app/api/photo-links/[token]/[photoId]/route");
    const mine = await openRequest("req-see");
    const other = await openRequest("req-see-other");
    const { photo } = await (await upload(mine)).json();
    const get = (token: string, photoId: string) => GET(new Request("http://x"), { params: Promise.resolve({ token, photoId }) });
    const shown = await get(mine, photo.id);
    expect(shown.status).toBe(200);
    expect(Buffer.from(await shown.arrayBuffer()).equals(JPEG)).toBe(true);
    expect(shown.headers.get("Content-Disposition")).toContain("inline");
    expect((await get(other, photo.id)).status).toBe(404);
    expect((await get("not-a-token", photo.id)).status).toBe(404);
    const off = await store.runAction(staff, { t: "turnOffPhotoRequest", requestId: "req-see" }, { trusted: true });
    expect("error" in off).toBe(false);
    expect((await get(mine, photo.id)).status).toBe(404);
  });
  it("finishing needs a photo, a name and a confirmation, and tells the team", async () => {
    const token = await openRequest("req-finish");
    const finish = (body: unknown) => route.PATCH(new Request(`http://x/api/photo-links/${token}`, { method: "PATCH", body: JSON.stringify(body) }), params(token));
    expect((await finish({ name: "Carl", note: "", confirmed: true })).status).toBe(400);
    await upload(token);
    expect((await finish({ name: "Carl", note: "" })).status).toBe(400);
    expect((await finish({ name: " ", note: "", confirmed: true })).status).toBe(400);
    expect((await finish({ name: "Carl", note: "Appliances next week.", confirmed: true })).status).toBe(200);
    expect(await request("req-finish")).toMatchObject({ status: "received", finishedBy: "Carl", note: "Appliances next week." });
    const alerts = await prisma.notification.count({ where: { eventCode: "photos.received" } });
    expect(alerts).toBeGreaterThan(0);
    expect((await finish({ name: "Carl", note: "Again", confirmed: true })).status).toBe(200);
    expect(await prisma.notification.count({ where: { eventCode: "photos.received" } })).toBe(alerts);
    // It stays open for anything that was missed.
    expect((await upload(token)).status).toBe(200);
  });
  it("keeps one working link per request, even when two are made at once", async () => {
    await openRequest("req-twice");
    const [first, second] = await Promise.all([links.createPhotoLink("req-twice", expires()), links.createPhotoLink("req-twice", expires())].map((made) => made.catch(() => null)));
    const working = [];
    for (const made of [first, second]) if (made && (await links.openPhotoLink(new URL(made, "http://x").pathname.split("/").pop()!))) working.push(made);
    expect(working).toHaveLength(1);
    expect(await prisma.photoLink.count({ where: { requestId: "req-twice" } })).toBe(1);
  });
  it("stops taking photos the moment it's turned off", async () => {
    const token = await openRequest("req-off");
    const done = await store.runAction(staff, { t: "turnOffPhotoRequest", requestId: "req-off" }, { trusted: true });
    expect("error" in done).toBe(false);
    expect((await upload(token)).status).toBe(410);
  });
  it("refuses a request too large to be one photo, before reading it", async () => {
    const token = await openRequest("req-big");
    const response = await route.POST(new Request(`http://x/api/photo-links/${token}`, { method: "POST", headers: { "content-length": String(17 * 1024 * 1024) } }), params(token));
    expect(response.status).toBe(413);
  });
});

describe("published pricing", () => {
  it("a published version prices new loans, while a loan saved before versions keeps the original numbers", async () => {
    const { demoBook } = await import("@/lib/book");
    const { readBook, runAction } = await import("@/lib/book-store");
    const { pricingConfig } = await import("@/lib/pricing-config");
    const { applyDraft, draftOf } = await import("@/lib/pricing-draft");
    const { BASE_VERSION, currentPricing } = await import("@/lib/pricing-versions");
    const { evaluate } = await import("@/lib/engine");
    const { sealJson } = await import("@/lib/crypto");
    const { rowContext } = await import("@/lib/book-store");
    // A loan written before pricing had versions: its app has no pricingVersion.
    const { pricingVersion: _version, ...legacyApp } = demoBook().deals.find((deal) => deal.id === "d9")!.app;
    const legacy = { ...demoBook().deals.find((deal) => deal.id === "d9")!, id: "legacy-priced", loanNumber: "LH-3001", app: legacyApp };
    await prisma.bookRecord.create({ data: { id: "deals:legacy-priced", kind: "deals", data: sealJson(legacy, rowContext("deals:legacy-priced")) as never } });
    const draft = draftOf(pricingConfig);
    draft.fixFlip.tiers[2].rate = [13, 14];
    const config = applyDraft(pricingConfig, draft, "2026-11-03-v1");
    await prisma.pricingVersion.create({ data: { version: config.version, config: config as never, note: "Test", publishedBy: "Owen" } });
    // Another process priced a loan on it: reading that loan makes this one load the version straight away.
    const other = { ...legacy, id: "other-priced", loanNumber: "LH-3002", app: { ...legacyApp, pricingVersion: config.version } };
    await prisma.bookRecord.create({ data: { id: "deals:other-priced", kind: "deals", data: sealJson(other, rowContext("deals:other-priced")) as never } });

    const read = (await readBook()).book;
    expect(currentPricing().version).toBe("2026-11-03-v1");
    const stored = read.deals.find((deal) => deal.id === "legacy-priced")!;
    expect(stored.app.pricingVersion).toBe(BASE_VERSION);
    expect(evaluate(stored.app).rate).toBe(evaluate({ ...stored.app, pricingVersion: BASE_VERSION }).rate);
    const staff = { id: "staff-p", name: "Pat Pricing", roleCodes: ["ADMIN_OWNER" as const] };
    const done = await runAction(staff, { t: "submitApp", app: { ...legacyApp, verifiedDeals: 3 }, address: "300 Price St", city: "Hollywood", zip: "33020", entityName: "Price LLC", exitStrategy: "Sell", client: { name: "Pia Price" } });
    if ("error" in done) throw new Error(done.error);
    const fresh = done.after.deals[0];
    expect(fresh.app.pricingVersion).toBe("2026-11-03-v1");
    expect(evaluate(fresh.app).rateRange).toEqual([13, 14]);
    await prisma.pricingVersion.deleteMany({});
    await prisma.bookRecord.deleteMany({ where: { id: { in: ["deals:legacy-priced", "deals:other-priced"] } } });
  });
});

describe("the title company's link", () => {
  it("lets title upload the checklist and enter its own wire, keeps the numbers sealed, and stops when turned off", async () => {
    const store = await import("@/lib/book-store");
    const { demoBook } = await import("@/lib/book");
    const { sealJson } = await import("@/lib/crypto");
    const links = await import("@/lib/title-links");
    const actions = await import("@/actions/title-links");
    const route = await import("@/app/api/closing-links/[token]/route");
    const { servicingDate } = await import("@/lib/servicing");
    const staff = { id: "staff-t", name: "Tess Closer", roleCodes: ["ADMIN_OWNER" as const] };
    const done = await store.runAction(staff, { t: "submitApp", app: demoBook().deals.find((deal) => deal.id === "d2")!.app, address: "500 Title Way", city: "Hollywood", zip: "33020", entityName: "Title Test LLC", exitStrategy: "Sell", client: { name: "Tia Titletest" } });
    if ("error" in done) throw new Error(done.error);
    const dealId = done.after.deals[0].id;
    // Straight to closing, with the closing agent saved.
    const rowId = `deals:${dealId}`;
    await prisma.bookRecord.update({ where: { id: rowId }, data: { data: sealJson({ ...done.after.deals[0], status: "closing", closing: { company: "Sample Title", contact: "Terry Title", phone: "9545550142", email: "terry@title.test", fileNumber: "ST-9" } }, store.rowContext(rowId)) as never } });
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const opened = await store.runAction(staff, { t: "openTitleLink", dealId, sentTo: "Terry Title", email: "terry@title.test", sentBy: "Tess at LendHous", expiresAt }, { trusted: true });
    if ("error" in opened) throw new Error(opened.error);
    const token = new URL(await links.createTitleLink(dealId, expiresAt), "http://x").pathname.split("/").pop()!;
    expect((await prisma.closingLink.findUniqueOrThrow({ where: { dealId } })).tokenHash).not.toContain(token);
    const link = await links.openTitleLink(token);
    expect(link).toMatchObject({ state: "open", view: { entity: "Title Test LLC", items: expect.arrayContaining([expect.objectContaining({ id: "closing-cpl", status: "requested" })]) } });
    expect(JSON.stringify(link!.view)).not.toMatch(/sponsor|creditReview|payments/);

    expect(await actions.titleEnterWire(token, { bankName: "Escrow Bank", beneficiary: "Sample Title Escrow", routing: "123456789", account: "5544332211", reference: "ST-9" })).toMatchObject({ error: expect.stringMatching(/routing number isn't valid/) });
    const wired = await actions.titleEnterWire(token, { bankName: "Escrow Bank", beneficiary: "Sample Title Escrow", routing: "123456780", account: "5544332211", reference: "ST-9" });
    expect(wired.view?.wire).toMatchObject({ account: "•••• 2211", verified: false });
    const stored = (await store.readBook()).book.deals.find((deal) => deal.id === dealId)!;
    expect(stored.wires?.[0]).toMatchObject({ enteredBy: "Terry Title (title company)", source: "Title company's secure portal" });
    expect(JSON.stringify(((await prisma.$runCommandRaw({ find: "BookRecord", filter: {} })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch)).not.toContain("5544332211");

    const upload = (docId: string) => {
      const form = new FormData();
      form.set("docId", docId);
      form.set("file", new File([Buffer.from("%PDF-1.4 closing")], "cpl.pdf", { type: "application/pdf" }));
      return route.POST(new Request(`http://x/api/closing-links/${token}`, { method: "POST", body: form }), { params: Promise.resolve({ token }) });
    };
    const sent = await upload("closing-cpl");
    expect(sent.status).toBe(200);
    expect(((await sent.json()) as { view: { items: { id: string; status: string }[] } }).view.items.find((item) => item.id === "closing-cpl")?.status).toBe("uploaded");
    expect((await upload("bank")).status).toBe(400);

    const today = servicingDate(new Date());
    expect((await actions.titleConfirmFunds(token, { amount: 250_000, on: today })).view?.fundsReceived).toMatchObject({ amount: 250_000, on: today });
    expect(await actions.titleRecordMortgage(token, { on: today, reference: "OR 1/2" })).toMatchObject({ error: expect.stringMatching(/after the loan funds/) });

    await store.runAction(staff, { t: "turnOffTitleLink", dealId });
    await links.deleteTitleLink(dealId);
    expect(await links.openTitleLink(token)).toBeNull();
    expect(await actions.titleEnterWire(token, { bankName: "B", beneficiary: "B", routing: "123456780", account: "1234567", reference: "" })).toMatchObject({ error: expect.stringMatching(/expired or isn't valid/) });
    expect((await upload("closing-title")).status).toBe(404);
  });
});

describe("the borrower application link", () => {
  it("prefills from a quote, saves as the borrower goes, and signing starts the loan with private details sealed", async () => {
    const { createApplicationLink, openApplicationLink, signedApplication } = await import("@/lib/application-links");
    const { saveApplicationDraft, signApplication } = await import("@/actions/application-links");
    const { sealLead, sealQuote } = await import("@/lib/lead-store");
    const { blankGuarantor, CONSENT_VERSION, draftFromQuote } = await import("@/lib/borrower-application");
    const { readBook } = await import("@/lib/book-store");
    const officer = await prisma.user.create({ data: { email: "lou.officer@lendhous.com", name: "Lou Officer", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    const quote = { submitter: "borrower" as const, borrower: { firstName: "Kai", lastName: "Investor", email: "kai.investor@example.com", phone: "(954) 555-0100" }, citizenship: "us" as const, creditBand: "720-759" as const, experience: "3-4" as const, address: { street: "1873 West 10th Street", city: "Jacksonville", state: "FL", zip: "32209", county: "Duval" }, propertyType: "sfr" as const, loanType: "fix_flip" as const, purpose: "purchase" as const, purchasePrice: 74_400, rehab: 80_000, arv: 200_000, fundingDate: "2027-01-20", comps: [], exit: "sell" as const, notes: "Fix and flip." };
    const sealed = sealLead({ name: "Kai Investor", email: quote.borrower.email, phone: quote.borrower.phone, strategy: "Fix & flip", experience: "3–4 projects", city: "Jacksonville", state: "FL", propertyValueCents: 7_440_000, renovationCents: 8_000_000, requestedLoanCents: 0, targetClosing: quote.fundingDate, notes: quote.notes });
    const lead = await prisma.lead.create({ data: { ...sealed, quote: sealQuote(quote, sealed.id) } });
    const { url } = await createApplicationLink({ leadId: lead.id, recipient: { name: "Kai Investor", email: quote.borrower.email }, officer: officer.name, sentById: officer.id, draft: draftFromQuote(quote) });
    const token = url.split("/apply/")[1];
    const opened = await openApplicationLink(token);
    expect(opened).toMatchObject({ state: "open", draft: { contact: { email: "kai.investor@example.com" }, loan: { arv: "200,000" } } });

    const draft = opened!.draft;
    draft.property = { ...draft.property, floodZone: "no", propertyType: "sfr", occupancy: "vacant" };
    draft.loan = { ...draft.loan, plan: "Fix and flip.", exit: "sell", closeDate: "2027-01-20" };
    draft.vesting = { hasLlc: true, entityName: "Revive Jax LLC", entityState: "FL", ein: "42-3514732", address: { street: "8051 North Tamiami Trail", city: "Sarasota", state: "FL", zip: "34243", county: "Sarasota" } };
    draft.guarantors = [{ ...blankGuarantor(), firstName: "Kai", lastName: "Investor", email: quote.borrower.email, phone: quote.borrower.phone, dob: "1964-11-19", fico: "710", ssn: "123456789", home: { street: "5024 SW 91st Ave", city: "Cooper City", state: "FL", zip: "33328", county: "Broward" }, twoYears: true, mailingSame: true, marital: "married", citizenship: "us", ownershipPct: "100", answers: { bankruptcy: false, foreclosure: false, delinquent: false, judgments: false, lawsuit: false, felony: false, borrowedDownPayment: false }, occupy: false }];
    expect(await saveApplicationDraft(token, draft, 3)).toHaveProperty("savedAt");
    expect((await openApplicationLink(token))?.row.step).toBe(3);
    const rawLinks = async () => JSON.stringify(((await prisma.$runCommandRaw({ find: "ApplicationLink", filter: {} })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(await rawLinks()).not.toMatch(/123456789|1964-11-19|kai\.investor/);

    const all = { application: true, credit: true, release: true, esign: true };
    expect(await signApplication(token, draft, all, "Someone Else")).toMatchObject({ error: expect.stringMatching(/exactly as you entered/) });
    expect(await signApplication(token, draft, { ...all, esign: false }, "Kai Investor")).toMatchObject({ error: expect.stringMatching(/four boxes/) });
    expect(await signApplication(token, draft, all, "kai  investor")).toEqual({ done: true });

    const loanId = (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).loanId!;
    const deal = (await readBook()).book.deals.find((item) => item.id === loanId)!;
    expect(deal).toMatchObject({ borrowerName: "Kai Investor", entityName: "Revive Jax LLC", source: "website_lead", sponsor: { guarantors: [{ name: "Kai Investor", fico: 710, ownershipPct: 100 }] } });
    expect(await prisma.user.findUnique({ where: { email: "kai.investor@example.com" } })).toMatchObject({ id: deal.borrowerId });
    const rawBook = JSON.stringify(((await prisma.$runCommandRaw({ find: "BookRecord", filter: {} })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(rawBook + (await rawLinks())).not.toMatch(/123456789|1964-11-19/);
    expect(JSON.stringify(deal)).not.toMatch(/123456789|1964-11-19|42-3514732/);
    const signed = await signedApplication(loanId);
    expect(signed?.signature).toMatchObject({ name: "kai investor", version: CONSENT_VERSION, consents: all });
    expect(signed?.draft.guarantors[0].ssn).toBe("123456789");
    expect(await signApplication(token, draft, all, "Kai Investor")).toMatchObject({ error: expect.stringMatching(/no longer works/) });
    expect(await saveApplicationDraft(token, draft, 1)).toHaveProperty("error");
  });
});

describe("the nightly sanctions check", () => {
  it("downloads the list, screens open loans, and keeps the old list when a download fails", async () => {
    const { demoBook } = await import("@/lib/book");
    const { readBook, runAction } = await import("@/lib/book-store");
    // A list in Treasury's format, big enough to pass the sanity check, with one listed person and an alias.
    const sdn = [...Array.from({ length: 6000 }, (_, index) => `${index + 1},"TESTCO ${index + 1} TRADING",-0- ,"TEST",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- `), '90001,"DOE, Jonathan","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- '].join("\r\n");
    const alt = '90001,1,"aka","DOE, Johnny",-0- ';
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => (String(url).includes("alt") ? alt : sdn) })));
    try {
      const staff = { id: "staff-o", name: "Olga Ofac", roleCodes: ["ADMIN_OWNER" as const] };
      const done = await runAction(staff, { t: "submitApp", app: demoBook().deals.find((deal) => deal.id === "d2")!.app, address: "400 List St", city: "Hollywood", zip: "33020", entityName: "Listed Holdings LLC", exitStrategy: "Sell", client: { name: "Johnny Doe" } });
      if ("error" in done) throw new Error(done.error);
      const dealId = done.after.deals[0].id;
      // A partner lender whose only listed name is a person who signs in for it, not the firm or the owners entered.
      await prisma.organization.create({ data: { id: "firm-x", name: "Xavier Capital LLC", type: "PARTNER_LENDER" } });
      await prisma.user.create({ data: { email: "jd@xavier.example", name: "Jonathan Doe", passwordHash: "x", organizationId: "firm-x", roles: { create: [{ role: "PARTNER_LENDER" }] } } });
      const box = demoBook().partners[0].buyBox;
      const saved = await runAction(staff, { t: "saveFirm", kind: "partner", id: "firm-x", name: "Xavier Capital LLC", buyBox: box, principals: ["Xena Xavier"] });
      if ("error" in saved) throw new Error(saved.error);
      const night = await lib.jobs.runJob("sanctions", new Date("2026-11-03T06:00:00Z"));
      expect(night).toMatchObject({ skipped: false, summary: expect.stringMatching(/list of 6002 names \(updated\); screened \d+ loans, \d+ partners and buyers and \d+ brokerages; [1-9]\d* possible match/) });
      const deal = (await readBook()).book.deals.find((item) => item.id === dealId)!;
      expect(deal.screenings?.at(-1)).toMatchObject({ status: "review", list: { names: 6002 } });
      expect(deal.screenings!.at(-1)!.subjects.find((subject) => subject.role === "borrower")!.hits[0]).toMatchObject({ uid: 90001, program: "SDGT" });
      const firm = (await readBook()).book.partners.find((item) => item.id === "firm-x")!;
      expect(firm.screening).toMatchObject({ status: "review", by: "Nightly sanctions check" });
      expect(firm.screening!.subjects.map((subject) => [subject.name, subject.hits.map((hit) => hit.uid)])).toEqual([["Xavier Capital LLC", []], ["Xena Xavier", []], ["Jonathan Doe", [90001]]]);

      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })));
      const failed = await lib.jobs.runJob("sanctions", new Date("2026-11-04T06:00:00Z"));
      expect(failed).toMatchObject({ failed: true, summary: expect.stringMatching(/download failed/) });
      expect((await prisma.sanctionsList.findUnique({ where: { id: "sdn" } }))?.names).toBe(6002);
    } finally {
      vi.unstubAllGlobals();
    }
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
  it("the nightly servicing check marks a missed payment late, saves it, and tells the borrower once", async () => {
    const { demoBook } = await import("@/lib/book");
    const { readBook } = await import("@/lib/book-store");
    const borrower = await prisma.user.create({ data: { email: "late.payer@example.com", name: "Lee Late", passwordHash: "x", roles: { create: [{ role: "BORROWER" }] } } });
    const base = demoBook().deals.find((deal) => deal.id === "d9")!;
    const deal = { ...base, id: "late-loan", loanNumber: "LH-2001", borrowerId: borrower.id, borrowerName: "Lee Late", closingDate: "2026-06-10", nextPaymentDue: "2026-07-01", paymentsLate: 0, status: "servicing_current" };
    await prisma.bookRecord.create({ data: { id: "deals:late-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });

    // July 1 is due; on July 11 it's still inside the grace days.
    expect((await lib.jobs.runJob("servicing", new Date("2026-07-11T06:00:00Z"))).summary).toMatch(/0 with payments past due/);
    expect((await readBook()).book.deals.find((item) => item.id === "late-loan")).toMatchObject({ paymentsLate: 0, servicedThrough: "2026-07-11" });
    const night = await lib.jobs.runJob("servicing", new Date("2026-07-12T06:00:00Z"));
    expect(night).toMatchObject({ skipped: false, summary: expect.stringMatching(/1 with payments past due/) });
    expect((await readBook()).book.deals.find((item) => item.id === "late-loan")).toMatchObject({ paymentsLate: 1, nextPaymentDue: "2026-07-01", servicedThrough: "2026-07-12" });
    expect(await prisma.notification.count({ where: { toEmail: "late.payer@example.com", eventCode: "payment.late" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "book.settleLoans", entityId: "2026-07-12" } })).toBe(1);

    expect((await lib.jobs.runJob("servicing", new Date("2026-07-12T07:00:00Z"))).skipped).toBe(true);
    await lib.jobs.runJob("servicing", new Date("2026-07-13T06:00:00Z"));
    expect(await prisma.notification.count({ where: { toEmail: "late.payer@example.com", eventCode: "payment.late" } })).toBe(1);
  });
});

describe("payoff letters (Fla. Stat. 701.04)", () => {
  it("takes a title company's request from the public form, emails the letter with a link, and the link shows the correction", async () => {
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/book-store");
    const route = await import("@/app/api/payoff-requests/route");
    const pdf = await import("@/app/payoff-letter/[token]/pdf/route");
    const { deliverPayoffLetter } = await import("@/lib/payoff-delivery");
    const links = await import("@/lib/payoff-links");
    const { fundedBalances, evaluate } = await import("@/lib/engine");
    const { addDays, firstDueDate, servicingDate } = await import("@/lib/servicing");
    const today = servicingDate(new Date());
    const borrower = await prisma.user.create({ data: { email: "pat.payoff@example.com", name: "Pat Payoff", passwordHash: "x", roles: { create: [{ role: "BORROWER" }] } } });
    // A loan that funded four months ago and is current: every payment before the next 1st counts as paid.
    const base = demoBook().deals.find((deal) => deal.id === "d9")!;
    const deal = { ...base, id: "payoff-loan", loanNumber: "LH-3001", zip: "33019", borrowerId: borrower.id, borrowerName: "Pat Payoff", closingDate: addDays(today, -120), nextPaymentDue: firstDueDate(today), boardedThrough: undefined, paymentsLate: 0, status: "servicing_current" };
    await prisma.bookRecord.create({ data: { id: "deals:payoff-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    const goodThrough = addDays(today, 12);
    const ask = (changes: Record<string, string> = {}, file?: File) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ loanNumber: "lh-3001", zip: "33019", kind: "title", name: "Terry Title", company: "Sunshine Title", email: "terry@sunshine-title.example.com", phone: "", fileNumber: "ST-77", goodThrough, note: "Closing in ten days", ...changes })) form.set(key, value);
      if (file) form.set("authorization", file);
      return route.POST(new Request("http://x/api/payoff-requests", { method: "POST", body: form }));
    };
    const authorization = new File([Buffer.from("%PDF-1.4 signed by the borrower")], "authorization.pdf", { type: "application/pdf" });

    expect(await (await ask({ zip: "33020" }, authorization)).json()).toMatchObject({ error: expect.stringMatching(/couldn't find a loan/) });
    const missing = await ask();
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: expect.stringMatching(/signed authorization/) });
    const sent = await ask({}, authorization);
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ ok: true, receivedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), dueBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const request = (await store.readBook()).book.payoffs.find((item) => item.dealId === "payoff-loan")!;
    expect(request).toMatchObject({ channel: "web_form", status: "requested", requester: { kind: "title", company: "Sunshine Title", email: "terry@sunshine-title.example.com" }, check: { status: "pending", fileName: "authorization.pdf" } });
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: request.check!.documentId! } });
    expect(stored).toMatchObject({ ownerId: "payoff-loan", documentType: "payoff_authorization" });
    expect(stored.originalName).not.toContain("authorization.pdf");
    // The borrower hears someone else asked; the title company gets a receipt with the due date.
    expect(await prisma.notification.count({ where: { toEmail: "pat.payoff@example.com", eventCode: "payoff.third_party" } })).toBe(1);
    expect(await prisma.notification.count({ where: { toEmail: "terry@sunshine-title.example.com", eventCode: "payoff.received" } })).toBe(1);

    const staff = { id: "staff-p", name: "Sam Servicer", roleCodes: ["ADMIN_OWNER" as const] };
    expect(await store.runAction(staff, { t: "issuePayoffLetter", payoffId: request.id, goodThrough, reason: "", by: "x" })).toMatchObject({ error: expect.stringMatching(/authorization first/) });
    await store.runAction(staff, { t: "acceptPayoffCheck", payoffId: request.id, note: "Signed by the managing member", by: "x" });
    const issued = await store.runAction(staff, { t: "issuePayoffLetter", payoffId: request.id, goodThrough, reason: "", by: "x" });
    if ("error" in issued) throw new Error(issued.error);
    const delivered = (await deliverPayoffLetter(request.id))!;
    expect(delivered.payoffs.find((item) => item.id === request.id)!.letters![0]).toMatchObject({ number: 1, issuedBy: "Sam Servicer", delivery: { to: ["terry@sunshine-title.example.com"], result: "logged" } });
    expect(await deliverPayoffLetter(request.id)).toBeNull();
    expect(await prisma.payoffLink.count({ where: { payoffId: request.id, number: 1 } })).toBe(1);

    const { link } = await links.createPayoffLink(request.id, 1, goodThrough);
    const token = link.split("/").pop()!;
    expect(JSON.stringify(((await prisma.$runCommandRaw({ find: "PayoffLink", filter: {} })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch)).not.toContain(token);
    expect(await links.openPayoffLink(token)).toMatchObject({ sent: 1, letter: { number: 1 } });
    const file = await pdf.GET(new Request(`http://x/payoff-letter/${token}/pdf`), { params: Promise.resolve({ token }) });
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    // A payment ahead of the next due date lowers the payoff, so the letter is out of date and a corrected one goes out,
    // with a copy to the borrower because the title company asked.
    const monthly = fundedBalances(evaluate(deal.app), deal.app, deal.disbursedDraws).nextPayment;
    await store.runAction(staff, { t: "recordPayment", dealId: "payoff-loan", amount: monthly, receivedOn: today, method: "wire", reference: "w1", by: "x" });
    const corrected = await store.runAction(staff, { t: "issuePayoffLetter", payoffId: request.id, goodThrough, reason: "Corrected: a payment arrived", by: "x" });
    if ("error" in corrected) throw new Error(corrected.error);
    const second = (await deliverPayoffLetter(request.id))!.payoffs.find((item) => item.id === request.id)!.letters![1];
    expect(second).toMatchObject({ number: 2, replaces: 1, delivery: { to: ["terry@sunshine-title.example.com", "pat.payoff@example.com"], result: "logged" } });
    expect(second.total).toBeLessThan(delivered.payoffs.find((item) => item.id === request.id)!.letters![0].total);
    // The link from the first email now opens the corrected letter.
    expect(await links.openPayoffLink(token)).toMatchObject({ sent: 1, letter: { number: 2 } });

    await prisma.payoffLink.updateMany({ where: { payoffId: request.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await links.openPayoffLink(token)).toBeNull();
    expect((await pdf.GET(new Request(`http://x/payoff-letter/${token}/pdf`), { params: Promise.resolve({ token }) })).status).toBe(404);
    expect(await prisma.auditEvent.count({ where: { action: "payoff.letter_sent", entityId: "payoff-loan" } })).toBe(2);
  });
});

describe("term sheets", () => {
  it("are kept encrypted with the loan, and the nightly job reminds the borrower and then expires one left open", async () => {
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/book-store");
    const { latestSheet, startingTerms } = await import("@/lib/term-sheets");
    const { addDays, servicingDate } = await import("@/lib/servicing");
    const pdf = await import("@/app/api/term-sheets/[dealId]/route");
    const borrower = await prisma.user.create({ data: { email: "terry.terms@example.com", name: "Terry Terms", passwordHash: "x", roles: { create: [{ role: "BORROWER" }] } } });
    const base = demoBook().deals.find((deal) => deal.id === "d1")!;
    const deal = { ...base, id: "terms-loan", loanNumber: "LH-4001", borrowerId: borrower.id, borrowerName: "Terry Terms", brokerId: undefined, creditReview: { by: "Uma", at: new Date().toISOString(), note: "", verifiedDeals: base.app.verifiedDeals } };
    await prisma.bookRecord.create({ data: { id: "deals:terms-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    const staff = { id: "staff-ts", name: "Uma Underwriter", roleCodes: ["ADMIN_OWNER" as const] };
    const sent = await store.runAction(staff, { t: "issueTermSheet", dealId: "terms-loan", ...startingTerms(deal), prepay: "min3", by: "x" });
    if ("error" in sent) throw new Error(sent.error);
    const sheet = latestSheet((await store.readBook()).book.deals.find((item) => item.id === "terms-loan")!)!;
    expect(sheet).toMatchObject({ version: 1, status: "sent", issuedBy: "Uma Underwriter", expiresOn: addDays(servicingDate(new Date()), 7), terms: { prepay: "3 months' minimum interest" } });
    expect(JSON.stringify(((await prisma.$runCommandRaw({ find: "BookRecord", filter: { _id: "deals:terms-loan" } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch)).not.toContain("minimum interest");

    const noon = (day: string) => new Date(`${day}T17:00:00Z`);
    expect((await lib.jobs.runJob("termSheets", noon(addDays(sheet.expiresOn, -2)))).summary).toMatch(/0 term sheets expired, 1 reminders/);
    expect(await prisma.notification.count({ where: { toEmail: "terry.terms@example.com", eventCode: "loan.term_sheet_expiring" } })).toBe(1);
    expect((await lib.jobs.runJob("termSheets", noon(sheet.expiresOn))).summary).toMatch(/no term sheets to remind about or expire/);
    expect((await lib.jobs.runJob("termSheets", noon(addDays(sheet.expiresOn, 1)))).summary).toMatch(/1 term sheets expired/);
    const after = (await store.readBook()).book.deals.find((item) => item.id === "terms-loan")!;
    expect(after.status).toBe("underwriting");
    expect(latestSheet(after)!.status).toBe("expired");
    expect(await prisma.notification.count({ where: { toEmail: "terry.terms@example.com", eventCode: "loan.term_sheet_expired" } })).toBe(1);

    const sample = await pdf.GET(new Request("http://x/api/term-sheets/demo"), { params: Promise.resolve({ dealId: "demo" }) });
    expect(sample.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await sample.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("conditions", () => {
  it("keep the library as its own encrypted records, and a loan starting conditions gets it", async () => {
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/book-store");
    const { DEFAULT_LIBRARY, templatesFor } = await import("@/lib/conditions");
    const owner = { id: "owner-c", name: "Olive Owner", roleCodes: ["ADMIN_OWNER" as const] };
    const saved = await store.runAction(owner, { t: "saveConditionTemplate", template: { title: "Flood zone certificate 8812", detail: "From the flood determination vendor.", category: "prior_to_docs", owner: "processor", needsUpload: false, products: [], dueDays: 5, active: true }, by: "x" });
    if ("error" in saved) throw new Error(saved.error);
    const library = (await store.readBook()).book.conditionLibrary;
    expect(library).toHaveLength(DEFAULT_LIBRARY.length + 1);
    expect(await prisma.bookRecord.count({ where: { kind: "conditionLibrary" } })).toBe(DEFAULT_LIBRARY.length + 1);
    expect(JSON.stringify(((await prisma.$runCommandRaw({ find: "BookRecord", filter: { kind: "conditionLibrary" } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch)).not.toContain("Flood zone certificate 8812");

    const base = demoBook().deals.find((deal) => deal.id === "d8")!;
    await prisma.bookRecord.create({ data: { id: "deals:conditions-loan", kind: "deals", data: JSON.parse(JSON.stringify({ ...base, id: "conditions-loan", loanNumber: "LH-5001" })) } });
    const started = await store.runAction(owner, { t: "advanceLoan", dealId: "conditions-loan" });
    if ("error" in started) throw new Error(started.error);
    const conditions = (await store.readBook()).book.deals.find((deal) => deal.id === "conditions-loan")!.conditions!;
    expect(conditions.map((item) => item.title)).toEqual([...templatesFor(DEFAULT_LIBRARY, base.app).map((item) => item.title), "Flood zone certificate 8812"]);
  });
});

describe("draw protections", () => {
  it("warn the borrower once, 30 days before the builder's risk policy ends, from the nightly job", async () => {
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/book-store");
    const { addDays, servicingDate } = await import("@/lib/servicing");
    const borrower = await prisma.user.create({ data: { email: "ida.insured@example.com", name: "Ida Insured", passwordHash: "x", roles: { create: [{ role: "BORROWER" }] } } });
    const base = demoBook().deals.find((deal) => deal.id === "d12")!;
    const night = new Date("2026-11-10T06:00:00Z");
    const today = servicingDate(night);
    // Saved before every loan had its own insurance file: the one policy sat in the lien file. The job moves it over.
    const deal = { ...base, id: "insured-loan", loanNumber: "LH-6001", borrowerId: borrower.id, insurance: undefined, lienFile: { ...base.lienFile!, insurance: { kind: "builders_risk" as const, carrier: "Legacy Mutual", policy: "LM-1", expiresOn: addDays(today, 12), by: "Pat Processor", at: "2026-06-01T12:00:00Z" } } };
    await prisma.bookRecord.create({ data: { id: "deals:insured-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    expect((await lib.jobs.runJob("insurance", night)).summary).toMatch(/insurance warnings/);
    expect(await prisma.notification.count({ where: { toEmail: "ida.insured@example.com", eventCode: "insurance.expiring" } })).toBe(1);
    const moved = (await store.readBook()).book.deals.find((item) => item.id === "insured-loan")!;
    expect(moved.insurance!.policies).toMatchObject([{ kind: "builders_risk", carrier: "Legacy Mutual", remindedOn: today }]);
    expect(moved.lienFile!.insurance).toBeUndefined();
    await lib.jobs.runJob("insurance", new Date("2026-11-11T06:00:00Z"));
    expect(await prisma.notification.count({ where: { toEmail: "ida.insured@example.com", eventCode: "insurance.expiring" } })).toBe(1);
  });
});

describe("decline notices (Reg B)", () => {
  it("start with the decline, kept encrypted with the loan, and the sample letter is a PDF", async () => {
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/book-store");
    const route = await import("@/app/api/adverse-action/[dealId]/route");
    const base = demoBook().deals.find((deal) => deal.id === "d5")!;
    await prisma.bookRecord.create({ data: { id: "deals:declined-loan", kind: "deals", data: JSON.parse(JSON.stringify({ ...base, id: "declined-loan", loanNumber: "LH-7001", pricingException: undefined })) } });
    const underwriter = { id: "uw-r", name: "Uma Underwriter", roleCodes: ["UNDERWRITER" as const] };
    const declined = await store.runAction(underwriter, { t: "closeApplication", dealId: "declined-loan", outcome: "declined", reason: "leverage", note: "", by: "x", byTeam: true, revenue: { amount: 640_000, year: 2025 } });
    if ("error" in declined) throw new Error(declined.error);
    const stored = (await store.readBook()).book.deals.find((deal) => deal.id === "declined-loan")!;
    expect(stored.adverseAction).toMatchObject({ large: false, reasons: ["Value of the collateral not sufficient for the loan amount requested"] });
    expect(stored.revenue).toMatchObject({ amount: 640_000, year: 2025, by: "Uma Underwriter" });
    expect(JSON.stringify(((await prisma.$runCommandRaw({ find: "BookRecord", filter: { _id: "deals:declined-loan" } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch)).not.toContain("collateral not sufficient");
    const sample = await route.GET(new Request("http://x/api/adverse-action/demo"), { params: Promise.resolve({ dealId: "demo" }) });
    expect(sample.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("property photos", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
  const photo = (name = "front.jpg") => new File([JPEG], name, { type: "image/jpeg" });
  const newLead = async (email: string) => {
    const { sealLead } = await import("@/lib/lead-store");
    const sealed = sealLead({ name: "Cody Contractor", email, phone: "(954) 555-0142", strategy: "Fix & flip", experience: "3–4 projects", city: "Miami", state: "FL", propertyValueCents: 30_000_000, renovationCents: 6_000_000, requestedLoanCents: 0, targetClosing: "2027-02-01", notes: "" });
    return prisma.lead.create({ data: sealed });
  };

  it("take the quote request's photos with its key, keep them encrypted, and move them to the loan when it starts", async () => {
    const route = await import("@/app/api/lead-photos/route");
    const photos = await import("@/lib/property-photos");
    const store = await import("@/lib/book-store");
    const { demoBook } = await import("@/lib/book");
    const lead = await newLead("cody.contractor@example.com");
    const key = await photos.issuePhotoKey(lead.id);
    const send = (file: File, withKey = key) => {
      const form = new FormData();
      form.set("key", withKey);
      form.set("file", file);
      return route.POST(new Request("http://x/api/lead-photos", { method: "POST", body: form }));
    };
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).photoKeyHash).not.toBe(key);

    const sent = await send(photo());
    expect(sent.status).toBe(200);
    const { photo: first } = await sent.json();
    const document = await prisma.document.findUniqueOrThrow({ where: { id: first.id } });
    expect(document).toMatchObject({ ownerType: "LEAD", ownerId: lead.id, documentType: "property_photo", uploadedById: null, mime: "image/jpeg" });
    expect(document.storageKey).toMatch(new RegExp(`^leads/${lead.id}/`));
    expect(document.originalName).not.toContain("front");
    expect((await send(photo(), "not-the-key")).status).toBe(403);
    expect((await send(new File(["<script>"], "evil.jpg", { type: "image/jpeg" }))).status).toBe(400);
    for (let count = 1; count < photos.MAX_PROPERTY_PHOTOS; count++) expect((await send(photo(`room-${count}.jpg`))).status).toBe(200);
    expect(await (await send(photo("one-too-many.jpg"))).json()).toMatchObject({ error: expect.stringMatching(/most photos/) });

    // Starting the loan from the lead moves the photos and lists them on the loan, where the borrower can see them.
    const deal = { ...demoBook().deals.find((item) => item.id === "d1")!, id: "photo-loan", loanNumber: "LH-4001", propertyPhotos: undefined };
    await prisma.bookRecord.create({ data: { id: "deals:photo-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    const moved = await photos.moveLeadPhotos(lead.id, "photo-loan");
    expect(moved).toHaveLength(photos.MAX_PROPERTY_PHOTOS);
    expect(await prisma.document.count({ where: { ownerType: "LEAD", ownerId: lead.id } })).toBe(0);
    const staff = { id: "staff-photos", name: "Sam Staff", roleCodes: ["ADMIN_OWNER" as const] };
    expect(await store.runAction(staff, { t: "addPropertyPhotos", dealId: "photo-loan", photos: moved, by: "Quote request" })).toHaveProperty("error");
    const listed = await store.runAction(staff, { t: "addPropertyPhotos", dealId: "photo-loan", photos: moved, by: "Quote request" }, { trusted: true });
    if ("error" in listed) throw new Error(listed.error);
    expect(listed.after.deals.find((item) => item.id === "photo-loan")!.propertyPhotos).toHaveLength(photos.MAX_PROPERTY_PHOTOS);
    expect(JSON.stringify(((await prisma.$runCommandRaw({ find: "BookRecord", filter: { _id: "deals:photo-loan" } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch)).not.toContain("room-1.jpg");

    // The key stops working after a couple of hours.
    const late = await newLead("late.sender@example.com");
    const lateKey = await photos.issuePhotoKey(late.id);
    await prisma.lead.update({ where: { id: late.id }, data: { photoKeyExpiresAt: new Date(Date.now() - 1000) } });
    expect((await send(photo(), lateKey)).status).toBe(403);
  });

  it("let the borrower add, see and take back photos on their application link, and only their own", async () => {
    const { createApplicationLink } = await import("@/lib/application-links");
    const { draftFromQuote } = await import("@/lib/borrower-application");
    const store = await import("@/lib/book-store");
    const { demoBook } = await import("@/lib/book");
    const upload = await import("@/app/api/application-links/[token]/photos/route");
    const one = await import("@/app/api/application-links/[token]/photos/[photoId]/route");
    const officer = await prisma.user.create({ data: { email: "pia.officer@lendhous.com", name: "Pia Officer", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    const quote = { submitter: "borrower" as const, borrower: { firstName: "Cody", lastName: "Contractor", email: "cody.link@example.com", phone: "(954) 555-0142" }, citizenship: "us" as const, creditBand: "720-759" as const, experience: "3-4" as const, address: { street: "10 Palm Way", city: "Miami", state: "FL", zip: "33101", county: "Miami-Dade" }, propertyType: "sfr" as const, loanType: "fix_flip" as const, purpose: "purchase" as const, purchasePrice: 300_000, rehab: 60_000, arv: 450_000, fundingDate: "2027-02-01", comps: [], exit: "sell" as const, notes: "" };
    const link = async (target: { leadId?: string; dealId?: string }) => (await createApplicationLink({ ...target, recipient: { name: "Cody Contractor", email: quote.borrower.email }, officer: officer.name, sentById: officer.id, draft: draftFromQuote(quote) })).url.split("/apply/")[1];
    const post = (token: string, file = photo()) => {
      const form = new FormData();
      form.set("file", file);
      return upload.POST(new Request(`http://x/api/application-links/${token}/photos`, { method: "POST", body: form }), { params: Promise.resolve({ token }) });
    };
    const context = (token: string, photoId: string) => ({ params: Promise.resolve({ token, photoId }) });

    const lead = await newLead("cody.link@example.com");
    const mine = await link({ leadId: lead.id });
    const other = await link({ leadId: (await newLead("someone.else@example.com")).id });
    const { photo: sent } = await (await post(mine)).json();
    expect(await prisma.document.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ ownerType: "LEAD", ownerId: lead.id, uploadedById: null });
    const shown = await one.GET(new Request("http://x"), context(mine, sent.id));
    expect(shown.status).toBe(200);
    expect(Buffer.from(await shown.arrayBuffer()).equals(JPEG)).toBe(true);
    expect(shown.headers.get("Content-Disposition")).toContain("inline");
    expect((await one.GET(new Request("http://x"), context(other, sent.id))).status).toBe(404);
    expect((await one.DELETE(new Request("http://x"), context(other, sent.id))).status).toBe(404);
    expect((await one.DELETE(new Request("http://x"), context(mine, sent.id))).status).toBe(200);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: sent.id } })).deletedAt).toBeTruthy();
    expect((await one.GET(new Request("http://x"), context(mine, sent.id))).status).toBe(404);

    // On a loan's link the photo goes on the loan right away, and taking it back takes it off.
    const deal = { ...demoBook().deals.find((item) => item.id === "d1")!, id: "link-photo-loan", loanNumber: "LH-4002", propertyPhotos: undefined };
    await prisma.bookRecord.create({ data: { id: "deals:link-photo-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    const loanLink = await link({ dealId: "link-photo-loan" });
    const { photo: onLoan } = await (await post(loanLink)).json();
    const listed = async () => (await store.readBook()).book.deals.find((item) => item.id === "link-photo-loan")!.propertyPhotos ?? [];
    expect(await listed()).toMatchObject([{ id: onLoan.id, by: "Borrower's application" }]);
    // A photo the team added can't be taken away through the link.
    const { storePropertyPhoto } = await import("@/lib/property-photos");
    const team = await storePropertyPhoto({ type: "LOAN", id: "link-photo-loan" }, photo("team.jpg"), officer.id);
    if ("error" in team) throw new Error(team.error);
    expect((await one.DELETE(new Request("http://x"), context(loanLink, team.id))).status).toBe(404);
    expect((await one.DELETE(new Request("http://x"), context(loanLink, onLoan.id))).status).toBe(200);
    expect(await listed()).toEqual([]);

    await prisma.applicationLink.updateMany({ where: { dealId: "link-photo-loan" }, data: { status: "off" } });
    expect((await post(loanLink)).status).toBe(404);
  });
});

describe("signing up", () => {
  let members: typeof import("@/lib/members");
  let mail: ReturnType<typeof vi.spyOn>;
  const lastLink = () => {
    const found = String(mail.mock.calls.at(-1)?.[0] ?? "").match(/https:\/\/\S+set-password\?token=\S+/);
    return found ? new URL(found[0]).searchParams.get("token")! : "";
  };
  const lastSubject = () => String(mail.mock.calls.at(-1)?.[0] ?? "").match(/subject=([^\n]+)/)?.[1] ?? "";

  beforeAll(async () => {
    process.env.AUTH_SECRET = "x".repeat(40);
    process.env.NEXT_PUBLIC_APP_URL = "https://portal.example.com";
    members = await import("@/lib/members");
  });
  beforeEach(() => {
    mail = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a borrower account that can't sign in until the emailed link is used, then tells the team", async () => {
    expect(members.signupProblem({ name: "", email: "a@example.com", phone: "" })).toMatch(/your name/);
    expect(members.signupProblem({ name: "Cara", email: "nope", phone: "" })).toMatch(/valid email/);
    expect(members.signupProblem({ name: "Cara", email: "cara@lendhous.test", phone: "" })).toMatch(/demo accounts/);
    expect(members.signupProblem({ name: "Cara Contractor", email: "cara@example.com", phone: "" })).toBeNull();

    await members.startSignup({ name: "Cara Contractor", email: "cara@example.com", phone: "(305) 555-0199" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "cara@example.com" }, include: { roles: true } });
    expect(user).toMatchObject({ name: "Cara Contractor", phone: "(305) 555-0199", accountStatus: "PENDING", organizationId: null });
    expect(user.signedUpAt).toBeTruthy();
    expect(user.roles.map((row) => row.role)).toEqual(["BORROWER"]);
    expect(lastSubject()).toMatch(/Confirm your email/);
    const first = lastLink();
    expect(first).toBeTruthy();
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "auth.signup_requested" } })).toBe(1);

    // Asking again sends a fresh link, and only the newest one works.
    await members.startSignup({ name: "Cara Contractor", email: "cara@example.com", phone: "" });
    const second = lastLink();
    expect(second).not.toBe(first);
    expect(await members.peekPasswordLink(first)).toBeNull();

    expect(await members.usePasswordLink(second, "a-long-enough-password")).toEqual({ userId: user.id, signedUp: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ accountStatus: "APPROVED" });
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "auth.signup_confirmed" } })).toBe(1);

    await prisma.user.create({ data: { email: "gt.owner@lendhous.com", name: "GT Owner", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    await members.announceSignup(user.id);
    expect(await prisma.notification.count({ where: { toEmail: "gt.owner@lendhous.com", eventCode: "auth.signup" } })).toBe(1);
  });

  it("never changes an account that already exists: its owner gets a password link instead", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const staff = await prisma.user.create({ data: { email: "uri.underwriter@example.com", name: "Uri Underwriter", passwordHash: await bcrypt.hash("the-real-password", 4), accountStatus: "APPROVED", roles: { create: [{ role: "UNDERWRITER" }] } } });
    await members.startSignup({ name: "Mallory", email: "uri.underwriter@example.com", phone: "" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staff.id }, include: { roles: true } });
    expect(after).toMatchObject({ name: "Uri Underwriter", accountStatus: "APPROVED", signedUpAt: null });
    expect(after.roles.map((row) => row.role)).toEqual(["UNDERWRITER"]);
    expect(await bcrypt.compare("the-real-password", after.passwordHash)).toBe(true);
    expect(lastSubject()).toMatch(/Set a new LendHous password/);
    // Using that link is an ordinary reset, not a sign-up.
    expect(await members.usePasswordLink(lastLink(), "another-long-password")).toEqual({ userId: staff.id, signedUp: false });

    // An account waiting on someone's approval stays that way and gets nothing.
    const waiting = await prisma.user.create({ data: { email: "waiting@example.com", name: "Waiting", passwordHash: "x", accountStatus: "PENDING", roles: { create: [{ role: "BROKER" }] } } });
    const links = await prisma.passwordLink.count();
    await members.startSignup({ name: "Waiting", email: "waiting@example.com", phone: "" });
    expect(await prisma.passwordLink.count()).toBe(links);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ accountStatus: "PENDING", signedUpAt: null });
  });

  it("brings back a removed account as a new borrower, with nothing it used to have", async () => {
    const old = await prisma.user.create({ data: { email: "back.again@example.com", name: "Old Name", title: "Processor", passwordHash: "x", accountStatus: "APPROVED", deletedAt: new Date(), extraPermissions: ["view_audit"], roles: { create: [{ role: "PROCESSOR" }] } } });
    await members.startSignup({ name: "Back Again", email: "back.again@example.com", phone: "" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: old.id }, include: { roles: true } });
    expect(user).toMatchObject({ name: "Back Again", title: null, accountStatus: "PENDING", deletedAt: null, extraPermissions: [] });
    expect(user.roles.map((row) => row.role)).toEqual(["BORROWER"]);
  });
});

describe("the owners' morning email", () => {
  it("goes to each owner once a day, with the day's numbers and no borrower names", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { demoBook } = await import("@/lib/book");
    const base = demoBook().deals.find((deal) => deal.id === "d1")!;
    const deal = { ...base, id: "digest-loan", loanNumber: "LH-5001", borrowerName: "Dana Digest", status: "underwriting", stages: [{ status: "submitted", at: "2026-11-02T15:00:00.000Z" }, { status: "underwriting", at: "2026-11-02T16:00:00.000Z" }] };
    await prisma.bookRecord.create({ data: { id: "deals:digest-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    const owner = await prisma.user.create({ data: { email: "olga.owner@lendhous.com", name: "Olga Owner", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    process.env.NEXT_PUBLIC_APP_URL = "https://portal.example.com";
    const now = new Date("2026-11-03T11:00:00Z");
    const first = await lib.jobs.runJob("digest", now);
    expect(first).toMatchObject({ skipped: false });
    expect(first.summary).toMatch(/^LendHous today: 1 new application, 0 funded, \d+ waiting$/);
    const sent = await prisma.notification.findMany({ where: { eventCode: "digest.daily", toEmail: owner.email } });
    expect(sent).toHaveLength(1);
    const { recentNotices } = await import("@/lib/notifications");
    const [notice] = (await recentNotices(owner)).filter((item) => item.subject.startsWith("LendHous today"));
    expect(notice.body).toMatch(/^Yesterday \(Mon, Nov 2\): 1 new application \(\$/);
    expect(notice.body).toContain("https://portal.example.com/admin/reports");
    expect(notice.body).not.toContain("Dana Digest");
    expect((await lib.jobs.runJob("digest", now)).skipped).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("a borrower's application in the portal", () => {
  it("starts on the first save, picks up where it was, lapses after 90 days unsaved, and is kept with the loan once signed", async () => {
    const links = await import("@/lib/application-links");
    const { blankGuarantor, draftForAccount } = await import("@/lib/borrower-application");
    const user = await prisma.user.create({ data: { email: "pam.portal@example.com", name: "Pam Portal", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "BORROWER" }] } } });
    const other = await prisma.user.create({ data: { email: "oli.other@example.com", name: "Oli Other", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "BORROWER" }] } } });
    expect(await links.openPortalDraft(user.id)).toBeNull();
    const draft = draftForAccount(user);
    draft.guarantors = [{ ...blankGuarantor(), firstName: "Pam", lastName: "Portal", ssn: "111223333", dob: "1975-01-02" }];
    const now = new Date("2026-11-04T15:00:00Z");
    const id = await links.savePortalDraft(user, draft, 1, now);
    expect(await links.savePortalDraft(user, { ...draft, loanType: "bridge" }, 2, new Date(now.getTime() + 60_000))).toBe(id);
    const open = await links.openPortalDraft(user.id, now);
    expect(open).toMatchObject({ row: { id, step: 2, userId: user.id, leadId: null, dealId: null }, draft: { loanType: "bridge", contact: { email: "pam.portal@example.com" } } });
    expect(await links.openPortalDraft(other.id, now)).toBeNull();
    const raw = JSON.stringify(((await prisma.$runCommandRaw({ find: "ApplicationLink", filter: { _id: id } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(raw).not.toMatch(/111223333|1975-01-02|pam\.portal/);
    // Nobody can open it as a link: its token was never kept or shown.
    expect(await prisma.applicationLink.count({ where: { userId: user.id } })).toBe(1);
    expect(await links.openPortalDraft(user.id, new Date(now.getTime() + 91 * 86_400_000))).toBeNull();
    await links.markSigned(id, draft, { name: "Pam Portal", at: now.toISOString(), ip: "1.2.3.4", userAgent: "", consents: { application: true, credit: true, release: true, esign: true }, version: "v", digest: links.digestOf(draft) }, "portal-loan", now);
    expect(await links.openPortalDraft(user.id, now)).toBeNull();
    const signed = await links.signedApplication("portal-loan");
    expect(signed).toMatchObject({ id, signature: { name: "Pam Portal", ip: "1.2.3.4" }, officer: "Borrower's portal" });
    expect(signed?.draft.guarantors[0].ssn).toBe("111223333");
    // The next application starts fresh, and a repeat borrower's can start from the last one signed, SSNs left out.
    expect(await links.savePortalDraft(user, draftForAccount(user), 0, now)).not.toBe(id);
    const { repeatDraft } = await import("@/lib/borrower-application");
    const last = await links.lastSignedDraft(["portal-loan", "someone-elses-loan"]);
    expect(last).toMatchObject({ dealId: "portal-loan", draft: { guarantors: [{ firstName: "Pam", ssn: "111223333" }] } });
    expect(repeatDraft(last!.draft).guarantors[0]).toMatchObject({ firstName: "Pam", ssn: "", dob: "" });
    expect(await links.lastSignedDraft(["someone-elses-loan"])).toBeNull();
    expect(await links.lastSignedDraft([])).toBeNull();
  });
});

describe("who works each loan, on the server", () => {
  it("offers only active staff who can see the pipeline, and a borrower's message reaches the loan's own officer", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { teamCandidates, memberById } = await import("@/lib/loan-team-store");
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/book-store");
    const { sendAlerts } = await import("@/lib/book-alerts");
    const make = (email: string, name: string, role: import("@prisma/client").RoleCode, extra: Record<string, unknown> = {}) => prisma.user.create({ data: { email, name, passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role }] }, ...extra } });
    const pete = await make("pete.processor@example.com", "Pete Processor", "PROCESSOR", { phone: "(305) 555-0144", title: "Processor" });
    await make("dora.draws@example.com", "Dora Draws", "DRAW_ADMIN");
    await make("gone.underwriter@example.com", "Gone Underwriter", "UNDERWRITER", { deletedAt: new Date() });
    await make("pending.underwriter@example.com", "Pending Underwriter", "UNDERWRITER", { accountStatus: "PENDING" });
    const bo = await make("bo.borrower@example.com", "Bo Borrower", "BORROWER");
    const emails = (await teamCandidates()).map((member) => member.email);
    expect(emails).toContain("pete.processor@example.com");
    for (const email of ["dora.draws@example.com", "gone.underwriter@example.com", "pending.underwriter@example.com", "bo.borrower@example.com"]) expect(emails).not.toContain(email);
    const member = await memberById(pete.id);
    expect(member).toEqual({ id: pete.id, name: "Pete Processor", email: "pete.processor@example.com", phone: "(305) 555-0144", title: "Processor" });

    const base = demoBook().deals.find((deal) => deal.id === "d1")!;
    const deal = { ...base, id: "team-loan", loanNumber: "LH-6001", borrowerId: bo.id, borrowerName: "Bo Borrower", team: { officer: member! } };
    await prisma.bookRecord.create({ data: { id: "deals:team-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) } });
    const result = await store.runAction({ id: bo.id, name: "Bo Borrower", roleCodes: ["BORROWER"] }, { t: "sendMessage", dealId: "team-loan", from: "Bo Borrower", side: "borrower", text: "Is the appraisal booked?" });
    if ("error" in result) throw new Error(result.error);
    await sendAlerts(result.before, result.after, result.action);
    expect(await prisma.notification.count({ where: { toEmail: "pete.processor@example.com", eventCode: "message.client" } })).toBe(1);
    vi.restoreAllMocks();
  });
});

describe("reliability", () => {
  it("groups the same error, keeps no personal data, and reopens one marked fixed when it happens again", async () => {
    const { recordError, recentErrors } = await import("@/lib/errors");
    const boom = () => { const error = new Error("Can't find loan for pat.payoff@example.com (954) 555-0100"); error.stack = "Error: x\n    at readBook (lib/book-store.ts:25:3)"; return error; };
    await recordError(boom(), "/admin/deals/[id]", "render");
    await recordError(boom(), "/admin/deals/[id]", "render");
    await recordError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }), "/admin", "render");
    const rows = await prisma.errorEvent.findMany({ where: { route: "/admin/deals/[id]" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, kind: "render" });
    expect(rows[0].message).not.toMatch(/pat\.payoff|555-0100/);
    expect(await prisma.errorEvent.count({ where: { route: "/admin" } })).toBe(0);
    await prisma.errorEvent.update({ where: { id: rows[0].id }, data: { resolvedAt: new Date() } });
    const before = await recentErrors(new Date(Date.now() - 60_000));
    await recordError(boom(), "/admin/deals/[id]", "render");
    expect(await prisma.errorEvent.findUniqueOrThrow({ where: { id: rows[0].id } })).toMatchObject({ count: 3, resolvedAt: null });
    expect(await recentErrors(new Date(Date.now() - 60_000))).toBe(before + 1);
  });

  it("the health check stays 200 for a live database, and with ?watch=jobs says 503 until the servicing and sanctions jobs have run", async () => {
    const { GET } = await import("@/app/api/health/route");
    const watch = () => GET(new Request("http://x/api/health?watch=jobs"));
    await prisma.jobRun.deleteMany({ where: { job: { in: ["servicing", "sanctions"] } } });
    const plain = await GET(new Request("http://x/api/health"));
    expect(plain.status).toBe(200);
    expect(await plain.json()).toMatchObject({ ok: true, db: "ok", staleJobs: ["servicing", "sanctions"] });
    const stale = await watch();
    expect(stale.status).toBe(503);
    const now = new Date();
    await prisma.jobRun.createMany({ data: [{ job: "servicing", runKey: "health-test-servicing", ok: true, finishedAt: now }, { job: "sanctions", runKey: "health-test-sanctions", ok: true, finishedAt: now }] });
    const healthy = await watch();
    expect(healthy.status).toBe(200);
    const body = await healthy.json();
    expect(body).toMatchObject({ ok: true, db: "ok", staleJobs: [], servicingCheckedAt: now.toISOString(), staleAfterHours: 48 });
    expect(JSON.stringify(body)).not.toMatch(/secret|password|mongodb|@/i);
  });

  it("the restore check opens a copy's records, and says which won't open", async () => {
    const { checkRestore } = await import("@/lib/restore-check");
    const { encryptField, parseFieldKeys } = await import("@/lib/crypto");
    await prisma.user.create({ data: { email: "rhea.restore@example.com", name: "Rhea Restore", passwordHash: "x" } });
    const healthy = await checkRestore(prisma);
    expect(healthy.problems).toEqual([]);
    expect(healthy.counts.accounts).toBeGreaterThan(0);
    // A name sealed with a key this server doesn't have, as a copy restored with the wrong keys would look.
    const otherKey = parseFieldKeys(`other:${Buffer.alloc(32, 7).toString("base64")}`);
    await prisma.document.create({ data: { id: "restore-bad-doc", ownerType: "LOAN", ownerId: "x", documentType: "bank", originalName: encryptField("statement.pdf", "Document.originalName:restore-bad-doc", otherKey), storageKey: "x", mime: "application/pdf", size: 1, sha256: "x" } });
    const broken = await checkRestore(prisma);
    expect(broken.problems).toEqual([expect.stringMatching(/document names wouldn't open with these keys/)]);
    await prisma.document.delete({ where: { id: "restore-bad-doc" } });
  });
});

describe("investor statements", () => {
  it("are made once a month for each partner that held a loan, kept sealed, emailed to its people, and open as a PDF", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { demoBook } = await import("@/lib/book");
    const { makeStatements, openStatement, statementsOf } = await import("@/lib/statement-store");
    const { statementPdf } = await import("@/lib/statement-pdf");
    const firm = await prisma.organization.create({ data: { name: "Statement Capital", type: "PARTNER_LENDER" } });
    await prisma.user.create({ data: { email: "sam.statement@example.com", name: "Sam Statement", passwordHash: "x", accountStatus: "APPROVED", organizationId: firm.id, roles: { create: [{ role: "PARTNER_LENDER" }] } } });
    const demo = demoBook();
    const d11 = demo.deals.find((deal) => deal.id === "d11")!;
    const deal = { ...d11, id: "stmt-loan", loanNumber: "LH-7001", teaserSentTo: [firm.id], partnerFunding: { ...d11.partnerFunding!, partnerId: firm.id } };
    const bid = { id: "stmt-bid", dealId: "stmt-loan", partnerId: firm.id, pct: 50, lenderRate: 9.25, lenderPoints: 0.5, conditions: "", status: "accepted", type: "bid", at: "2026-06-20T14:00:00Z" };
    await prisma.bookRecord.createMany({ data: [
      { id: "deals:stmt-loan", kind: "deals", data: JSON.parse(JSON.stringify(deal)) },
      { id: "bids:stmt-bid", kind: "bids", data: bid },
      { id: `partners:${firm.id}`, kind: "partners", data: { id: firm.id, name: "Statement Capital", ndaSigned: true, buyBox: demo.partners[0].buyBox } },
    ] });
    expect(await makeStatements("2026-10")).toBeGreaterThanOrEqual(1);
    expect(await makeStatements("2026-10")).toBe(0);
    const [row] = await statementsOf({ type: "partner", id: firm.id });
    expect(row).toMatchObject({ month: "2026-10", loans: 1, balance: 232_500 });
    expect(row.net).toBeCloseTo((232_500 * 0.0925) / 12, 1);
    const raw = JSON.stringify(((await prisma.$runCommandRaw({ find: "InvestorStatement", filter: { _id: row.id } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(raw).not.toContain("LH-7001");
    expect(await prisma.notification.count({ where: { toEmail: "sam.statement@example.com", eventCode: "statement.ready" } })).toBe(1);
    const opened = (await openStatement(row.id))!;
    expect(opened.statement.lines[0]).toMatchObject({ loanNumber: "LH-7001", share: 0.5 });
    expect((await statementPdf(opened.statement, "LendHous")).subarray(0, 5).toString()).toBe("%PDF-");
    vi.restoreAllMocks();
  });
});

describe("pre-approval letters", () => {
  it("are numbered by kind and year, sealed, found by their verify code only, withdrawn, and print with a QR code", async () => {
    const { issueLetter, letterByCode, openLetter, revokeLetter, verifyUrl } = await import("@/lib/letter-store");
    const { letterPdf } = await import("@/lib/letter-pdf");
    const { DEFAULT_CONDITIONS } = await import("@/lib/letters");
    const details = { kind: "pre_approval" as const, name: "Lola Letter", email: "lola@example.com", entityName: "Lola Flips LLC", product: "fix_flip" as const, maxPurchasePrice: 400_000, maxLoan: 340_000, propertyAddress: "", conditions: DEFAULT_CONDITIONS, validDays: 30 };
    const now = new Date("2026-11-04T15:00:00Z");
    const first = await issueLetter(details, { id: "u-uma", name: "Uma Underwriter" }, null, now);
    const second = await issueLetter({ ...details, kind: "proof_of_funds" }, { id: "u-uma", name: "Uma Underwriter" }, null, now);
    const third = await issueLetter(details, { id: "u-uma", name: "Uma Underwriter" }, null, now);
    expect([first.number, second.number, third.number]).toEqual(["PA-2026-0001", "PF-2026-0001", "PA-2026-0002"]);
    expect(first.expiresOn).toBe("2026-12-04");
    const raw = JSON.stringify(((await prisma.$runCommandRaw({ find: "ApprovalLetter", filter: { _id: first.id } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(raw).not.toMatch(/Lola|340000|lola@example/);
    expect(raw).not.toContain(first.code);
    expect((await letterByCode(first.code))?.row.number).toBe("PA-2026-0001");
    expect(await letterByCode("PA-2026-0001")).toBeNull();
    expect(await letterByCode("not-a-code")).toBeNull();
    expect((await letterByCode(first.code))?.state).toBe("valid");
    expect(await revokeLetter(first.id, "u-owner")).toBe(true);
    expect(await revokeLetter(first.id, "u-owner")).toBe(false);
    expect((await letterByCode(first.code))?.state).toBe("revoked");
    const letter = (await openLetter(second.id))!;
    const pdf = await letterPdf({ number: letter.row.number, issuedOn: "2026-11-04", expiresOn: letter.row.expiresOn, details: letter.details, issuedBy: letter.details.issuedBy, verifyUrl: verifyUrl(letter.details.code), lender: "LendHous", phone: "(954) 555-0100" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3000);
  });
});

describe("tax forms on file", () => {
  it("keep the W-9 sealed, count the newest one, and drop a W-8 once it expires", async () => {
    const { allTaxForms, currentTaxForm, saveTaxForm } = await import("@/lib/tax-form-store");
    const payee = { type: "partner" as const, id: "tax-firm" };
    const w9 = { legalName: "Tess Taxpayer", businessName: "", classification: "individual" as const, tinType: "ssn" as const, tin: "987654321", exemptPayeeCode: "", address: { street: "1 Main St", city: "Miami", state: "FL", zip: "33130" } };
    expect(await currentTaxForm(payee)).toBeNull();
    const id = await saveTaxForm(payee, { kind: "w9", data: w9 }, "Tess Taxpayer", "1.2.3.4", new Date("2026-03-01T12:00:00Z"));
    const raw = JSON.stringify(((await prisma.$runCommandRaw({ find: "TaxForm", filter: { _id: id } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(raw).not.toMatch(/987654321|Tess/);
    expect(await currentTaxForm(payee)).toMatchObject({ kind: "w9", form: { tin: "987654321" } });
    await saveTaxForm(payee, { kind: "w9", data: { ...w9, legalName: "Tess T. Taxpayer" } }, "Tess", "1.2.3.4", new Date("2026-06-01T12:00:00Z"));
    expect(await currentTaxForm(payee)).toMatchObject({ form: { legalName: "Tess T. Taxpayer" } });
    const foreign = { type: "buyer" as const, id: "tax-foreign" };
    await saveTaxForm(foreign, { kind: "w8", data: { name: "Maple Fund", entity: true, country: "Canada", foreignTin: "", address: "1 Bay St, Toronto" } }, "Mo", "1.2.3.4", new Date("2026-01-05T12:00:00Z"));
    expect(await currentTaxForm(foreign, "2029-12-31")).toMatchObject({ kind: "w8", expiresOn: "2029-12-31" });
    expect(await currentTaxForm(foreign, "2030-01-01")).toBeNull();
    const all = await allTaxForms("2026-11-04");
    expect(all.get("partner:tax-firm")).toMatchObject({ form: { legalName: "Tess T. Taxpayer" } });
    expect(all.has("buyer:tax-foreign")).toBe(true);
  });
});

describe("the instant quote", () => {
  it("counts started and shown anonymously, keeps each saved quote's channel, and finds a new borrower's quote by email", async () => {
    const { countQuoteStep, funnelData } = await import("@/lib/quote-funnel-store");
    const { recentQuoteFor, sealLead, sealQuote } = await import("@/lib/lead-store");
    const now = new Date("2026-11-05T15:00:00Z");
    await countQuoteStep("started", "embed:wholesale", "", now);
    await countQuoteStep("started", "embed:wholesale", "", now);
    await countQuoteStep("shown", "embed:wholesale", "", now);
    await countQuoteStep("started", "site", "demobrkr", now);
    const rows = await prisma.quoteCount.findMany({ orderBy: { channel: "asc" } });
    expect(rows.map(({ day, channel, ref, started, shown }) => ({ day, channel, ref, started, shown }))).toEqual([
      { day: "2026-11-05", channel: "embed:wholesale", ref: "", started: 2, shown: 1 },
      { day: "2026-11-05", channel: "site", ref: "demobrkr", started: 1, shown: 0 },
    ]);
    // Only the counts: no address, name or deal is anywhere in them.
    expect(JSON.stringify(rows)).not.toMatch(/@|street|\$/i);
    const quote = { submitter: "borrower", borrower: { firstName: "Quinn", lastName: "Quote", email: "Quinn.Quote@Example.com", phone: "(954) 555-0101" }, citizenship: "us", creditBand: "720-759", experience: "1-2", address: { street: "9 Quote Court", city: "Davie", state: "FL", zip: "33314", county: "Broward" }, propertyType: "sfr", loanType: "fix_flip", purpose: "purchase", purchasePrice: 250_000, rehab: 50_000, arv: 400_000, fundingDate: "2026-12-01", comps: [], exit: "sell", notes: "" } as const;
    const sealed = sealLead({ name: "Quinn Quote", email: "quinn.quote@example.com", phone: "", strategy: "Fix & flip", experience: "", city: "Davie", state: "FL", propertyValueCents: 25_000_000, renovationCents: 5_000_000, requestedLoanCents: 0, targetClosing: "", notes: "" });
    await prisma.lead.create({ data: { ...sealed, channel: "embed:wholesale", quote: sealQuote(quote as never, sealed.id) } });
    const data = await funnelData("2026-11-01", "2026-11-30");
    expect(data.counts).toHaveLength(2);
    // The lead was saved just now, so it only falls in this month's range when the test runs in it.
    const { servicingDate } = await import("@/lib/servicing");
    const today = servicingDate(new Date());
    expect((await funnelData(today, today)).leads).toContainEqual({ day: today, channel: "embed:wholesale", brokerId: null, loanId: null });
    expect(data.leads.every((lead) => lead.day >= "2026-11-01" && lead.day <= "2026-11-30")).toBe(true);
    expect((await recentQuoteFor("quinn.quote@example.com"))?.address.street).toBe("9 Quote Court");
    expect(await recentQuoteFor("someone.else@example.com")).toBeNull();
    expect(await recentQuoteFor("quinn.quote@example.com", new Date(Date.now() + 31 * 86_400_000))).toBeNull();
  });
});

describe("borrower statements", () => {
  it("are made once a month for each funded loan, kept sealed, emailed to the borrower, and open as a PDF", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { demoBook } = await import("@/lib/book");
    const store = await import("@/lib/borrower-statement-store");
    const { borrowerStatementPdf } = await import("@/lib/borrower-statement-pdf");
    const borrower = await prisma.user.create({ data: { email: "bo.statement@example.com", name: "Bo Statement", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "BORROWER" }] } } });
    const d2 = demoBook().deals.find((deal) => deal.id === "d2")!;
    await prisma.bookRecord.create({ data: { id: "deals:bstmt-loan", kind: "deals", data: JSON.parse(JSON.stringify({ ...d2, id: "bstmt-loan", loanNumber: "LH-7101", borrowerId: borrower.id })) } });
    expect(await store.makeBorrowerStatements("2026-10")).toBeGreaterThanOrEqual(1);
    expect(await store.makeBorrowerStatements("2026-10")).toBe(0);
    const [row] = await store.statementsForLoan("bstmt-loan");
    expect(row).toMatchObject({ month: "2026-10", paidOff: null });
    const raw = JSON.stringify(((await prisma.$runCommandRaw({ find: "BorrowerStatement", filter: { _id: row.id } })) as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch);
    expect(raw).not.toContain("LH-7101");
    expect(await prisma.notification.count({ where: { toEmail: "bo.statement@example.com", eventCode: "statement.ready" } })).toBe(1);
    const opened = (await store.openBorrowerStatement(row.id))!;
    expect(opened.row.borrowerId).toBe(borrower.id);
    expect(opened.statement.loanNumber).toBe("LH-7101");
    expect((await borrowerStatementPdf(opened.statement, "LendHous", "")).subarray(0, 5).toString()).toBe("%PDF-");
    vi.restoreAllMocks();
  });
});

describe("storm watch and flood maps", () => {
  it("records which funded loans a cone covers, emails the owners, and asks for photos once it passes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { readFileSync } = await import("node:fs");
    const { demoBook } = await import("@/lib/book");
    const { readBook } = await import("@/lib/book-store");
    const { checkStorms } = await import("@/lib/storm-watch");
    await prisma.user.create({ data: { email: "stella.storm@example.com", name: "Stella Storm", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    const borrower = await prisma.user.create({ data: { email: "wade.wind@example.com", name: "Wade Wind", passwordHash: "x", accountStatus: "APPROVED", roles: { create: [{ role: "BORROWER" }] } } });
    const d2 = demoBook().deals.find((deal) => deal.id === "d2")!;
    // A funded flip in Fort Lauderdale, on the map, and one in Delray Beach, north of the cone.
    await prisma.bookRecord.create({ data: { id: "deals:storm-in", kind: "deals", data: JSON.parse(JSON.stringify({ ...d2, id: "storm-in", loanNumber: "LH-8801", borrowerId: borrower.id, borrowerName: "Wade Wind" })) } });
    await prisma.bookRecord.create({ data: { id: "deals:storm-out", kind: "deals", data: JSON.parse(JSON.stringify({ ...d2, id: "storm-out", loanNumber: "LH-8802", geo: { lat: 26.4615, lng: -80.0728, at: "2026-09-01T00:00:00Z" } })) } });
    const storms = readFileSync("tests/fixtures/nhc/TEST_ATLANTIC_STORM.json");
    const kmz = readFileSync("tests/fixtures/nhc/TEST_SOUTH_FLORIDA_CONE.kmz");
    let active = true;
    const fetcher = (async (url: string) => (url.endsWith("CurrentStorms.json") ? new Response(active ? storms : JSON.stringify({ activeStorms: [] })) : url.endsWith("_CONE.kmz") ? new Response(kmz) : new Response("", { status: 404 }))) as unknown as typeof fetch;

    expect(await checkStorms(new Date("2026-09-10T18:00:00Z"), fetcher)).toMatchObject({ summary: expect.stringMatching(/^1 active Atlantic storm, Hurricane Testcase covering \d+ loans?$/) });
    const watch = (await readBook()).book.storms.find((storm) => storm.id === "al992026")!;
    expect(watch).toMatchObject({ status: "active", advisory: "012" });
    expect(watch.nowIn).toContain("storm-in");
    expect(watch.nowIn).not.toContain("storm-out");
    expect(await prisma.bookRecord.count({ where: { id: "storms:al992026" } })).toBe(1);
    expect(await prisma.notification.count({ where: { toEmail: "stella.storm@example.com", eventCode: "storm.watch" } })).toBe(1);
    // A cone that won't download keeps what the last one covered, and NHC not answering at all changes nothing.
    const broken = (async (url: string) => (url.endsWith("CurrentStorms.json") ? new Response(storms) : new Response("", { status: 503 }))) as unknown as typeof fetch;
    expect(await checkStorms(new Date("2026-09-10T23:00:00Z"), broken)).toMatchObject({ summary: expect.stringMatching(/1 cone couldn't be read/) });
    expect(await checkStorms(new Date("2026-09-11T05:00:00Z"), (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toEqual({ error: expect.stringMatching(/didn't answer/) });
    expect((await readBook()).book.storms.find((storm) => storm.id === "al992026")).toMatchObject({ status: "active" });
    expect(await prisma.notification.count({ where: { toEmail: "stella.storm@example.com", eventCode: "storm.watch" } })).toBe(1);

    // Gone from NHC's list: it has passed. The borrower gets a link for photos, once, and draws need a fresh inspection.
    active = false;
    expect(await checkStorms(new Date("2026-09-12T18:00:00Z"), fetcher)).toMatchObject({ summary: expect.stringMatching(/asked for photos after a storm/) });
    const book = (await readBook()).book;
    expect(book.storms.find((storm) => storm.id === "al992026")).toMatchObject({ status: "passed", passedAt: "2026-09-12T18:00:00.000Z" });
    expect(book.deals.find((deal) => deal.id === "storm-in")!.stormHold).toMatchObject({ stormId: "al992026", name: "Hurricane Testcase" });
    const request = book.photoRequests.find((item) => item.stormId === "al992026" && item.dealId === "storm-in")!;
    expect(request).toMatchObject({ who: "borrower", email: "wade.wind@example.com", scopeIds: [], byTeam: true });
    expect(await prisma.photoLink.count({ where: { requestId: request.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { toEmail: "stella.storm@example.com", eventCode: "storm.passed" } })).toBe(1);
    await checkStorms(new Date("2026-09-12T23:00:00Z"), fetcher);
    expect((await readBook()).book.photoRequests.filter((item) => item.stormId === "al992026" && item.dealId === "storm-in")).toHaveLength(1);
    // NHC writes a new advisory every six hours, so the job runs in each six-hour window; the rest run daily.
    expect(lib.jobs.runKeyFor("storms", new Date("2026-09-12T07:30:00Z"))).toBe("storms:2026-09-12T06");
    expect(lib.jobs.runKeyFor("servicing", new Date("2026-09-12T07:30:00Z"))).toBe("servicing:2026-09-12");
    vi.restoreAllMocks();
  });

  it("places a property, looks up its flood zone, and adds the flood insurance condition", async () => {
    const { readFileSync } = await import("node:fs");
    const { demoBook } = await import("@/lib/book");
    const { readBook } = await import("@/lib/book-store");
    const { mapProperty } = await import("@/lib/property-facts");
    const d1 = demoBook().deals.find((deal) => deal.id === "d1")!;
    await prisma.bookRecord.create({ data: { id: "deals:flood-loan", kind: "deals", data: JSON.parse(JSON.stringify({ ...d1, id: "flood-loan", loanNumber: "LH-8901", geo: undefined, floodMap: undefined, conditions: [] })) } });
    const fema = (name: string) => Response.json(JSON.parse(readFileSync(`tests/fixtures/fema/${name}.json`, "utf8")));
    const fetcher = (async (url: string) => (url.includes("geocoding.geo.census.gov") ? Response.json({ result: { addressMatches: [{ coordinates: { x: -80.1495, y: 26.0112 } }] } }) : url.includes("/query?") ? fema("zone-ae") : url.endsWith("MapServer?f=json") ? fema("directory") : new Response("", { status: 404 }))) as unknown as typeof fetch;
    expect(await mapProperty("flood-loan", { fetcher })).toMatchObject({ placed: true, flood: { mapped: true, zone: "AE", sfha: true } });
    const deal = (await readBook()).book.deals.find((item) => item.id === "flood-loan")!;
    expect(deal).toMatchObject({ geo: { lat: 26.0112, lng: -80.1495 }, floodMap: { mapped: true, zone: "AE", sfha: true }, insurance: { flood: { zone: "AE", source: "fema" } } });
    expect(deal.conditions?.filter((item) => item.templateId === "auto-flood")).toHaveLength(1);
    // Already looked up: left alone unless asked again. FEMA failing records nothing.
    expect(await mapProperty("flood-loan", { fetcher })).toMatchObject({ placed: false, flood: null });
    const failing = (async (url: string) => (url.includes("/query?") ? new Response("", { status: 502 }) : fetcher(url))) as unknown as typeof fetch;
    expect(await mapProperty("flood-loan", { again: true, fetcher: failing })).toMatchObject({ error: expect.stringMatching(/answered with an error \(502\)/) });
    expect((await readBook()).book.deals.find((item) => item.id === "flood-loan")!.floodMap?.at).toBe(deal.floodMap!.at);
  });
});

describe("partners' money between loans", () => {
  it("keeps a payoff's money with the partner's choice, rolls it into the next loan, and moves a share to the day", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { demoBook } = await import("@/lib/book");
    const { readBook, runAction } = await import("@/lib/book-store");
    const { sendAlerts } = await import("@/lib/book-alerts");
    const { creditOf } = await import("@/lib/capital-moves");
    const { payoffOn } = await import("@/lib/loan-exits");
    const firm = await prisma.organization.create({ data: { name: "Roll Capital", type: "PARTNER_LENDER" } });
    const other = await prisma.organization.create({ data: { name: "Taker Capital", type: "PARTNER_LENDER" } });
    await prisma.user.create({ data: { email: "rhea.roll@example.com", name: "Rhea Roll", passwordHash: "x", accountStatus: "APPROVED", organizationId: firm.id, roles: { create: [{ role: "PARTNER_LENDER" }] } } });
    const demo = demoBook();
    const d11 = demo.deals.find((deal) => deal.id === "d11")!;
    const screening = demo.partners[0].screening;
    const bid = (id: string, dealId: string, partnerId: string, status: string) => ({ id, dealId, partnerId, pct: 50, lenderRate: 9.25, lenderPoints: 0.5, conditions: "", status, type: "bid", at: "2026-06-20T14:00:00Z" });
    await prisma.bookRecord.createMany({ data: [
      { id: "deals:roll-loan", kind: "deals", data: JSON.parse(JSON.stringify({ ...d11, id: "roll-loan", loanNumber: "LH-7201", teaserSentTo: [firm.id], partnerFunding: { ...d11.partnerFunding!, partnerId: firm.id }, allocations: [{ sourceId: `partner:${firm.id}`, amount: 232_500 }, { sourceId: "gt-main", amount: 232_500 }] })) },
      { id: "deals:move-loan", kind: "deals", data: JSON.parse(JSON.stringify({ ...d11, id: "move-loan", loanNumber: "LH-7202", teaserSentTo: [firm.id], partnerFunding: { ...d11.partnerFunding!, partnerId: firm.id }, allocations: [{ sourceId: `partner:${firm.id}`, amount: 232_500 }, { sourceId: "gt-main", amount: 232_500 }] })) },
      { id: "bids:roll-bid", kind: "bids", data: bid("roll-bid", "roll-loan", firm.id, "accepted") },
      { id: "bids:move-bid", kind: "bids", data: bid("move-bid", "move-loan", firm.id, "accepted") },
      { id: `partners:${firm.id}`, kind: "partners", data: JSON.parse(JSON.stringify({ id: firm.id, name: "Roll Capital", ndaSigned: true, buyBox: demo.partners[0].buyBox, screening: { ...screening, subjects: [{ role: "firm", name: "Roll Capital", hits: [] }] } })) },
      { id: `partners:${other.id}`, kind: "partners", data: JSON.parse(JSON.stringify({ id: other.id, name: "Taker Capital", ndaSigned: true, buyBox: demo.partners[0].buyBox, screening: { ...screening, checkedAt: new Date().toISOString(), subjects: [{ role: "firm", name: "Taker Capital", hits: [] }] } })) },
    ] });
    const staff = { id: "staff-cap", name: "Cara Capital", roleCodes: ["ADMIN_OWNER" as const] };
    const partner = { id: "rhea", name: "Rhea Roll", roleCodes: ["PARTNER_LENDER" as const], organizationId: firm.id };
    const act = async (viewer: typeof staff | typeof partner, action: Parameters<typeof runAction>[1]) => {
      const result = await runAction(viewer, action);
      if ("error" in result) throw new Error(result.error);
      await sendAlerts(result.before, result.after, result.action);
      return result.after;
    };
    await act(partner, { t: "setRollover", partnerId: firm.id, choice: "all", by: "" });
    const today = new Date().toISOString().slice(0, 10);
    const loan = (await readBook()).book.deals.find((deal) => deal.id === "roll-loan")!;
    await act(staff, { t: "recordPayoff", dealId: "roll-loan", amount: payoffOn(loan, today).quote.total, receivedOn: today, method: "wire", reference: "PO-1", by: "" });
    let book = (await readBook()).book;
    const [proceeds] = book.partners.find((item) => item.id === firm.id)!.proceeds!;
    expect(proceeds).toMatchObject({ dealId: "roll-loan", choice: "all", toSend: 0 });
    expect(creditOf(book, firm.id)).toBe(proceeds.rolled);
    expect(await prisma.notification.count({ where: { toEmail: "rhea.roll@example.com", eventCode: "investor.paid_off" } })).toBe(1);

    // Its share of the other loan moves to another partner a week ago; payments from then on are the new holder's.
    const on = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    await act(staff, { t: "transferShare", dealId: "move-loan", from: firm.id, to: other.id, on, by: "" });
    book = (await readBook()).book;
    const moved = book.deals.find((deal) => deal.id === "move-loan")!;
    expect(moved.transfers?.[0]).toMatchObject({ from: firm.id, to: other.id, on });
    expect(book.bids.find((item) => item.id === "move-bid")).toMatchObject({ until: on });
    expect(book.bids.find((item) => item.partnerId === other.id && item.dealId === "move-loan")).toMatchObject({ status: "accepted", type: "transfer", since: on });
    expect(await prisma.notification.count({ where: { toEmail: "rhea.roll@example.com", eventCode: "investor.transfer" } })).toBe(1);
    vi.restoreAllMocks();
  });
});
