import { describe, expect, it } from "vitest";
import { demoBook, reducer, type Book } from "@/lib/book";
import { toCsv } from "@/lib/csv";
import { evaluate } from "@/lib/engine";
import { PRE_FUNDING } from "@/lib/loan-exits";
import { PERMISSION_GROUPS } from "@/lib/member-rules";
import type { Deal, LoanStatus } from "@/lib/mockData";
import { can, PERMISSIONS, type Permission } from "@/lib/permissions";
import { businessReport, dailyDigest, daysInStage, milestones, reportRows, summaryRows } from "@/lib/reports";

const demo = demoBook();
const at = (day: string) => `${day}T15:00:00.000Z`;
const history = (...steps: [LoanStatus, string][]) => steps.map(([status, day]) => ({ status, at: at(day) }));
const clean = { termSheets: undefined, termSheetSignedAt: undefined, termSheetSignedBy: undefined, closure: undefined, extensions: undefined, paidOff: undefined, allocations: [] };
const fromDemo = (id: string, changes: Partial<Deal>): Deal => ({ ...demo.deals.find((deal) => deal.id === id)!, ...clean, ...changes });
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };
const TODAY = "2026-10-31";

// Five loans through October: one funded, one stuck in underwriting, one declined, one priced on a September
// application, and one from before histories were kept.
const deals: Deal[] = [
  fromDemo("d9", { id: "a", loanNumber: "LH-A", borrowerName: "Ann Funded", source: "broker", status: "funded", capitalStatus: "funded", route: "in_house", closingDate: "2026-10-25", stages: history(["submitted", "2026-10-02"], ["term_sheet_issued", "2026-10-09"], ["term_sheet_accepted", "2026-10-12"], ["funded", "2026-10-25"]) }),
  fromDemo("d1", { id: "b", loanNumber: "LH-B", borrowerName: "Ben Stuck", source: "web_quote", status: "underwriting", stages: history(["submitted", "2026-10-05"], ["underwriting", "2026-10-06"]) }),
  fromDemo("d1", { id: "c", loanNumber: "LH-C", borrowerName: "Cal Declined", source: "web_quote", status: "declined", closure: { outcome: "declined", reason: "leverage", note: "", by: "Uma", at: at("2026-10-28"), from: "underwriting" }, stages: history(["submitted", "2026-10-20"], ["declined", "2026-10-28"]) }),
  fromDemo("d1", { id: "d", loanNumber: "LH-D", borrowerName: "Dee Priced", source: "referral", status: "term_sheet_issued", stages: history(["submitted", "2026-09-10"], ["term_sheet_issued", "2026-10-03"]) }),
  fromDemo("d1", { id: "e", loanNumber: "LH-E", borrowerName: "Eve Old", source: "ad", status: "submitted", daysInStage: 3, stages: undefined }),
];
const book: Book = { ...demo, deals, draws: [], payoffs: [] };
const note = (id: string) => evaluate(deals.find((deal) => deal.id === id)!.app).noteAmount;

describe("each loan's history", () => {
  it("notes when a new application arrives and each stage it moves to", () => {
    const sent = reducer(demo, { t: "submitApp", app: demo.deals[0].app, address: "1 History Way", city: "Hollywood", zip: "33020", entityName: "History LLC", exitStrategy: "Sell" });
    const fresh = sent.deals[0];
    expect(fresh.stages?.map((item) => item.status)).toEqual(["submitted"]);
    const withdrawn = reducer(sent, { t: "closeApplication", dealId: fresh.id, outcome: "withdrawn", reason: "other", note: "", by: "Alex", byTeam: false });
    expect(withdrawn.deals.find((deal) => deal.id === fresh.id)!.stages?.map((item) => item.status)).toEqual(["submitted", "withdrawn"]);
    // Nothing is added for a loan whose stage didn't change.
    const untouched = withdrawn.deals.find((deal) => deal.id === "d1")!;
    expect(untouched.stages).toEqual(demo.deals.find((deal) => deal.id === "d1")!.stages);
  });
  it("loading sample data keeps the sample's own history", () => {
    const loaded = reducer(demo, { t: "loadSample" });
    for (const deal of loaded.deals) expect(deal.stages?.at(-1)?.status).toBe(deal.status);
    expect(loaded.deals.find((deal) => deal.id === "d1")!.stages).toEqual(demo.deals.find((deal) => deal.id === "d1")!.stages);
  });
  it("counts days in a stage from the history, and falls back to the saved count for older loans", () => {
    expect(daysInStage(deals[1], TODAY)).toBe(25);
    expect(daysInStage(deals[4], TODAY)).toBe(3);
    // The demo's made-up history agrees with the counts the demo always showed for loans not yet funded.
    for (const deal of demo.deals.filter((item) => PRE_FUNDING.includes(item.status))) expect(daysInStage(deal, "2026-10-31")).toBe(deal.daysInStage);
  });
  it("finds each step's day, from the history or the loan's own records", () => {
    expect(milestones(deals[0])).toMatchObject({ submitted: "2026-10-02", termSheet: "2026-10-09", accepted: "2026-10-12", funded: "2026-10-25" });
    expect(milestones(deals[2])).toMatchObject({ submitted: "2026-10-20", closed: "2026-10-28", funded: undefined });
    expect(milestones(deals[4]).submitted).toBeUndefined();
  });
});

