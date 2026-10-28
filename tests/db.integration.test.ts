// Runs against a real MongoDB replica set (mongodb-memory-server, version 7.0 like Atlas and docker-compose.yml).
// Proves the database-side mitigations work, not only the application checks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { PrismaClient } from "@prisma/client";

let replSet: MongoMemoryReplSet;
let prisma: PrismaClient;
let lib: {
  approvals: typeof import("@/lib/approvals");
  jobs: typeof import("@/lib/jobs");
  indexes: typeof import("@/lib/mongo-indexes");
  validators: typeof import("@/lib/mongo-validators");
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
