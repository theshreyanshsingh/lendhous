import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { BORROWER_ID, DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { termSheetPdf } from "@/lib/term-sheet-pdf";
import { exceptionReasons, latestSheet, matrixOf, pricedApp, respondProblem, sheetContent, startingTerms, termsProblem, type TermsInput } from "@/lib/term-sheets";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const underwriter = person("uw", ["UNDERWRITER"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const owner2 = person("owner2", ["ADMIN_OWNER"]);
const borrower = person(BORROWER_ID, ["BORROWER"]);
const system = person("system", []);
// d1 is the demo borrower's fix and flip in underwriting; here its credit review is signed off, so a term sheet can go.
const book = (): Book => { const b = demoBook(); return { ...b, deals: b.deals.map((d) => (d.id === "d1" ? { ...d, creditReview: { by: "Uma", at: "2026-10-30T00:00:00Z", note: "", verifiedDeals: d.app.verifiedDeals } } : d)) }; };
const deal = (b: Book, id = "d1") => b.deals.find((d) => d.id === id)!;
const terms = (b: Book, changes: Partial<TermsInput> = {}): TermsInput => ({ ...startingTerms(deal(b)), ...changes });
const issue = (b: Book, changes: Partial<TermsInput> = {}): BookAction => ({ t: "issueTermSheet", dealId: "d1", ...terms(b, changes), by: "x" });
const ask = (b: Book, changes: Partial<TermsInput> = {}, note = "Repeat borrower with a competing offer"): BookAction => ({ t: "requestPricingException", dealId: "d1", ...terms(b, changes), note, by: "x" });

describe("pricing on the term sheet", () => {
  it("uses the term sheet's rate and points in place of the matrix's, and knows the matrix's range around its own rate", () => {
    const app = deal(book()).app;
    const matrix = evaluate(app);
    expect(matrix.rate).toBe(matrix.matrixRate);
    expect(matrix.rateLimits[0]).toBeLessThan(matrix.rate);
    expect(matrix.rateLimits[1]).toBeGreaterThan(matrix.rate);
    const set = evaluate(pricedApp(app, { rate: matrix.rateLimits[1], points: 1.25, termMonths: 9 }));
    expect(set).toMatchObject({ rate: matrix.rateLimits[1], pointsPct: 1.25, termMonths: 9, matrixRate: matrix.matrixRate, rateLimits: matrix.rateLimits });
    expect(set.points).toBeCloseTo((set.noteAmount * 1.25) / 100, 2);
    // A rental's rate moves its payment, and so its DSCR; its term stays the 30-year amortization.
    const rental = demoBook().deals.find((d) => d.app.product === "dscr")!.app;
    const base = evaluate(rental);
    const higher = evaluate(pricedApp(rental, { rate: base.rate + 1, points: base.pointsPct, termMonths: 12 }));
    expect(higher.monthlyPayment).toBeGreaterThan(base.monthlyPayment);
    expect(higher.termMonths).toBe(360);
    // A higher rate can land it in another DSCR column; the room around that column's rate is the same width.
    expect(higher.rateLimits[1] - higher.rateLimits[0]).toBeCloseTo(base.rateLimits[1] - base.rateLimits[0], 6);
  });
  it("says what's outside the matrix, and blocks anything over Florida's criminal usury rate outright", () => {
    const b = book();
    const app = deal(b).app;
    const m = matrixOf(app);
    expect(exceptionReasons(app, terms(b))).toEqual([]);
    expect(exceptionReasons(app, terms(b, { rate: m.rate[0] - 0.25 }))).toEqual([expect.stringMatching(/outside the matrix's/)]);
    expect(exceptionReasons(app, terms(b, { points: m.points[1] + 1 }))).toEqual([expect.stringMatching(/points is outside/)]);
    // A short term spreads the points over fewer months, pushing the all-in cost over the ceiling.
    expect(exceptionReasons(app, terms(b, { points: 6, termMonths: 3 })).join(" ")).toMatch(/all-in cost/);
    const small = { ...app, purchasePrice: 150_000, rehab: 30_000, arv: 240_000, requestedAmount: 120_000 };
    expect(exceptionReasons(small, { ...terms(b), rate: 19 }).join(" ")).toMatch(/usury cap \(Fla\. Stat\. 687\.02\)/);
    expect(termsProblem(app, terms(b, { rate: 25.5 }))).toMatch(/criminal usury/);
    expect(termsProblem(app, terms(b, { termMonths: 40 }))).toMatch(/3 to 36 months/);
  });
});

describe("sending a term sheet", () => {
  it("goes out as version 1 inside the matrix on the underwriter's authority, open for 7 days", () => {
    const b = book();
    const { after, action } = run(b, underwriter, issue(b, { rate: matrixOf(deal(b).app).rate[1] }));
    const sheet = latestSheet(deal(after))!;
    expect(deal(after)).toMatchObject({ status: "term_sheet_issued", app: { termRate: matrixOf(deal(b).app).rate[1] } });
    expect(sheet).toMatchObject({ version: 1, status: "sent", issuedBy: "uw name", issuedOn: "2026-10-31", expiresOn: "2026-11-07", pricingVersion: deal(b).app.pricingVersion });
    expect(sheet.exception).toBeUndefined();
    expect(sheet.conditions.length).toBeGreaterThan(0);
    expect(alertsFor(b, after, action)).toMatchObject([{ to: "borrower", event: "loan.term_sheet_issued", body: expect.stringMatching(/Version 1 .* by November 7, 2026/) }, { to: "broker" }]);
  });
  it("won't go out without the credit review, or as a bare move to the next stage", () => {
    const b = demoBook();
    expect(check(b, owner, issue(b))).toMatchObject({ error: expect.stringMatching(/credit review/) });
    expect(check(book(), owner, { t: "advanceLoan", dealId: "d1" })).toMatchObject({ error: expect.stringMatching(/Term sheet tab/) });
    expect(reducer(book(), { t: "advanceLoan", dealId: "d1" })).toEqual(book());
  });
  it("needs an owner other than whoever asked to approve pricing outside the matrix, and then only those terms", () => {
    const b = book();
    const below = { rate: matrixOf(deal(b).app).rate[0] - 0.5 };
    expect(check(b, underwriter, issue(b, below))).toMatchObject({ error: expect.stringMatching(/needs an owner's approval/) });
    expect(check(b, underwriter, ask(b, below, " "))).toMatchObject({ error: expect.stringMatching(/Say why/) });
    expect(check(b, underwriter, ask(b))).toMatchObject({ error: expect.stringMatching(/inside the matrix/) });
    const asked = run(b, underwriter, ask(b, below));
    expect(deal(asked.after).pricingException).toMatchObject({ status: "pending", requestedBy: "uw name", reasons: [expect.stringMatching(/Rate/)] });
    expect(alertsFor(b, asked.after, asked.action)).toMatchObject([{ to: "team", event: "pricing.exception_requested" }]);
    expect(attentionItems(asked.after, 0).find((item) => item.key === "exceptions")).toMatchObject({ count: 2, href: "/admin" });
    expect(check(asked.after, underwriter, issue(asked.after, below))).toMatchObject({ error: expect.stringMatching(/Waiting for an owner/) });
    const decide = (approve: boolean, note = ""): BookAction => ({ t: "decidePricingException", dealId: "d1", approve, note, by: "x" });
    expect(check(asked.after, underwriter, decide(true))).toHaveProperty("error");
    expect(check(asked.after, owner, decide(false))).toMatchObject({ error: expect.stringMatching(/why it's declined/) });
    const approved = run(asked.after, owner, decide(true, "Fine for a fourth loan")).after;
    expect(deal(approved).pricingException).toMatchObject({ status: "approved", decidedBy: "owner name" });
    expect(check(approved, underwriter, issue(approved, { ...below, points: 0.5 }))).toHaveProperty("error");
    const sent = run(approved, underwriter, issue(approved, below)).after;
    expect(latestSheet(deal(sent))!.exception).toMatchObject({ decidedBy: "owner name", requestedBy: "uw name" });
    expect(deal(sent).pricingException).toBeUndefined();
    // Whoever asks can't approve their own request, owner or not.
    const ownAsk = run(b, owner, ask(b, below)).after;
    expect(check(ownAsk, owner, decide(true))).toMatchObject({ error: expect.stringMatching(/Someone other than whoever asked/) });
    expect(check(ownAsk, owner2, decide(true))).toHaveProperty("action");
  });
});

describe("the borrower's answer", () => {
  const sent = () => run(book(), underwriter, issue(book())).after;
  it("accepting locks the rate and points against later edits", () => {
    const b = sent();
    expect(check(b, person("someone", ["BORROWER"]), { t: "acceptTermSheet", dealId: "d1", signedName: "Alex" })).toHaveProperty("error");
    const { after, action } = run(b, borrower, { t: "acceptTermSheet", dealId: "d1", signedName: "Alex Sample" });
    expect(deal(after)).toMatchObject({ status: "term_sheet_accepted", termSheetSignedBy: "Alex Sample" });
    expect(latestSheet(deal(after))).toMatchObject({ status: "accepted", response: { signedName: "Alex Sample" } });
    expect(alertsFor(b, after, action)[0]).toMatchObject({ to: "team" });
    const rate = deal(after).app.termRate;
    const edited = reducer(after, { t: "updateDealNumbers", dealId: "d1", changes: { termRate: 5, termPoints: 0, pricingVersion: "x", purchasePrice: deal(after).app.purchasePrice + 10_000 } });
    expect(deal(edited).app).toMatchObject({ termRate: rate, pricingVersion: deal(after).app.pricingVersion, purchasePrice: deal(after).app.purchasePrice + 10_000 });
    expect(parseAction({ t: "updateDealNumbers", dealId: "d1", changes: { termRate: 5 } })).toEqual({ t: "updateDealNumbers", dealId: "d1", changes: {} });
  });
  it("asking for changes sends it back to underwriting, and the next version replaces it", () => {
    const b = sent();
    expect(check(b, borrower, { t: "requestTermSheetChanges", dealId: "d1", note: " ", by: "" })).toHaveProperty("error");
    const { after, action } = run(b, borrower, { t: "requestTermSheetChanges", dealId: "d1", note: "Can the points come down to 1.5?", by: "" });
    expect(deal(after).status).toBe("underwriting");
    expect(latestSheet(deal(after))).toMatchObject({ status: "changes_requested", response: { by: `${BORROWER_ID} name`, note: "Can the points come down to 1.5?" } });
    expect(alertsFor(b, after, action)).toMatchObject([{ to: "team", event: "loan.term_sheet_changes", body: expect.stringMatching(/points come down/) }]);
    const next = run(after, underwriter, issue(after, { points: matrixOf(deal(after).app).points[0] })).after;
    expect(deal(next).termSheets!.map((sheet) => [sheet.version, sheet.status])).toEqual([[1, "changes_requested"], [2, "sent"]]);
    // The borrower and their broker only ever see the newest, without the team's pricing room or who sent it.
    const mine = scopeBook(next, borrower).deals.find((d) => d.id === "d1")!;
    expect(mine.termSheets).toHaveLength(1);
    expect(mine.termSheets![0]).toMatchObject({ version: 2, issuedBy: "", matrix: { rate: [0, 0] } });
    expect(scopeBook(next, borrower).deals.find((d) => d.id === "d5")).toBeUndefined();
  });
  it("declining withdraws the application, and reopening it goes back to underwriting for a new one", () => {
    const b = sent();
    const { after } = run(b, borrower, { t: "closeApplication", dealId: "d1", outcome: "withdrawn", reason: "terms", note: "Went with a lower rate", by: "", byTeam: false });
    expect(deal(after).status).toBe("withdrawn");
    expect(latestSheet(deal(after))).toMatchObject({ status: "declined", response: { note: "Went with a lower rate" } });
    const reopened = run(after, owner, { t: "reopenApplication", dealId: "d1", by: "x" }).after;
    expect(deal(reopened).status).toBe("underwriting");
  });
  it("hides an exception and the matrix from everyone outside the team", () => {
    const b = demoBook();
    const partnerView = scopeBook(b, person(DEMO_PARTNER_ID, ["PARTNER_LENDER"])).deals;
    expect(partnerView.length).toBeGreaterThan(0);
    expect(partnerView.every((d) => !d.pricingException && (d.termSheets ?? []).every((sheet) => sheet.matrix.rate[0] === 0 && !sheet.exception && !sheet.issuedBy))).toBe(true);
    expect(scopeBook(b, owner).deals.find((d) => d.id === "d5")!.pricingException).toMatchObject({ status: "pending" });
  });
});

describe("expiry", () => {
  it("can't be answered after its last day, and the nightly check reminds two days ahead and then expires it", () => {
    // Only d1's term sheet, so the demo book's own don't come up in the nightly check.
    const start = book();
    const only = { ...start, deals: start.deals.map((d) => (d.id === "d1" ? d : { ...d, termSheets: undefined })) };
    const b = run(only, underwriter, issue(only)).after;
    const sheet = latestSheet(deal(b))!;
    expect(respondProblem(deal(b), sheet.expiresOn)).toBeNull();
    expect(respondProblem(deal(b), "2026-11-08")).toMatch(/expired on 2026-11-07/);
    const nightly = (asOf: string): BookAction => ({ t: "checkTermSheets", asOf });
    expect(check(b, owner, nightly("2026-11-05"))).toHaveProperty("error");
    expect(reducer(b, nightly("2026-11-02"))).toBe(b);
    const reminded = run(b, system, nightly("2026-11-05"), true);
    expect(latestSheet(deal(reminded.after))!.remindedOn).toBe("2026-11-05");
    expect(alertsFor(b, reminded.after, reminded.action).filter((alert) => alert.event === "loan.term_sheet_expiring").map((alert) => alert.to)).toEqual(["borrower", "broker"]);
    expect(reducer(reminded.after, nightly("2026-11-06"))).toBe(reminded.after);
    const expired = run(reminded.after, system, nightly("2026-11-08"), true);
    expect(deal(expired.after).status).toBe("underwriting");
    expect(latestSheet(deal(expired.after))!.status).toBe("expired");
    expect(alertsFor(reminded.after, expired.after, expired.action).filter((alert) => alert.event === "loan.term_sheet_expired").map((alert) => alert.to)).toEqual(["borrower", "broker", "team"]);
    expect(parseAction(nightly("2026-11-08"))).toBeNull();
  });
});

describe("the term sheet document", () => {
  it("says what was offered, as it was sent, and isn't a commitment to lend", async () => {
    const b = run(book(), underwriter, issue(book(), { prepay: "min3" })).after;
    const d: Deal = deal(b);
    const content = sheetContent(d, latestSheet(d)!);
    const words = JSON.stringify(content);
    expect(content.terms.find(([label]) => label === "Prepayment")?.[1]).toBe("3 months' minimum interest");
    expect(content.terms.find(([label]) => label === "Interest rate")?.[1]).toMatch(/a year, interest only/);
    expect(words).toMatch(/isn't a commitment to lend/);
    expect(words).not.toMatch(/matrix/i);
    expect(content.signature).toBe("Not accepted yet.");
    const bytes = await termSheetPdf(content);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