describe("the business report", () => {
  const report = businessReport(book, OCTOBER, TODAY);
  it("counts the period's applications, term sheets, fundings and declines", () => {
    expect(report.pipeline.applications).toEqual({ count: 3, amount: note("a") + note("b") + note("c") });
    expect(report.pipeline.termSheets.count).toBe(2);
    expect(report.pipeline.accepted.count).toBe(1);
    expect(report.pipeline.funded).toEqual({ count: 1, amount: note("a") });
    expect(report.pipeline.declined.count).toBe(1);
    expect(report.pipeline.undated).toBe(1);
  });
  it("follows the period's applications through, and times each step by its median", () => {
    expect(report.pipeline.pullThrough).toEqual({ applied: 3, termSheet: 1, funded: 1, lost: 1, open: 1 });
    expect(report.pipeline.cycleTimes).toEqual({ toTermSheet: { days: 15, loans: 2 }, termSheetToFunding: { days: 16, loans: 1 }, toFunding: { days: 23, loans: 1 } });
  });
  it("lists loans stuck over a week, longest first, and why applications ended", () => {
    expect(report.pipeline.stuck.map((row) => [row.deal.loanNumber, row.days])).toEqual([["LH-D", 28], ["LH-B", 25]]);
    expect(report.pipeline.closures).toEqual([{ key: "declined: Value or leverage doesn't support the loan", count: 1, amount: note("c") }]);
  });
  it("breaks the period down by where loans came from", () => {
    expect(report.pipeline.bySource.map((row) => [row.label, row.applications, row.termSheets, row.funded])).toEqual([["Broker", 1, 1, 1], ["Portal application", 2, 0, 0], ["Referral", 0, 1, 0]]);
  });
  it("includes both ends of the period, and nothing outside it", () => {
    expect(businessReport(book, { from: "2026-10-02", to: "2026-10-02" }, TODAY).pipeline.applications.count).toBe(1);
    expect(businessReport(book, { from: "2026-11-01", to: "2026-11-30" }, TODAY).pipeline.applications.count).toBe(0);
    expect(businessReport(book, { from: "2026-09-01", to: "2026-09-30" }, TODAY).pipeline.applications.count).toBe(1);
  });
  it("shows capital and the portfolio as they stand, the same way the capital and servicing pages count", () => {
    const full = businessReport(demo, OCTOBER, "2026-10-31");
    expect(full.capital).toMatchObject({ commitment: 9_000_000, available: 3_456_500 });
    expect(full.portfolio.loans).toBe(8);
    expect(full.portfolio.outstanding).toBeCloseTo(2_727_311.94, 2);
    expect(full.portfolio.averageRate).toBeGreaterThan(8);
    expect(full.portfolio.buckets.map((bucket) => bucket.count)).toEqual([7, 0, 1, 0, 0]);
    expect(full.portfolio.maturing.map((row) => row.count)).toEqual([0, 0, 1]);
    expect(full.portfolio.byBorrower[0]).toMatchObject({ key: "Avery Mock (FAKE)", amount: 465_000 });
  });
});

describe("the morning email", () => {
  it("says what happened yesterday, what's waiting and what's stuck, with loan numbers but no names", () => {
    const digest = dailyDigest(book, "2026-10-26", [{ label: "Draws in progress", count: 4 }], "https://portal.example.com/admin/reports");
    expect(digest.subject).toBe("LendHous today: 0 new applications, 1 funded, 4 waiting");
    expect(digest.body).toMatch(/^Yesterday \(Sun, Oct 25\): 0 new applications, 0 term sheets sent, 1 loan funded \(\$/);
    expect(digest.body).toContain("- Draws in progress: 4");
    expect(digest.body).toContain("- LH-D: term sheet issued, 23 days");
    expect(digest.body).toContain("https://portal.example.com/admin/reports");
    for (const name of ["Ann Funded", "Ben Stuck", "Cal Declined", "Dee Priced"]) expect(digest.body).not.toContain(name);
  });
  it("says so when nothing is waiting", () => {
    expect(dailyDigest(book, TODAY, [], "x").body).toContain("Nothing is waiting on the team.");
  });
});

describe("spreadsheets and access", () => {
  it("exports every loan and the summary", () => {
    const rows = reportRows(book, TODAY);
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.Loan === "LH-A")).toMatchObject({ Applied: "2026-10-02", Funded: "2026-10-25", "Days to funding": 23, Source: "Broker" });
    expect(rows.find((row) => row.Loan === "LH-B")).toMatchObject({ "Days in stage": 25, Funded: "" });
    expect(toCsv(rows).split("\r\n")).toHaveLength(6);
    expect(summaryRows(businessReport(book, OCTOBER, TODAY)).find((row) => row.Measure === "Loans funded (count)")?.Value).toBe(1);
  });
  it("is for owners, capital managers and auditors by default", () => {
    expect((["ADMIN_OWNER", "CAPITAL_MANAGER", "AUDITOR"] as const).every((role) => can([role], "view_reports"))).toBe(true);
    expect((["PROCESSOR", "UNDERWRITER", "SERVICER", "BORROWER"] as const).some((role) => can([role], "view_reports"))).toBe(false);
    expect(PERMISSION_GROUPS.flatMap((group) => group.items).sort()).toEqual((Object.keys(PERMISSIONS) as Permission[]).sort());
  });
});
