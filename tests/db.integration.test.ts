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
