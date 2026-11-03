import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attentionCounts } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { defaultScope } from "@/lib/draws";
import { evaluate, fundedBalances } from "@/lib/engine";
import { executeError, extensionFee, lienReleaseDue, payoffOn } from "@/lib/loan-exits";
import { nextStage } from "@/lib/loan-stages";
import { seedDeals, type Deal, type LoanExtension, type LoanPayment } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { ledgerOf, maturityOf, payoffFor, settle } from "@/lib/servicing";

// A fix and flip that closed January 15, 2026: payments are due the 1st, and it matures January 15, 2027. Everything due
// before December 1 was paid before payments were recorded here, so on November 3 it's current.
const loan = (changes: Partial<Deal> = {}): Deal => {
  const base = seedDeals.find((item) => item.id === "d9")!;
  const e = evaluate(base.app);
  return { ...base, id: "L1", borrowerId: "borrower-1", brokerId: undefined, scope: defaultScope(base.app.product, e.holdback, 0), allocations: [{ sourceId: "gt-main", amount: e.noteAmount }], capitalStatus: "funded", closingDate: "2026-01-15", status: "servicing_current", boardedThrough: "2026-12-01", nextPaymentDue: "2026-12-01", paymentsLate: 0, ...changes };
};
const NOTE = evaluate(loan().app).noteAmount;
const A = fundedBalances(evaluate(loan().app), loan().app, loan().disbursedDraws).nextPayment;
const application = (changes: Partial<Deal> = {}) => loan({ status: "underwriting", capitalStatus: "reserved", boardedThrough: undefined, nextPaymentDue: undefined, ...changes });
const book = (deal: Deal, extra: Partial<Book> = {}): Book => ({ ...emptyBook(), deals: [deal], ...extra });

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }));
const owner = person("owner", ["ADMIN_OWNER"]);
const underwriter = person("uw", ["UNDERWRITER"]);
const processor = person("proc", ["PROCESSOR"]);
const servicer = person("servicer", ["SERVICER"]);
const borrower = person("borrower-1", ["BORROWER"]);
let n = 0;
const paid = (amount: number, receivedOn: string): LoanPayment => ({ id: `p${++n}`, amount, receivedOn, method: "wire", reference: `w${n}`, by: "Sam", at: `${receivedOn}T12:00:00Z` });
// Runs an action the way the server does: checked first, then applied to the book.
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T17:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("declining or withdrawing an application", () => {
  const decline: BookAction = { t: "closeApplication", dealId: "L1", outcome: "declined", reason: "liquidity", note: "Only $20k verified, needs $60k", by: "x", byTeam: false };
  const withdraw: BookAction = { ...decline, outcome: "withdrawn", reason: "other_lender", note: "" };
  it("lets someone with term sheet authority decline it, and lets the processor or the borrower withdraw it", () => {
    expect(check(book(application()), underwriter, decline)).toMatchObject({ action: { by: "uw name", byTeam: true } });
    expect(check(book(application()), processor, decline)).toHaveProperty("error");
    expect(check(book(application()), processor, withdraw)).toHaveProperty("action");
    expect(check(book(application()), borrower, withdraw)).toMatchObject({ action: { by: "borrower-1 name", byTeam: false } });
    expect(check(book(application()), borrower, decline)).toHaveProperty("error");
    expect(check(book(application()), person("someone-else", ["BORROWER"]), withdraw)).toHaveProperty("error");
  });
  it("needs a reason from the right list, and only before funding", () => {
    expect(check(book(application()), owner, { ...decline, reason: "other_lender" })).toMatchObject({ error: "Choose a reason." });
    expect(check(book(loan()), owner, decline)).toMatchObject({ error: expect.stringMatching(/payoff/) });
    expect(parseAction({ ...decline, reason: "" })).toBeNull();
  });
  it("lets go of its capital and bids, turns off its photo links, and has no next step", () => {
    const start = book(application(), {
      bids: [{ id: "b1", dealId: "L1", partnerId: "p-a", pct: 100, lenderRate: 10, lenderPoints: 1, conditions: "", status: "submitted", type: "bid", at: "2026-11-01T00:00:00Z" }],
      photoRequests: [{ id: "r1", dealId: "L1", to: "Joe", who: "contractor", scopeIds: [], sentBy: "uw", sentAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z", status: "open", photos: [] }],
    });
    const { after } = run(start, underwriter, decline);
    const deal = after.deals[0];
    expect(deal).toMatchObject({ status: "declined", capitalStatus: "not_started", allocations: [], closure: { outcome: "declined", reason: "liquidity", from: "underwriting", by: "uw name" } });
    expect(after.bids[0].status).toBe("declined");
    expect(after.photoRequests[0].status).toBe("off");
    expect(nextStage(deal, evaluate(deal.app))).toBeNull();
    expect(reducer(after, { t: "advanceLoan", dealId: "L1" })).toBe(after);
  });
  it("tells the borrower and broker it was declined but not why, and the team when the borrower withdraws", () => {
    const start = book(application({ brokerId: "brk-a" }));
    const declined = run(start, underwriter, decline);
    const told = alertsFor(start, declined.after, declined.action);
    expect(told.map((alert) => [alert.to, alert.event])).toEqual([["borrower", "loan.declined"], ["broker", "loan.declined"]]);
    expect(JSON.stringify(told)).not.toMatch(/cash|20k|liquidity/i);
    const withdrawn = run(start, borrower, withdraw);
    expect(alertsFor(start, withdrawn.after, withdrawn.action).map((alert) => alert.to)).toEqual(["team", "broker"]);
    const forThem = run(start, processor, withdraw);
    expect(alertsFor(start, forThem.after, forThem.action).map((alert) => alert.to)).toEqual(["borrower", "broker"]);
  });
  it("keeps the team's reason and notes from the borrower", () => {
    const { after } = run(book(application()), underwriter, decline);
    const seen = scopeBook(after, borrower).deals[0];
    expect(seen.closure).toMatchObject({ outcome: "declined", reason: "", note: "", by: "" });
    const withdrawn = run(book(application()), borrower, withdraw).after;
    expect(scopeBook(withdrawn, borrower).deals[0].closure).toMatchObject({ reason: "other_lender" });
  });
  it("reopens where it was, or at conditions once its capital had been lined up", () => {
    const declined = run(book(application()), underwriter, decline).after;
    expect(check(declined, processor, { t: "reopenApplication", dealId: "L1", by: "x" })).toHaveProperty("error");
    expect(run(declined, owner, { t: "reopenApplication", dealId: "L1", by: "x" }).after.deals[0]).toMatchObject({ status: "underwriting", closure: undefined });
    const late = run(book(application({ status: "clear_to_close", capitalStatus: "committed" })), owner, decline).after;
    expect(run(late, owner, { t: "reopenApplication", dealId: "L1", by: "x" }).after.deals[0]).toMatchObject({ status: "conditions", capitalStatus: "not_started" });
  });
});

describe("declaring and curing a default", () => {
  // Missed the November payment: on November 20 it's late with a fee.
  const behind = (changes: Partial<Deal> = {}) => loan({ boardedThrough: "2026-11-01", ...changes });
  const declare = (changes: Partial<Extract<BookAction, { t: "declareDefault" }>> = {}): BookAction => ({ t: "declareDefault", dealId: "L1", kind: "monetary", effectiveOn: "2026-11-15", note: "Notice sent by counsel 11/15", by: "x", ...changes });
  it("is the owner's decision, not servicing's", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    expect(check(book(behind()), servicer, declare())).toMatchObject({ error: expect.stringMatching(/can't do that/) });
    expect(check(book(behind()), owner, declare())).toMatchObject({ action: { by: "owner name" } });
  });
  it("fits what's actually wrong, and can't be dated in the future or before closing", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    expect(check(book(loan()), owner, declare())).toMatchObject({ error: expect.stringMatching(/No payment is late/) });
    expect(check(book(loan()), owner, declare({ kind: "maturity" }))).toMatchObject({ error: expect.stringMatching(/hasn't matured/) });
    expect(check(book(loan()), owner, declare({ kind: "insurance_lapse" }))).toHaveProperty("action");
    expect(check(book(behind()), owner, declare({ effectiveOn: "2026-12-01" }))).toMatchObject({ error: expect.stringMatching(/future/) });
    expect(check(book(behind()), owner, declare({ effectiveOn: "2026-01-01" }))).toMatchObject({ error: expect.stringMatching(/before the loan closed/) });
  });
  it("stays in default whatever the payments do, and charges default interest from the effective date", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    const { after } = run(book(behind()), owner, declare());
    const deal = after.deals[0];
    expect(deal).toMatchObject({ status: "default", defaults: [{ kind: "monetary", effectiveOn: "2026-11-15", by: "owner name" }] });
    const quote = payoffFor(deal, "2026-12-15");
    expect(quote.defaultAccrued).toBeGreaterThan(0);
    expect(payoffFor(behind(), "2026-12-15").defaultAccrued).toBe(0);
    expect(quote.total).toBeGreaterThan(payoffFor(behind(), "2026-12-15").total);
    expect(settle({ ...deal, payments: [paid(A * 2, "2026-11-20")] }, "2026-11-21").status).toBe("default");
  });
  it("can be cured only once nothing is owed, and then goes back to what the payments say", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    const declared = run(book(behind()), owner, declare()).after;
    const cure: BookAction = { t: "cureDefault", dealId: "L1", note: "Paid in full 11/20", by: "x" };
    expect(check(declared, owner, cure)).toMatchObject({ error: expect.stringMatching(/still owed/) });
    const fee = ledgerOf(declared.deals[0], "2026-11-20").feesOwed;
    const caughtUp = reducer(declared, { t: "recordPayment", dealId: "L1", amount: A + fee, receivedOn: "2026-11-20", method: "wire", reference: "CURE", by: "Sam" });
    expect(caughtUp.deals[0].status).toBe("default");
    const { after, action } = run(caughtUp, owner, cure);
    expect(after.deals[0].status).toBe("servicing_current");
    expect(after.deals[0].defaults![0].cured).toMatchObject({ by: "owner name", note: "Paid in full 11/20" });
    expect(payoffFor(after.deals[0], "2026-12-15").defaultAccrued).toBe(0);
    expect(alertsFor(caughtUp, after, action).map((alert) => alert.event)).toContain("loan.default_cured");
  });
  it("tells the borrower, the team and whoever holds part of the loan", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    const held = book(behind({ allocations: [{ sourceId: "partner:p-a", amount: NOTE }] }));
    const { after, action } = run(held, owner, declare());
    expect(alertsFor(held, after, action).map((alert) => [alert.to, alert.firmId])).toEqual([["borrower", undefined], ["team", undefined], ["partner", "p-a"]]);
  });
});

describe("extending a loan", () => {
  const ask = (changes: Partial<Extract<BookAction, { t: "requestExtension" }>> = {}): BookAction => ({ t: "requestExtension", dealId: "L1", months: 3, reason: "Listing in February", by: "x", byTeam: false, ...changes });
  const approve = (extensionId: string): BookAction => ({ t: "approveExtension", dealId: "L1", extensionId, by: "x" });
  const sign = (extensionId: string, on = "2026-11-20"): BookAction => ({ t: "executeExtension", dealId: "L1", extensionId, on, method: "wire", reference: "EXT-1", by: "x" });
  const approved = (deal: Deal) => {
    let b = run(book(deal), owner, ask()).after;
    const id = b.deals[0].extensions![0].id;
    b = run(b, underwriter, approve(id)).after;
    b = run(b, owner, approve(id)).after;
    return { b, id };
  };
  it("lets the borrower ask from 60 days before maturity, and the team at any time", () => {
    expect(check(book(loan()), borrower, ask())).toMatchObject({ error: expect.stringMatching(/from 2026-11-16/) });
    expect(check(book(loan()), servicer, ask())).toMatchObject({ action: { byTeam: true } });
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    expect(check(book(loan()), borrower, ask())).toMatchObject({ action: { by: "borrower-1 name", byTeam: false } });
    expect(check(book(loan()), borrower, ask({ months: 4 }))).toMatchObject({ error: expect.stringMatching(/1 to 3 months/) });
  });
  it("charges a point of the note for three months, prorated", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    expect(extensionFee(loan(), 3)).toBeCloseTo(NOTE * 0.01, 2);
    expect(extensionFee(loan(), 1)).toBeCloseTo(NOTE * 0.01 / 3, 2);
    const asked = run(book(loan()), borrower, ask()).after.deals[0].extensions![0];
    expect(asked).toMatchObject({ months: 3, fromMaturity: "2027-01-15", status: "requested", fee: extensionFee(loan(), 3) });
    expect(check(run(book(loan()), borrower, ask()).after, borrower, ask())).toMatchObject({ error: expect.stringMatching(/already being looked at/) });
  });
  it("takes two different approvers who hold extension authority", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    const asked = run(book(loan()), borrower, ask()).after;
    const id = asked.deals[0].extensions![0].id;
    expect(check(asked, servicer, approve(id))).toHaveProperty("error");
    const once = run(asked, underwriter, approve(id));
    expect(once.after.deals[0].extensions![0]).toMatchObject({ status: "requested", approvers: ["uw name"] });
    expect(alertsFor(asked, once.after, once.action)).toEqual([]);
    expect(check(once.after, underwriter, approve(id))).toMatchObject({ error: expect.stringMatching(/second, different/) });
    const twice = run(once.after, owner, approve(id));
    expect(twice.after.deals[0].extensions![0].status).toBe("approved");
    expect(alertsFor(once.after, twice.after, twice.action)).toMatchObject([{ to: "borrower", event: "extension.approved", body: expect.stringMatching(/April 15, 2027/) }]);
    expect(check(twice.after, servicer, sign(id))).toHaveProperty("action");
  });
  it("moves the maturity once it's signed, and only when the loan is current", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    const { b, id } = approved(loan({ boardedThrough: "2026-11-01" }));
    expect(check(b, servicer, sign(id))).toMatchObject({ error: expect.stringMatching(/Bring the loan current/) });
    const caughtUp = reducer(b, { t: "recordPayment", dealId: "L1", amount: A + ledgerOf(b.deals[0], "2026-11-20").feesOwed, receivedOn: "2026-11-20", method: "wire", reference: "", by: "Sam" });
    const { after, action } = run(caughtUp, servicer, sign(id));
    const deal = after.deals[0];
    expect(maturityOf(deal)).toBe("2027-04-15");
    expect(deal.extensions![0]).toMatchObject({ status: "executed", executed: { on: "2026-11-20", reference: "EXT-1", by: "servicer name" } });
    expect(ledgerOf(deal, "2027-03-02").rows.map((row) => row.due).slice(-3)).toEqual(["2027-02-01", "2027-03-01", "2027-04-01"]);
    expect(alertsFor(caughtUp, after, action).map((alert) => alert.event)).toEqual(["extension.executed", "extension.executed"]);
  });
  it("brings a matured loan back, cures a maturity default, and doesn't charge late fees for months it adds after the fact", () => {
    // Paid through January, past maturity on February 10 and declared in default.
    vi.setSystemTime(new Date("2027-02-10T17:00:00Z"));
    const matured = settle(loan({ boardedThrough: "2027-02-01" }), "2027-02-10");
    expect(matured.status).toBe("matured");
    const inDefault = run(book(matured), owner, { t: "declareDefault", dealId: "L1", kind: "maturity", effectiveOn: "2027-01-20", note: "Maturity default", by: "x" }).after;
    expect(payoffFor(inDefault.deals[0], "2027-02-10").defaultAccrued).toBeGreaterThan(0);
    let b = run(inDefault, servicer, { t: "requestExtension", dealId: "L1", months: 3, reason: "Refinance closing in March", by: "x", byTeam: true }).after;
    const id = b.deals[0].extensions![0].id;
    b = run(run(b, underwriter, approve(id)).after, owner, approve(id)).after;
    vi.setSystemTime(new Date("2027-02-25T17:00:00Z"));
    const signed = run(b, servicer, sign(id, "2027-02-25")).after.deals[0];
    expect(signed.status).toBe("servicing_current");
    expect(signed.defaults![0].cured?.note).toMatch(/extension/);
    expect(maturityOf(signed)).toBe("2027-04-15");
    // The February 1 payment only became owed when it was signed, so it isn't late until its grace days from then pass.
    const feb = ledgerOf(signed, "2027-03-01").rows.find((row) => row.due === "2027-02-01")!;
    expect(feb).toMatchObject({ status: "due", late: false, fee: 0 });
    expect(ledgerOf(signed, "2027-03-08").rows.find((row) => row.due === "2027-02-01")!.late).toBe(true);
    expect(payoffFor(signed, "2027-03-01").defaultAccrued).toBe(0);
  });
  it("allows two extensions at most", () => {
    const used: LoanExtension[] = [1, 2].map((index) => ({ id: `e${index}`, months: 3, reason: "", requestedBy: "", requestedAt: "2026-10-01T00:00:00Z", fee: 1, fromMaturity: "2027-01-15", status: "executed", approvers: ["a", "b"], executed: { by: "", at: "", on: "2026-10-02", method: "wire", reference: "" } }));
    expect(check(book(loan({ extensions: used })), servicer, ask({ byTeam: true }))).toMatchObject({ error: expect.stringMatching(/most extensions allowed \(2\)/) });
    expect(maturityOf(loan({ extensions: used }))).toBe("2027-07-15");
  });
  it("can be declined with a reason the borrower sees", () => {
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    const asked = run(book(loan()), borrower, ask()).after;
    const id = asked.deals[0].extensions![0].id;
    const { after, action } = run(asked, underwriter, { t: "declineExtension", dealId: "L1", extensionId: id, reason: "Project is only 20% done", by: "x" });
    expect(after.deals[0].extensions![0]).toMatchObject({ status: "declined", declined: { by: "uw name", reason: "Project is only 20% done" } });
    expect(executeError(after.deals[0], after.deals[0].extensions![0], "2026-11-20", "2026-11-20")).toMatch(/closed/);
    expect(alertsFor(asked, after, action)).toMatchObject([{ to: "borrower", body: expect.stringMatching(/20% done/) }]);
    expect(scopeBook(after, borrower).deals[0].extensions![0].declined).toMatchObject({ by: "", reason: "Project is only 20% done" });
  });
});

