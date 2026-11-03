import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ECOA_NOTICE, isLarge, keepUntil, noticeContent, noticeDueOn, noticeOwed, noticeReminders, reasonsProblem, requestProblem, revenueProblem } from "@/lib/adverse-action";
import { noticePdf } from "@/lib/adverse-action-pdf";
import { attentionItems } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { seedDeals, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

// An application in underwriting, as in the loan exit tests, on November 3, 2026.
const application = (changes: Partial<Deal> = {}): Deal => ({ ...seedDeals.find((item) => item.id === "d9")!, id: "L1", borrowerId: "borrower-1", brokerId: undefined, status: "underwriting", capitalStatus: "reserved", allocations: [], ...changes });
const book = (deal: Deal = application()): Book => ({ ...emptyBook(), deals: [deal] });
const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const underwriter = person("uw", ["UNDERWRITER"]);
const processor = person("proc", ["PROCESSOR"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const borrower = person("borrower-1", ["BORROWER"]);
const system = person("system", []);
const decline = (revenue?: number): BookAction => ({ t: "closeApplication", dealId: "L1", outcome: "declined", reason: "liquidity", note: "Only $20k verified", by: "x", byTeam: true, ...(revenue === undefined ? {} : { revenue: { amount: revenue, year: 2025 } }) });
const sent = (kind: "notice" | "statement" = "notice"): BookAction => ({ t: "recordAdverseNotice", dealId: "L1", kind, method: "email", to: ["b@example.com"], result: "sent", by: "Uma" });
const deal = (b: Book) => b.deals[0];
const LENDER = { name: "LendHous", address: "100 Main St, Fort Lauderdale, FL 33301", phone: "(954) 555-0100" };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T17:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("the notice's deadline (12 CFR 1002.9(a))", () => {
  it("is 30 days from the completed application, or from the decision on an incomplete one; a reasonable time over $1 million", () => {
    expect(isLarge(undefined)).toBe(false);
    expect(isLarge({ amount: 1_000_000, year: 2025, by: "", at: "" })).toBe(false);
    expect(isLarge({ amount: 1_000_001, year: 2025, by: "", at: "" })).toBe(true);
    expect(noticeDueOn({ completed: { on: "2026-10-20", at: "", by: "" } }, "2026-11-03")).toBe("2026-11-19");
    expect(noticeDueOn({}, "2026-11-03")).toBe("2026-12-03");
    expect(noticeDueOn({ revenue: { amount: 2_500_000, year: 2025, by: "", at: "" }, completed: { on: "2026-10-01", at: "", by: "" } }, "2026-11-03")).toBe("2026-12-03");
  });
  it("starts when the application is marked complete, or when the credit review is signed off", () => {
    const b = book();
    expect(check(b, borrower, { t: "markApplicationComplete", dealId: "L1", on: "2026-11-01", by: "x" })).toHaveProperty("error");
    expect(check(b, processor, { t: "markApplicationComplete", dealId: "L1", on: "2026-11-04", by: "x" })).toMatchObject({ error: expect.stringMatching(/today or earlier/) });
    const marked = run(b, processor, { t: "markApplicationComplete", dealId: "L1", on: "2026-11-01", by: "x" }).after;
    expect(deal(marked).completed).toMatchObject({ on: "2026-11-01", by: "proc name" });
    expect(check(marked, processor, { t: "markApplicationComplete", dealId: "L1", on: "2026-11-02", by: "x" })).toMatchObject({ error: expect.stringMatching(/already|marked complete on 2026-11-01/) });
    const signed = run(b, underwriter, { t: "signOffCredit", dealId: "L1", by: "x", note: "" }).after;
    expect(deal(signed).completed).toMatchObject({ on: "2026-11-03", by: "uw name" });
  });
});

describe("declining an application", () => {
  it("starts the notice with a specific reason and tells the team when it's due", () => {
    const b = run(book(), underwriter, { t: "markApplicationComplete", dealId: "L1", on: "2026-10-20", by: "x" }).after;
    const { after, action } = run(b, underwriter, decline(800_000));
    expect(deal(after).revenue).toMatchObject({ amount: 800_000, year: 2025 });
    expect(deal(after).adverseAction).toMatchObject({ large: false, decidedOn: "2026-11-03", dueOn: "2026-11-19", reasons: ["Not enough verified cash to close and to hold in reserve"] });
    expect(alertsFor(b, after, action).find((alert) => alert.to === "team")).toMatchObject({ event: "adverse_action.due", body: expect.stringMatching(/due by November 19, 2026, with the specific reasons/) });
    expect(alertsFor(b, after, action).find((alert) => alert.to === "borrower")!.body).toMatch(/A letter explaining our decision will follow/);
    expect(noticeOwed(deal(after))).toEqual({ kind: "notice", dueOn: "2026-11-19" });
    expect(attentionItems(after, 0).find((item) => item.key === "notices")).toMatchObject({ count: 1, href: "/admin/deals/L1" });
    expect(noticeReminders(after.deals, "2026-11-14")).toEqual([expect.stringMatching(/adverse action notice .* due 2026-11-19/)]);
    expect(noticeReminders(after.deals, "2026-11-13")).toEqual([]);
    expect(noticeReminders(after.deals, "2026-11-20")).toEqual([expect.stringMatching(/1 day late/)]);
  });
  it("takes specific reasons, at most four, from someone who can decline", () => {
    const b = run(book(), underwriter, decline()).after;
    const reasons = (list: string[]): BookAction => ({ t: "saveAdverseReasons", dealId: "L1", reasons: list, by: "x" });
    expect(check(b, processor, reasons(["Insufficient collateral"]))).toHaveProperty("error");
    expect(check(b, underwriter, reasons(["Doesn't meet our internal standards"]))).toMatchObject({ error: expect.stringMatching(/1002\.9\(b\)\(2\)/) });
    expect(check(b, underwriter, reasons(["a", "b", "c", "d", "e"]))).toMatchObject({ error: expect.stringMatching(/four at most/) });
    expect(check(b, underwriter, reasons([" "]))).toMatchObject({ error: expect.stringMatching(/at least one/) });
    const saved = run(b, underwriter, reasons(["Not enough verified cash to close", " Value of the collateral not sufficient "])).after;
    expect(deal(saved).adverseAction!.reasons).toEqual(["Not enough verified cash to close", "Value of the collateral not sufficient"]);
    const notified = run(saved, system, sent(), true).after;
    expect(check(notified, underwriter, reasons(["Something else"]))).toMatchObject({ error: expect.stringMatching(/already gone out/) });
  });
  it("records the notice only from the server, and keeps the records 12 months from it", () => {
    const b = run(book(), underwriter, decline()).after;
    expect(check(b, owner, sent())).toHaveProperty("error");
    expect(parseAction(sent())).toBeNull();
    const notified = run(b, system, sent(), true).after;
    expect(deal(notified).adverseAction!.notice).toMatchObject({ sentOn: "2026-11-03", method: "email", to: ["b@example.com"], result: "sent" });
    expect(noticeOwed(deal(notified))).toBeNull();
    expect(keepUntil(deal(notified))).toBe("2027-11-03");
    expect(reducer(notified, sent())).toBe(notified);
    // The borrower sees the letter went out, not who sent it, where to, or any legal hold.
    const held = run(notified, owner, { t: "setLegalHold", dealId: "L1", reason: "CFPB inquiry (test)", by: "x" }).after;
    expect(check(notified, underwriter, { t: "setLegalHold", dealId: "L1", reason: "x", by: "x" })).toHaveProperty("error");
    expect(keepUntil(deal(held))).toBeNull();
    const mine = scopeBook(held, borrower).deals[0];
    expect(mine.adverseAction!.notice).toMatchObject({ sentOn: "2026-11-03", by: "", to: [] });
    expect(mine.legalHold).toBeUndefined();
    expect(keepUntil(deal(run(held, owner, { t: "setLegalHold", dealId: "L1", reason: "", by: "x" }).after))).toBe("2027-11-03");
  });
  it("drops an unsent notice if the application is reopened, but keeps one already sent", () => {
    const b = run(book(), underwriter, decline()).after;
    expect(deal(run(b, underwriter, { t: "reopenApplication", dealId: "L1", by: "x" }).after).adverseAction).toBeUndefined();
    const notified = run(b, system, sent(), true).after;
    expect(deal(run(notified, underwriter, { t: "reopenApplication", dealId: "L1", by: "x" }).after).adverseAction!.notice).toBeDefined();
  });
});

describe("a business over $1 million (1002.9(a)(3)(ii))", () => {
  it("gets the notice in a reasonable time, and the reasons only on a written request within 60 days", () => {
    const b = run(book(), underwriter, decline(2_500_000)).after;
    expect(deal(b).adverseAction).toMatchObject({ large: true, dueOn: "2026-12-03" });
    const notified = run(b, system, sent(), true).after;
    expect(keepUntil(deal(notified))).toBe("2027-01-02");
    const ask = (receivedOn: string): BookAction => ({ t: "recordReasonsRequest", dealId: "L1", receivedOn, by: "x" });
    expect(check(b, underwriter, ask("2026-11-03"))).toMatchObject({ error: expect.stringMatching(/Send the notice first/) });
    expect(requestProblem(deal(notified).adverseAction, "2027-01-03", "2027-01-05")).toMatch(/more than 60 days/);
    const asked = run(notified, underwriter, ask("2026-11-03"));
    expect(deal(asked.after).adverseAction!.request).toMatchObject({ receivedOn: "2026-11-03", dueOn: "2026-12-03" });
    expect(alertsFor(notified, asked.after, asked.action)).toMatchObject([{ to: "team", event: "adverse_action.requested", body: expect.stringMatching(/due by December 3, 2026/) }]);
    expect(noticeOwed(deal(asked.after))).toEqual({ kind: "statement", dueOn: "2026-12-03" });
    expect(keepUntil(deal(asked.after))).toBe("2027-11-03");
    const answered = run(asked.after, system, sent("statement"), true).after;
    expect(noticeOwed(deal(answered))).toBeNull();
  });
  it("follows revenue learned after the decline, until the notice goes out", () => {
    const b = run(book(), underwriter, decline()).after;
    expect(deal(b).adverseAction!.large).toBe(false);
    const updated = run(b, underwriter, { t: "saveRevenue", dealId: "L1", amount: 3_000_000, year: 2025, by: "x" }).after;
    expect(deal(updated).adverseAction).toMatchObject({ large: true, dueOn: "2026-12-03" });
    expect(revenueProblem(-1, 2025, "2026-11-03")).toMatch(/dollars/);
    expect(revenueProblem(500_000, 2019, "2026-11-03")).toMatch(/last fiscal year/);
  });
});

describe("the letter", () => {
  it("gives a smaller business the specific reasons, the ECOA notice and where to write", async () => {
    const b = run(book(), underwriter, decline()).after;
    const d = deal(b);
    const content = noticeContent(d, d.adverseAction!, "notice", LENDER, evaluate(d.app).noteAmount, "2026-11-03");
    expect(content.reasons).toEqual(["Not enough verified cash to close and to hold in reserve"]);
    expect(content.ecoa).toContain(ECOA_NOTICE);
    expect(content.ecoa).toContain("100 Main St, Fort Lauderdale, FL 33301");
    expect(content.re).toMatch(/business loan secured by .*LH-DEMO-1009/);
    expect((await noticePdf(content)).subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("tells a larger business how to ask for the reasons instead of giving them", () => {
    const b = run(book(), underwriter, decline(2_500_000)).after;
    const d = deal(b);
    const content = noticeContent(d, d.adverseAction!, "notice", LENDER, evaluate(d.app).noteAmount, "2026-11-03");
    expect(content.reasons).toEqual([]);
    expect(content.paragraphs.join(" ")).toMatch(/write to us at LendHous, 100 Main St.* within 60 days .* within 30 days/);
  });
});
