import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { errorHash, isControlFlow, parseDsn, scrubMessage, sentryEvent } from "@/lib/error-report";
import { STALE_HOURS, staleJobs } from "@/lib/health";
import { dailyDigest } from "@/lib/reports";

describe("error reports", () => {
  it("keep no personal data in the message", () => {
    const message = scrubMessage("Invalid `prisma.user.create()` invocation: email 'pat.borrower@example.com' phone (954) 555-0100 SSN 123456789 token Xk29_aB7cD8eF9gH0iJ1kL2mN3\nsecond line with more detail");
    expect(message).not.toMatch(/pat\.borrower|example\.com|555-0100|123456789|Xk29_aB7/);
    expect(message).not.toContain("second line");
    expect(scrubMessage("Mail to pat@example.com failed")).toBe("Mail to [email] failed");
    expect(scrubMessage("x".repeat(1000)).length).toBeLessThanOrEqual(300);
    expect(scrubMessage("")).toBe("Unknown error");
  });
  it("group the same failure in the same place, whatever the values", () => {
    const fail = (message: string) => { const error = new Error(message); error.stack = `Error: ${message}\n    at readBook (lib/book-store.ts:25:3)\n    at Page (app/admin/page.tsx:12:9)`; return error; };
    expect(errorHash(fail("loan d1 missing"), "/admin/deals/[id]")).toBe(errorHash(fail("loan d2 missing"), "/admin/deals/[id]"));
    expect(errorHash(fail("loan d1 missing"), "/admin/deals/[id]")).not.toBe(errorHash(fail("loan d1 missing"), "/admin"));
  });
  it("ignore redirects and not-found, which aren't failures", () => {
    expect(isControlFlow(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }))).toBe(true);
    expect(isControlFlow(new Error("boom"))).toBe(false);
  });
  it("go to Sentry only with a real DSN, carrying the scrubbed message and the route", () => {
    expect(parseDsn("https://abc123@o42.ingest.sentry.io/7")).toEqual({ endpoint: "https://o42.ingest.sentry.io/api/7/store/", key: "abc123" });
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a dsn")).toBeNull();
    const event = sentryEvent("Loan [number] missing", "/admin/deals/[id]", "render", new Date("2026-11-04T12:00:00Z"), "production");
    expect(event).toMatchObject({ level: "error", platform: "node", message: { formatted: "Loan [number] missing" }, tags: { route: "/admin/deals/[id]", kind: "render" }, environment: "production" });
    expect(Object.keys(event).sort()).toEqual(["environment", "event_id", "level", "logger", "message", "platform", "tags", "timestamp"]);
  });
});

describe("health", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  it("calls a job stale after two days, or if it never ran", () => {
    expect(STALE_HOURS).toBe(48);
    expect(staleJobs({}, now)).toEqual(["servicing", "sanctions"]);
    expect(staleJobs({ servicing: new Date("2026-11-04T06:05:00Z"), sanctions: new Date("2026-11-03T06:05:00Z") }, now)).toEqual([]);
    expect(staleJobs({ servicing: new Date("2026-11-01T06:05:00Z"), sanctions: new Date("2026-11-04T06:05:00Z") }, now)).toEqual(["servicing"]);
  });
  it("the morning email says how many errors there were, with a link", () => {
    expect(dailyDigest(demoBook(), "2026-10-31", [], "https://portal.example.com/admin/reports", 3).body).toContain("Server errors in the last day: 3. See them at https://portal.example.com/admin/errors.");
    expect(dailyDigest(demoBook(), "2026-10-31", [], "https://portal.example.com/admin/reports").body).not.toContain("Server errors");
  });
});
