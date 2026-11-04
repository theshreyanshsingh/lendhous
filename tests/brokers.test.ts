import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { brokerQuoteContent } from "@/lib/broker-quote";
import { applicationProblem, approveProblem, feeOf, feePaidProblem, referralCodeFor, referralHolds, type ApplicationInput } from "@/lib/brokers";
import { evaluate } from "@/lib/engine";
import type { Screening } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { businessReport } from "@/lib/reports";
import { taxYear } from "@/lib/tax-forms";
import { exceptionReasons, issueProblem, sheetContent, draftSheet } from "@/lib/term-sheets";
import { spreadRate, usuryCheck, usuryWarning } from "@/lib/usury";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const allowedFor = (viewer: Viewer) => (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer });
const check = (book: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(book, viewer, action, allowedFor(viewer), trusted);
const owner = person("owner", ["ADMIN_OWNER"]);
const underwriter = person("uw", ["UNDERWRITER"]);
const brokerUser = person("bea", ["BROKER"], "firm-1");

const input = (changes: Partial<ApplicationInput> = {}): ApplicationInput => ({ legalName: "Bright Path Capital LLC", entityState: "FL", principals: ["Bea Broker", "Ben Partner"], nmls: "", license: "", signedName: "Bea Broker", ...changes });
const clear = (status: Screening["status"] = "clear"): Screening => ({ id: "s1", at: "2026-11-01T12:00:00Z", by: "Broker application", checkedAt: "2026-11-01T12:00:00Z", list: { fetchedAt: "2026-11-01T00:00:00Z", names: 100 }, subjects: [{ name: "Bright Path Capital LLC", role: "entity", hits: status === "review" ? [{ uid: 1, name: "Bright Pathe", type: "Entity", program: "SDGT", score: 0.9 }] : [] }], status });
const applied = (screening?: Screening): Book => reducer({ ...demoBook(), brokers: [] }, { t: "brokerApplied", brokerId: "firm-1", application: { ...input(), agreementVersion: "v1", signedAt: "2026-11-01T12:00:00Z", ip: "1.2.3.4" }, docs: [{ kind: "articles", documentId: "doc-1", fileName: "articles.pdf", at: "2026-11-01T12:00:00Z" }], ...(screening ? { screening } : {}) });

describe("signing up a brokerage", () => {
  it("needs the firm, its owners, the agreement and an owner's signature", () => {
    expect(applicationProblem(input(), true)).toBeNull();
    expect(applicationProblem(input({ legalName: " " }), true)).toMatch(/legal name/);
    expect(applicationProblem(input({ entityState: "Florida" }), true)).toMatch(/state/);
    expect(applicationProblem(input({ principals: [] }), true)).toMatch(/owners and officers/);
    expect(applicationProblem(input({ nmls: "12a" }), true)).toMatch(/NMLS/);
    expect(applicationProblem(input(), false)).toMatch(/agree/);
    expect(applicationProblem(input({ signedName: "Somebody Else" }), true)).toMatch(/one of the owners/);
    expect(applicationProblem(input({ signedName: " ben  partner " }), true)).toBeNull();
  });
  it("waits for an owner, who approves it once the OFAC check is clear or explained", () => {
    expect(approveProblem(undefined, "")).toMatch(/hasn't signed/);
    expect(approveProblem(applied().brokers[0], "")).toMatch(/Screen it/);
    expect(approveProblem(applied(clear("match")).brokers[0], "")).toMatch(/can't work with it/);
    expect(approveProblem(applied(clear("review")).brokers[0], "")).toMatch(/possible match/);
    expect(approveProblem(applied(clear("review")).brokers[0], "Different firm, Delaware")).toBeNull();
    const book = applied(clear("review"));
    expect(book.brokers[0]).toMatchObject({ id: "firm-1", name: "Bright Path Capital LLC", status: "applied" });
    // Only the server's application step records it, and only someone who approves brokers approves it.
    const apply = { t: "brokerApplied" as const, brokerId: "firm-1", application: book.brokers[0].application!, docs: [] };
    expect(check(book, brokerUser, apply)).toHaveProperty("error");
    expect(check(book, brokerUser, apply, true)).toHaveProperty("action");
    const approve = { t: "approveBroker" as const, brokerId: "firm-1", reason: "Different firm, Delaware", by: "anyone" };
    expect(check(book, underwriter, approve)).toHaveProperty("error");
    const ok = check(book, owner, approve) as { action: BookAction };
    expect(ok.action).toMatchObject({ by: "owner name" });
    const after = reducer(book, ok.action);
    expect(after.brokers[0]).toMatchObject({ status: "approved", approved: { by: "owner name", reason: "Different firm, Delaware" }, screening: { status: "cleared", decided: { reason: "Different firm, Delaware" } } });
    expect(after.brokers[0].referralCode).toMatch(/^[a-z2-9]{8}$/);
    // Signing again keeps it approved; a suspension stops it.
    expect(reducer(after, apply).brokers[0].status).toBe("approved");
    expect(check(after, owner, { t: "suspendBroker", brokerId: "firm-1", reason: " ", by: "" })).toHaveProperty("error");
    const suspended = reducer(after, { t: "suspendBroker", brokerId: "firm-1", reason: "Misstated occupancy", by: "Olive" });
    expect(suspended.brokers[0]).toMatchObject({ status: "suspended", suspended: { reason: "Misstated occupancy" } });
  });
  it("a broker sees its own firm, not the sanctions check or who approved it", () => {
    const book = reducer(applied(clear()), { t: "approveBroker", brokerId: "firm-1", reason: "", by: "Olive" });
    const mine = scopeBook(book, brokerUser).brokers;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: "firm-1", status: "approved", application: { legalName: "Bright Path Capital LLC" } });
    expect(mine[0]).not.toHaveProperty("screening");
    expect(mine[0]).not.toHaveProperty("approved");
    expect(scopeBook(applied(), person("other", ["BROKER"], "firm-2")).brokers).toEqual([{ id: "firm-2", name: "other name" }]);
  });
});

describe("broker fees", () => {
  const book = demoBook();
  const d3 = book.deals.find((deal) => deal.id === "d3")!;
  const d10 = book.deals.find((deal) => deal.id === "d10")!;
  it("are expected until the loan funds, then unpaid until recorded paid", () => {
    expect(feeOf(d3)).toEqual({ amount: Math.round(evaluate(d3.app).noteAmount) / 100, state: "expected" });
    expect(feeOf(d10).state).toBe("unpaid");
    expect(feeOf({ ...d10, brokerFeePaid: { amount: 3000, on: "2026-02-20", reference: "", by: "Uma", at: "" } })).toEqual({ amount: 3000, state: "paid" });
    expect(feeOf({ ...d3, status: "declined" }).state).toBe("none");
    expect(feeOf({ ...d3, brokerPoints: 0 }).state).toBe("none");
  });
  it("are recorded paid once the loan funds, on a real day", () => {
    expect(feePaidProblem(d3, 1000, "2026-10-01", "2026-10-31")).toMatch(/once the loan funds/);
    expect(feePaidProblem(d10, 0, "2026-10-01", "2026-10-31")).toMatch(/amount/);
    expect(feePaidProblem(d10, 1000, "2026-11-30", "2026-10-31")).toMatch(/today or before/);
    expect(feePaidProblem(d10, 1000, "2026-01-01", "2026-10-31")).toMatch(/before the loan closed/);
    expect(feePaidProblem(d10, 1000, "2026-02-21", "2026-10-31")).toBeNull();
    const paid = reducer(book, { t: "brokerFeePaid", dealId: "d10", amount: 3150.004, on: "2026-02-21", reference: "HUD line 802", by: "Uma" });
    expect(paid.deals.find((deal) => deal.id === "d10")?.brokerFeePaid).toMatchObject({ amount: 3150, on: "2026-02-21", reference: "HUD line 802" });
    expect(check(paid, owner, { t: "brokerFeePaid", dealId: "d10", amount: 1, on: "2026-02-21", reference: "", by: "" })).toEqual({ error: expect.stringMatching(/already/) });
    expect(check(book, underwriter, { t: "brokerFeePaid", dealId: "d10", amount: 1, on: "2026-02-21", reference: "", by: "" })).toHaveProperty("error");
  });
  it("count toward the 1099-NEC in the year they're paid", () => {
    const paidIn = (on: string) => ({ ...book, deals: book.deals.map((deal) => (deal.id === "d10" ? { ...deal, brokerFeePaid: { amount: 3150, on, reference: "", by: "Uma", at: "" } } : deal)) });
    expect(taxYear(paidIn("2026-02-21"), 2026, () => null).lines.find((line) => line.form === "1099-NEC")?.amount).toBe(3150);
    expect(taxYear(paidIn("2027-01-05"), 2026, () => null).lines.some((line) => line.form === "1099-NEC")).toBe(false);
    // A broker with no firm record still gets one.
    const nameless = { ...book, brokers: [] };
    expect(taxYear(nameless, 2026, () => null).lines.find((line) => line.form === "1099-NEC")?.name).toBe("Broker (no firm record)");
  });
  it("are set in points before the term sheet, and shown on it", () => {
    const d1 = { ...book.deals.find((deal) => deal.id === "d1")!, brokerId: "brk-demo" };
    const withBroker = { ...book, deals: book.deals.map((deal) => (deal.id === "d1" ? d1 : deal)) };
    expect(check(withBroker, owner, { t: "setBrokerPoints", dealId: "d1", points: 6 })).toEqual({ error: expect.stringMatching(/0 to 5/) });
    expect(check(withBroker, owner, { t: "setBrokerPoints", dealId: "d10", points: 1 })).toEqual({ error: expect.stringMatching(/before the term sheet/) });
    const set = reducer(withBroker, { t: "setBrokerPoints", dealId: "d1", points: 1.5 });
    const deal = { ...set.deals.find((item) => item.id === "d1")!, creditReview: { by: "u", at: "", note: "", verifiedDeals: 2 } };
    const sheet = draftSheet(deal, { rate: 11, points: 2, termMonths: 12, prepay: "none" }, "Uma", "2026-10-31", "2026-10-31T12:00:00Z");
    expect(sheet.terms).toMatchObject({ brokerPoints: 1.5 });
    expect(sheetContent(deal, sheet).terms.find(([label]) => label === "Broker's fee")?.[1]).toMatch(/^1\.5% \(\$[\d,]+\.\d\d\), paid by the borrower/);
  });
});

describe("Florida usury with points spread over the term", () => {
  it("spreads points over the term and counts the broker's both ways", () => {
    expect(spreadRate(11, 3, 6)).toBe(17);
    const check6 = usuryCheck({ amount: 300_000, rate: 12, points: 3, brokerPoints: 2, termMonths: 6 });
    expect(check6).toMatchObject({ limit: 18, lender: 18, withBroker: 22, overLender: false, overWithBroker: true, criminal: false });
    expect(usuryWarning(check6, 6, 2)).toMatch(/broker's 2 points.*22\.00% a year.*18% cap/);
    expect(usuryCheck({ amount: 600_000, rate: 12, points: 5, termMonths: 6 })).toMatchObject({ limit: 25, lender: 22, overLender: false });
    expect(usuryWarning(usuryCheck({ amount: 300_000, rate: 11, points: 2, termMonths: 12 }), 12)).toBeNull();
  });
  it("needs an owner's approval over the cap, and can't go out over 25%", () => {
    const deal = { ...demoBook().deals.find((item) => item.id === "d1")!, creditReview: { by: "u", at: "", note: "", verifiedDeals: 2 } };
    expect(exceptionReasons(deal.app, { rate: 12, points: 4, termMonths: 6, prepay: "none" }).some((reason) => reason.startsWith("Rate plus points comes to 20.00% a year"))).toBe(true);
    expect(exceptionReasons(deal.app, { rate: 11, points: 2, termMonths: 12, prepay: "none" }).some((reason) => reason.startsWith("Rate plus points"))).toBe(false);
    expect(issueProblem(deal, { rate: 15, points: 6, termMonths: 3, prepay: "none" })).toMatch(/criminal usury/);
  });
});

describe("referrals", () => {
  it("a referral code is short, stable and unambiguous, and holds for the protection window", () => {
    expect(referralCodeFor("firm-1")).toBe(referralCodeFor("firm-1"));
    expect(referralCodeFor("firm-1")).not.toBe(referralCodeFor("firm-2"));
    expect(referralCodeFor("firm-1")).toMatch(/^[a-z2-9]{8}$/);
    expect(referralHolds("2026-01-15", "2027-01-15")).toBe(true);
    expect(referralHolds("2026-01-15", "2027-01-16")).toBe(false);
  });
  it("a referred loan is the broker's, and so is the borrower's next one inside the window", () => {
    const base = demoBook();
    expect(check(base, owner, { t: "referLoan", dealId: "d2", brokerId: "brk-demo", on: "2026-08-01" })).toHaveProperty("error");
    const referred = reducer(base, { t: "referLoan", dealId: "d2", brokerId: "brk-demo", on: "2026-08-01" });
    expect(referred.deals.find((deal) => deal.id === "d2")).toMatchObject({ brokerId: "brk-demo", referredBy: { brokerId: "brk-demo", on: "2026-08-01" } });
    const app = base.deals.find((deal) => deal.id === "d1")!.app;
    const next = (book: Book) => { const after = reducer(book, { t: "submitApp", app, address: "1 Next St", city: "Hollywood", zip: "33020", entityName: "Sample Flips LLC (FAKE)", exitStrategy: "Sell" }); return after.deals[0]; };
    expect(next(referred)).toMatchObject({ brokerId: "brk-demo", referredBy: { brokerId: "brk-demo", on: "2026-08-01" } });
    const old = reducer(base, { t: "referLoan", dealId: "d2", brokerId: "brk-demo", on: "2025-09-01" });
    expect(next(old).brokerId).toBeUndefined();
  });
  it("the reports count brokered loans and referrals by brokerage", () => {
    const book = reducer(demoBook(), { t: "referLoan", dealId: "d1", brokerId: "brk-demo", on: "2026-10-01" });
    const report = businessReport(book, { from: "2026-01-01", to: "2026-12-31" }, "2026-10-31");
    const demo = report.pipeline.byBroker.find((row) => row.name === "Demo Brokerage (FAKE)");
    expect(demo).toBeDefined();
    expect(demo!.funded).toBeGreaterThanOrEqual(1);
    expect(demo!.fees).toBeGreaterThan(0);
  });
});

describe("a broker's quote for a client", () => {
  it("has the brokerage's name, LendHous as the lender, the fee, and says it isn't a commitment", () => {
    const app = { ...demoBook().deals[0].app, pricingVersion: undefined };
    const quote = brokerQuoteContent({ app, broker: "Bright Path Capital LLC", client: "Casey Client", brokerPoints: 1, address: "1 Main St, Miami", today: "2026-11-04" });
    expect(quote.subtitle).toBe("Prepared by Bright Path Capital LLC for Casey Client · November 4, 2026");
    expect(quote.facts).toContainEqual(["Lender", "LendHous"]);
    expect(quote.terms.find(([label]) => label === "Broker's fee")?.[1]).toMatch(/^1% .* paid by the borrower to Bright Path Capital LLC/);
    expect(quote.paragraphs.join(" ")).toMatch(/not a commitment to lend/);
    expect(quote.paragraphs.join(" ")).toMatch(/can't approve a loan/);
  });
});
