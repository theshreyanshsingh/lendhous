import { describe, expect, it } from "vitest";
import { groupNotices, inAppBody, loanIn, readChoices, routeNotice, safeLink, summaryEmail, topicOf, topicsFor, topicWords, type Notice } from "@/lib/notice-topics";

const at = (iso: string) => new Date(iso);
const notice = (id: string, subject: string, change: Partial<Notice> = {}): Notice => ({ id, subject, body: `${subject} body.\n\nSign in: https://example.test/login`, eventCode: "draw.requested", createdAt: at("2026-11-18T15:00:00Z"), readAt: null, ...change });
const person = { legal: false, email: true, inApp: true, hasAccount: true };

describe("notification topics, choices and grouping", () => {
  it("files every kind of update under a topic by its event code", () => {
    expect(topicOf("message.client")).toBe("messages");
    expect(topicOf("doc.rejected")).toBe("documents");
    expect(topicOf("closing.title_update")).toBe("documents");
    expect(topicOf("closing.recorded")).toBe("progress");
    expect(topicOf("loan.term_sheet_issued")).toBe("progress");
    expect(topicOf("broker.funded")).toBe("progress");
    expect(topicOf("loan.paid_off")).toBe("payments");
    expect(topicOf("loan.default_cured")).toBe("payments");
    expect(topicOf("lien.waiver_received")).toBe("draws");
    expect(topicOf("storm.watch")).toBe("insurance");
    expect(topicOf("bid.accepted")).toBe("investors");
    expect(topicOf("ofac.match")).toBe("compliance");
    expect(topicOf("")).toBe("other");
    expect(topicsFor("borrower")).not.toContain("compliance");
    expect(topicsFor("partner")).toEqual(["payments", "investors", "compliance", "other"]);
    expect(topicsFor("admin")).toHaveLength(9);
    expect(topicWords("compliance", "partner").label).toBe("Bankruptcy and foreclosure");
    expect(topicWords("compliance", "admin").label).toBe("Screening and collections");
  });

  it("emails right away by default, holds for the daily summary, or keeps it here only", () => {
    expect(routeNotice({ ...person, eventCode: "draw.requested", choices: undefined })).toEqual({ email: true, summary: false, keep: true, push: true, readNow: false });
    expect(routeNotice({ ...person, eventCode: "draw.requested", choices: { draws: "daily" } })).toEqual({ email: false, summary: true, keep: true, push: false, readNow: false });
    expect(routeNotice({ ...person, eventCode: "draw.requested", choices: { draws: "app" } })).toEqual({ email: false, summary: false, keep: true, push: false, readNow: false });
    // Another topic's choice doesn't touch this one.
    expect(routeNotice({ ...person, eventCode: "doc.requested", choices: { draws: "app" } }).email).toBe(true);
  });

  it("always emails legal notices and people without an account, and never holds the owners' morning email", () => {
    expect(routeNotice({ ...person, email: false, inApp: false, legal: true, eventCode: "adverse_action.requested", choices: { compliance: "app" } })).toMatchObject({ email: true, keep: true });
    expect(routeNotice({ ...person, hasAccount: false, eventCode: "doc.requested", choices: undefined })).toMatchObject({ email: true, keep: true, push: false });
    expect(routeNotice({ ...person, eventCode: "digest.daily", choices: { other: "daily" } })).toMatchObject({ email: true, summary: false });
  });

  it("respects the master switches: no email means no summary either; a held notice is kept but already read", () => {
    expect(routeNotice({ ...person, email: false, eventCode: "draw.requested", choices: { draws: "daily" } })).toMatchObject({ email: false, summary: false, keep: true });
    expect(routeNotice({ ...person, inApp: false, eventCode: "draw.requested", choices: { draws: "daily" } })).toEqual({ email: false, summary: true, keep: true, push: false, readNow: true });
    expect(routeNotice({ ...person, inApp: false, eventCode: "draw.requested", choices: { draws: "app" } })).toMatchObject({ email: false, keep: false });
  });

  it("reads stored choices defensively", () => {
    expect(readChoices({ draws: "daily", payments: "loud", nonsense: "now" })).toEqual({ draws: "daily" });
    expect(readChoices(null)).toEqual({});
    expect(readChoices("daily")).toEqual({});
  });

  it("groups by loan, newest first, falling back to a loan number in older notices", () => {
    const groups = groupNotices([
      notice("a", "Draw released: LH-1004", { createdAt: at("2026-11-17T12:00:00Z"), readAt: at("2026-11-17T13:00:00Z") }),
      notice("b", "Payment late", { loan: "LH-1002", createdAt: at("2026-11-18T12:00:00Z") }),
      notice("c", "New quote request: Fix & flip, Miami, FL", { createdAt: at("2026-11-16T12:00:00Z") }),
      notice("d", "Every document is in: LH-DEMO-1004", { createdAt: at("2026-11-18T14:00:00Z") }),
      notice("e", "Update on LH-1004", { createdAt: at("2026-11-18T10:00:00Z") }),
    ]);
    expect(groups.map((group) => [group.loan, group.notices.map((item) => item.id), group.unread])).toEqual([
      ["LH-DEMO-1004", ["d"], 1],
      ["LH-1002", ["b"], 1],
      ["LH-1004", ["e", "a"], 1],
      [undefined, ["c"], 1],
    ]);
    expect(loanIn("Payment late", "On LH-2001 and LH-2002")).toBe("LH-2001");
  });

  it("opens only pages inside LendHous, and drops the sign-in line in the app", () => {
    expect(safeLink("/admin/deals/d1")).toBe("/admin/deals/d1");
    expect(safeLink("//evil.example/x")).toBeUndefined();
    expect(safeLink("https://evil.example")).toBeUndefined();
    expect(safeLink("/\\evil.example")).toBeUndefined();
    expect(inAppBody("Your draw was released.\n\nSign in: https://lendhous.test/login")).toBe("Your draw was released.");
  });

  it("writes one summary email for the day, grouped by loan", () => {
    const summary = summaryEmail([notice("a", "Draw requested: LH-1004", { body: "Pat asked for $12,000.\n\nSign in: x" }), notice("b", "New quote request")], "https://lendhous.test");
    expect(summary.subject).toBe("Your LendHous updates: 2 since yesterday");
    expect(summary.body).toContain("LH-1004\n- Draw requested: LH-1004: Pat asked for $12,000.");
    expect(summary.body).toContain("Other updates\n- New quote request: New quote request body.");
    expect(summary.body).toContain("https://lendhous.test/admin/account/notifications");
  });
});