describe("paying a loan off", () => {
  const payoff = (changes: Partial<Extract<BookAction, { t: "recordPayoff" }>> = {}): BookAction => ({ t: "recordPayoff", dealId: "L1", amount: 0, receivedOn: "2026-11-03", method: "wire", reference: "TITLE-42", by: "x", ...changes });
  const owed = (deal: Deal, on = "2026-11-03") => payoffOn(deal, on).quote.total;
  it("won't take less than the payoff on the day it arrived", () => {
    const deal = loan();
    expect(check(book(deal), servicer, payoff({ amount: owed(deal) - 50 }))).toMatchObject({ error: expect.stringMatching(/\$50\.00 short/) });
    expect(check(book(deal), servicer, payoff({ amount: owed(deal) }))).toMatchObject({ action: { by: "servicer name", reference: "TITLE-42" } });
    expect(check(book(deal), processor, payoff({ amount: owed(deal) }))).toHaveProperty("error");
    expect(check(book(deal), servicer, payoff({ amount: owed(deal), receivedOn: "2026-12-01" }))).toMatchObject({ error: expect.stringMatching(/future/) });
    expect(parseAction({ t: "markPaidOff", payoffId: "x" })).toBeNull();
  });
  it("closes the loan: frees its capital and ends its payoff requests, draws, sale listing and extension", () => {
    const deal = loan({ allocations: [{ sourceId: "buyer:buy-a", amount: NOTE }], extensions: [{ id: "e1", months: 3, reason: "", requestedBy: "", requestedAt: "2026-11-01T00:00:00Z", fee: 1, fromMaturity: "2027-01-15", status: "requested", approvers: [] }] });
    const start = book(deal, {
      payoffs: [{ id: "po1", dealId: "L1", goodThrough: "2026-11-10", principal: 1, accrued: 1, perDiem: 1, total: 1, requestedAt: "2026-11-01T00:00:00Z", by: "Borrower", status: "sent" }],
      draws: [{ id: "dr1", dealId: "L1", requestedAt: "2026-11-01T00:00:00Z", by: "B", note: "", contact: "", photos: [], lines: [], status: "submitted", approvers: [] }],
      sales: [{ id: "s1", dealId: "L1", askPct: 100, listedAt: "2026-11-01", status: "listed" }],
    });
    const amount = owed(deal) + 25;
    const { after, action } = run(start, servicer, payoff({ amount }));
    expect(after.deals[0]).toMatchObject({ status: "paid_off", allocations: [], paidOff: { amount, owed: owed(deal), receivedOn: "2026-11-03", by: "servicer name" } });
    expect(after.deals[0].extensions![0].status).toBe("declined");
    expect(after.payoffs[0].status).toBe("paid");
    expect(after.draws[0]).toMatchObject({ status: "rejected", reason: "The loan was paid off" });
    expect(after.sales[0].status).toBe("withdrawn");
    const told = alertsFor(start, after, action);
    expect(told.map((alert) => [alert.to, alert.firmId])).toEqual([["borrower", undefined], ["team", undefined], ["buyer", "buy-a"]]);
    expect(told[0].body).toMatch(/\$25\.00 more than the payoff/);
  });
  it("tracks the satisfaction of mortgage until it's recorded", () => {
    const deal = loan();
    const paidOff = run(book(deal), servicer, payoff({ amount: owed(deal) })).after;
    expect(lienReleaseDue(paidOff.deals[0])).toBe("2027-01-02");
    expect(attentionCounts(paidOff, 0).releases).toBe(1);
    const release = (step: "sent" | "recorded", reference = ""): BookAction => ({ t: "recordLienRelease", dealId: "L1", step, on: "2026-11-03", reference, by: "x" });
    expect(check(paidOff, servicer, release("recorded"))).toMatchObject({ error: expect.stringMatching(/book and page/) });
    const sent = run(paidOff, servicer, release("sent")).after;
    expect(sent.deals[0].paidOff!.release).toMatchObject({ sentOn: "2026-11-03" });
    expect(attentionCounts(sent, 0).releases).toBe(1);
    const recorded = run(sent, servicer, release("recorded", "OR Book 123 Pg 45"));
    expect(recorded.after.deals[0].paidOff!.release).toMatchObject({ sentOn: "2026-11-03", recordedOn: "2026-11-03", reference: "OR Book 123 Pg 45" });
    expect(attentionCounts(recorded.after, 0).releases).toBe(0);
    expect(check(recorded.after, servicer, release("recorded", "again"))).toMatchObject({ error: expect.stringMatching(/already recorded/) });
    expect(alertsFor(sent, recorded.after, recorded.action)).toMatchObject([{ to: "borrower", event: "loan.lien_released" }]);
  });
});
