import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";
import { authorize, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer } from "@/lib/book";
import { assignProblem, initialsOf, isMine, needsOfficer, teamEmails } from "@/lib/loan-team";
import { DEMO_TEAM, type TeamMember } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { businessReport } from "@/lib/reports";

const [, uma, pat] = DEMO_TEAM;
const owner: Viewer = { id: "owner", name: "Olivia Owner (FAKE)", roleCodes: ["ADMIN_OWNER"] };
const allowedFor = (viewer: Viewer) => (permission: Permission) => can(viewer.roleCodes, permission, { member: viewer });
const dee: TeamMember = { id: "u-dee", name: "Dee Officer", email: "dee@example.com", phone: "(305) 555-0199", title: "Loan officer" };

describe("who works each loan", () => {
  const book = demoBook();
  const d1 = book.deals.find((deal) => deal.id === "d1")!;
  it("the demo splits its loans between two officers, and new applications wait for one", () => {
    expect(d1.team).toEqual({ officer: uma, processor: pat });
    const waiting = book.deals.filter(needsOfficer);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((deal) => deal.status === "submitted")).toBe(true);
    expect(attentionItems(book, 0).find((item) => item.key === "unassigned")).toMatchObject({ count: waiting.length, href: "/admin?team=unassigned" });
  });
  it("knows whose loan it is, by account or, in the demo, by email", () => {
    expect(isMine(d1, { id: "demo-uma" })).toBe(true);
    expect(isMine(d1, { id: "real-account-id", email: "PAT.processor@lendhous.test" })).toBe(true);
    expect(isMine(d1, { id: "someone", email: "olivia.owner@lendhous.test" })).toBe(false);
    expect(teamEmails(d1)).toEqual([uma.email, pat.email]);
    expect(initialsOf("Uma Underwriter (FAKE)")).toBe("UU");
    expect(initialsOf("Cher")).toBe("C");
  });
  it("assigns and takes off, and says so in the log", () => {
    const assigned = reducer(book, { t: "assignLoanTeam", dealId: "d1", role: "officer", member: dee, by: "Olivia Owner (FAKE)" });
    expect(assigned.deals.find((deal) => deal.id === "d1")!.team).toEqual({ officer: dee, processor: pat });
    expect(assigned.audit[0].text).toBe("LH-DEMO-1001: Dee Officer is the loan officer (Olivia Owner (FAKE))");
    const cleared = reducer(reducer(assigned, { t: "assignLoanTeam", dealId: "d1", role: "processor", member: null, by: "x" }), { t: "assignLoanTeam", dealId: "d1", role: "officer", member: null, by: "x" });
    expect(cleared.deals.find((deal) => deal.id === "d1")!.team).toBeUndefined();
  });
  it("only the server assigns, once it has looked the person up", () => {
    const action = { t: "assignLoanTeam" as const, dealId: "d1", role: "officer" as const, member: dee, by: "Olivia" };
    expect(authorize(book, owner, action, allowedFor(owner))).toHaveProperty("error");
    expect(authorize(book, owner, action, allowedFor(owner), true)).not.toHaveProperty("error");
    expect(authorize(book, owner, { ...action, member: uma }, allowedFor(owner), true)).toMatchObject({ error: expect.stringMatching(/already the loan officer/) });
    expect(parseAction(action)).toBeNull();
    expect(assignProblem(d1, "officer", { ...dee, email: " " })).toMatch(/missing a name or email/);
  });
  it("is for owners and underwriters by default", () => {
    expect((["ADMIN_OWNER", "UNDERWRITER"] as const).every((role) => can([role], "assign_loans"))).toBe(true);
    expect((["PROCESSOR", "CAPITAL_MANAGER", "SERVICER", "BORROWER"] as const).some((role) => can([role], "assign_loans"))).toBe(false);
  });
  it("tells the person they've been given a loan, unless they took it themselves", () => {
    const action = { t: "assignLoanTeam" as const, dealId: "d1", role: "processor" as const, member: dee, by: "Olivia Owner (FAKE)" };
    const after = reducer(book, action);
    expect(alertsFor(book, after, action)).toEqual([expect.objectContaining({ to: "email", email: "dee@example.com", subject: "You're the processor on LH-DEMO-1001", event: "loan.assigned" })]);
    const self = { ...action, by: "Dee Officer" };
    expect(alertsFor(book, reducer(book, self), self)).toEqual([]);
  });
  it("the reports count each officer's applications and fundings", () => {
    const report = businessReport(book, { from: "2026-08-03", to: "2026-10-31" }, "2026-10-31");
    const names = report.pipeline.byOfficer.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(["Uma Underwriter (FAKE)", "Olivia Owner (FAKE)", "No loan officer"]));
    expect(report.pipeline.byOfficer.reduce((sum, row) => sum + row.applications, 0)).toBe(report.pipeline.applications.count);
  });
});
