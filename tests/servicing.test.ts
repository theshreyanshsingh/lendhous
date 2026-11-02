import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, emptyBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { defaultScope } from "@/lib/draws";
import { evaluate, fundedBalances } from "@/lib/engine";
import { seedDeals, type Deal, type LoanPayment } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { DEMO_SERVICING_DAY, defaultRate, ledger, ledgerOf, payoffFor, previewPayment, settle, servicingDate } from "@/lib/servicing";

// A fix and flip that closed June 10, 2026: payments are due the 1st from July 1, and it matures June 10, 2027.
const loan = (changes: Partial<Deal> = {}): Deal => {
  const base = seedDeals.find((item) => item.id === "d9")!;
  const e = evaluate(base.app);
  return { ...base, scope: defaultScope(base.app.product, e.holdback, base.disbursedDraws ?? 0), allocations: [], closingDate: "2026-06-10", nextPaymentDue: "2026-07-01", paymentsLate: 0, status: "servicing_current", ...changes };
};
const A = fundedBalances(evaluate(loan().app), loan().app, loan().disbursedDraws).nextPayment;
const FEE = Math.round(A * 0.05 * 100) / 100;
let n = 0;
const paid = (amount: number, receivedOn: string, extra: Partial<LoanPayment> = {}): LoanPayment => ({ id: `p${++n}`, amount, receivedOn, method: "wire", reference: `w${n}`, by: "Sam Servicer", at: `${receivedOn}T12:00:${String(n % 60).padStart(2, "0")}Z`, ...extra });
const withPayments = (...payments: LoanPayment[]) => loan({ payments });
const row = (deal: Deal, asOf: string, due: string) => ledgerOf(deal, asOf).rows.find((item) => item.due === due)!;

describe("when a payment is late", () => {
  it("gives the grace days, then marks it late with one fee", () => {
    expect(row(loan(), "2026-07-11", "2026-07-01")).toMatchObject({ status: "due", late: false, fee: 0 });
    expect(row(loan(), "2026-07-12", "2026-07-01")).toMatchObject({ status: "late", late: true, fee: FEE });
    expect(ledgerOf(loan(), "2026-07-12")).toMatchObject({ paymentsLate: 1, daysPastDue: 11, feesOwed: FEE });
    expect(ledgerOf(loan(), "2026-07-12").amountDue).toBeCloseTo(A + FEE, 2);
  });
  it("counts a payment on the last grace day as on time, and the day after as late", () => {
    expect(row(withPayments(paid(A, "2026-07-11")), "2026-07-20", "2026-07-01")).toMatchObject({ status: "paid", fee: 0 });
    const late = withPayments(paid(A, "2026-07-12"));
    expect(row(late, "2026-07-20", "2026-07-01")).toMatchObject({ status: "paid_late", fee: FEE, feePaid: 0 });
    expect(ledgerOf(late, "2026-07-20")).toMatchObject({ paymentsLate: 0, feesOwed: FEE, amountDue: FEE });
  });
  it("moves to delinquent once the oldest payment is 30 days past due", () => {
    expect(settle(loan(), "2026-07-30").status).toBe("servicing_current");
    expect(settle(loan(), "2026-07-31")).toMatchObject({ status: "servicing_delinquent", paymentsLate: 1, nextPaymentDue: "2026-07-01" });
    // Paying it brings it back, even with the late fee still owed.
    expect(settle(withPayments(paid(A, "2026-08-02")), "2026-08-02").status).toBe("servicing_current");
  });
  it("never lifts a declared default on its own", () => {
    expect(settle(loan({ status: "default", payments: [paid(A, "2026-07-01")] }), "2026-07-20").status).toBe("default");
  });
});

describe("where money goes", () => {
  it("holds a partial payment until it covers a whole one", () => {
    const half = withPayments(paid(A / 2, "2026-07-05"));
    expect(ledgerOf(half, "2026-07-10")).toMatchObject({ credit: A / 2, paymentsLate: 0 });
    expect(row(half, "2026-07-12", "2026-07-01").status).toBe("late");
    const rest = withPayments(paid(A / 2, "2026-07-05"), paid(A / 2, "2026-07-20"));
    expect(row(rest, "2026-07-25", "2026-07-01")).toMatchObject({ status: "paid_late", paidOn: "2026-07-20" });
    expect(ledgerOf(rest, "2026-07-25").credit).toBe(0);
  });
  it("pays the oldest payment, then late fees, then ahead, and holds the rest", () => {
    const l = ledgerOf(withPayments(paid(A + FEE + A + 100, "2026-07-20")), "2026-07-20");
    expect(l.rows[0]).toMatchObject({ due: "2026-07-01", status: "paid_late", feePaid: FEE });
    expect(l.rows[1]).toMatchObject({ due: "2026-08-01", status: "paid_ahead" });
    expect(l).toMatchObject({ nextDue: "2026-09-01", feesOwed: 0, credit: 100, amountDue: 0 });
  });
  it("uses a credit held from before the day the next payment falls due", () => {
    const early = withPayments(paid(2 * A - 1, "2026-07-01"), paid(1, "2026-07-20"));
    // July is paid at once; the dollar short waits, then August is paid when the last dollar arrives.
    expect(row(early, "2026-07-25", "2026-08-01")).toMatchObject({ status: "paid_ahead", paidOn: "2026-07-20" });
    expect(row(early, "2026-08-15", "2026-08-01")).toMatchObject({ status: "paid", paidOn: "2026-07-20" });
    const short = withPayments(paid(A + 100, "2026-07-01"));
    expect(ledgerOf(short, "2026-08-12")).toMatchObject({ paymentsLate: 1, credit: 100 });
    expect(ledgerOf(short, "2026-08-12").amountDue).toBeCloseTo(A + FEE - 100, 2);
  });
  it("undoes a reversed payment as if it never came", () => {
    const bounced = withPayments(paid(A, "2026-07-05", { reversed: { by: "Sam", at: "2026-07-15T00:00:00Z", reason: "Check returned unpaid" } }));
    expect(ledgerOf(bounced, "2026-07-20")).toMatchObject({ paymentsLate: 1, feesOwed: FEE });
  });
  it("gives a waived fee back as credit, and charges no new one", () => {
    const deal = withPayments(paid(A + FEE, "2026-07-15"));
    expect(ledgerOf(deal, "2026-07-20")).toMatchObject({ feesOwed: 0, credit: 0 });
    const waived = { ...deal, waivedFees: [{ due: "2026-07-01", by: "Sam", at: "2026-07-21T00:00:00Z", reason: "First time" }] };
    expect(row(waived, "2026-07-21", "2026-07-01")).toMatchObject({ late: true, waived: true, fee: 0 });
    expect(ledgerOf(waived, "2026-07-21").credit).toBe(FEE);
  });
  it("previews a payment before it's recorded", () => {
    const preview = previewPayment(loan(), A + FEE + 50, "2026-07-20", "2026-07-20");
    expect(preview.pays.map((item) => item.due)).toEqual(["2026-07-01"]);
    expect(preview).toMatchObject({ fees: FEE, credit: 50 });
    expect(preview.after.amountDue).toBe(0);
  });
});

describe("keeping the record straight", () => {
  it("keeps what an earlier month owed when a later draw raises the payment", () => {
    const settled = settle(withPayments(paid(A, "2026-07-01")), "2026-07-02");
    expect(settled.bills).toEqual([{ due: "2026-07-01", amount: A }]);
    const drawn = { ...settled, disbursedDraws: (settled.disbursedDraws ?? 0) + 50_000 };
    expect(row(drawn, "2026-08-01", "2026-07-01")).toMatchObject({ amount: A, status: "paid" });
    expect(row(drawn, "2026-08-01", "2026-08-01").amount).toBeGreaterThan(A);
  });
  it("gives the same answer when checked twice, and never goes back in time", () => {
    const once = settle(loan(), "2026-07-20");
    expect(settle(once, "2026-07-20")).toEqual(once);
    expect(settle(once, "2026-07-01").servicedThrough).toBe("2026-07-20");
    expect(settle(loan({ status: "paid_off" }), "2026-07-20").servicedThrough).toBeUndefined();
  });
  it("reads today in Florida", () => {
    expect(servicingDate(new Date("2026-11-02T03:30:00Z"))).toBe("2026-11-01");
    expect(servicingDate(new Date("2026-11-02T05:30:00Z"))).toBe("2026-11-02");
  });
});

describe("maturity", () => {
  it("sends each notice once and moves the loan to matured the day after", () => {
    expect(settle(loan(), "2027-04-11").maturityNotices).toEqual([60]);
    expect(settle(settle(loan(), "2027-04-11"), "2027-05-11").maturityNotices).toEqual([60, 30]);
    expect(settle(loan(), "2027-06-10").status).not.toBe("matured");
    expect(settle(loan(), "2027-06-11").status).toBe("matured");
    expect(ledgerOf(loan(), "2027-06-11").rows.at(-1)!.due).toBe("2027-06-01");
  });
  it("charges the default rate on payoff for days past maturity", () => {
    const allPaid = loan({ boardedThrough: "2027-07-01", servicedThrough: "2027-06-11" });
    const quote = payoffFor(allPaid, "2027-06-20");
    const e = evaluate(allPaid.app);
    const principal = fundedBalances(e, allPaid.app, allPaid.disbursedDraws).disbursed;
    expect(quote.accrued).toBeCloseTo((principal * e.rate) / 100 / 360 * 9, 1);
    expect(quote.defaultAccrued).toBeCloseTo((principal * defaultRate(e.rate)) / 100 / 360 * 10, 1);
    expect(quote.perDiem).toBeCloseTo((principal * defaultRate(e.rate)) / 100 / 360, 2);
    expect(defaultRate(11)).toBe(17);
    expect(defaultRate(13)).toBe(18);
  });
  it("adds late fees to a payoff and takes off credit held", () => {
    // Paid a day late with $40 extra: the extra goes toward the late fee.
    const owing = loan({ payments: [paid(A + 40, "2026-07-12")], servicedThrough: "2026-07-20" });
    const quote = payoffFor(owing, "2026-07-25");
    expect(quote).toMatchObject({ fees: FEE - 40, credit: 0 });
    expect(quote.total).toBeCloseTo(quote.principal + quote.accrued + FEE - 40, 2);
    const ahead = loan({ payments: [paid(A + 40, "2026-07-05")], servicedThrough: "2026-07-20" });
    expect(payoffFor(ahead, "2026-07-25")).toMatchObject({ fees: 0, credit: 40 });
  });
});

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (book: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(book, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const servicer = person("servicer", ["SERVICER"]);
const processor = person("proc", ["PROCESSOR"]);
const realBook = (deal = loan({ borrowerId: "borrower-1" })): Book => ({ ...emptyBook(), deals: [deal] });
const record = (changes: Partial<Extract<BookAction, { t: "recordPayment" }>> = {}): BookAction => ({ t: "recordPayment", dealId: "d9", amount: A, receivedOn: "2026-07-05", method: "wire", reference: "FED123", by: "anyone", ...changes });

describe("who records what", () => {
  it("lets servicing record a payment, under their own name", () => {
    expect(check(realBook(), servicer, record())).toMatchObject({ action: { by: "servicer name", reference: "FED123" } });
    expect(check(realBook(), processor, record())).toHaveProperty("error");
    expect(check(realBook(), person("borrower-1", ["BORROWER"]), record())).toHaveProperty("error");
  });
  it("refuses a payment dated in the future, before closing, bigger than the loan, or entered twice", () => {
    expect(check(realBook(), servicer, record({ receivedOn: "2999-01-01" }))).toMatchObject({ error: expect.stringMatching(/future/) });
    expect(check(realBook(), servicer, record({ receivedOn: "2026-06-01" }))).toMatchObject({ error: expect.stringMatching(/before the loan closed/) });
    expect(check(realBook(), servicer, record({ amount: 10_000_000 }))).toMatchObject({ error: expect.stringMatching(/payoff/) });
    const twice = realBook(loan({ payments: [paid(A, "2026-07-05", { reference: "FED123" })] }));
    expect(check(twice, servicer, record())).toMatchObject({ error: expect.stringMatching(/already recorded/) });
    expect(check(twice, servicer, record({ reference: "FED124" }))).toHaveProperty("action");
  });
  it("waives only a fee that exists, with the waive_fee permission", () => {
    const late = realBook(loan({ servicedThrough: "2026-07-20" }));
    const waive: BookAction = { t: "waiveLateFee", dealId: "d9", due: "2026-07-01", reason: "First time", by: "x" };
    expect(check(late, servicer, waive)).toMatchObject({ action: { by: "servicer name" } });
    expect(check(late, person("uw", ["UNDERWRITER"]), waive)).toHaveProperty("error");
    expect(check(late, servicer, { ...waive, due: "2026-08-01" })).toMatchObject({ error: expect.stringMatching(/no late fee/) });
  });
  it("lets only the server run the nightly check", () => {
    const owner = person("owner", ["ADMIN_OWNER"]);
    expect(check(realBook(), owner, { t: "settleLoans", asOf: "2026-07-20" })).toHaveProperty("error");
    expect(check(realBook(), owner, { t: "settleLoans", asOf: "2026-07-20" }, true)).toHaveProperty("action");
    expect(parseAction({ t: "settleLoans", asOf: "2026-07-20" })).toBeNull();
    expect(parseAction({ t: "recordPayment", dealId: "d9", amount: -5, receivedOn: "2026-07-05", method: "wire", reference: "", by: "" })).toBeNull();
    expect(parseAction({ t: "reversePayment", dealId: "d9", paymentId: "p1", reason: "  ", by: "" })).toBeNull();
  });
  it("shows the borrower their payments without who keyed them in or why a fee was waived", () => {
    const deal = loan({ borrowerId: "borrower-1", payments: [paid(A, "2026-07-05")], waivedFees: [{ due: "2026-07-01", by: "Sam", at: "2026-07-21T00:00:00Z", reason: "Goodwill, borrower is a friend" }] });
    const seen = scopeBook(realBook(deal), person("borrower-1", ["BORROWER"])).deals[0];
    expect(seen.payments![0]).toMatchObject({ amount: A, by: "", reference: "w" + seen.payments![0].reference.slice(1) });
    expect(JSON.stringify(seen)).not.toContain("friend");
  });
});

describe("the nightly check and its emails", () => {
  const night = (book: Book, asOf: string) => reducer(book, { t: "settleLoans", asOf });
  it("tells the borrower and the team once when a payment goes late", () => {
    const start = realBook();
    const late = night(start, "2026-07-12");
    const alerts = alertsFor(start, late, { t: "settleLoans", asOf: "2026-07-12" });
    expect(alerts.map((alert) => [alert.to, alert.event])).toEqual([["borrower", "payment.late"], ["team", "payment.late"]]);
    expect(alerts[0].body).toContain("late fee");
    const nextDay = night(late, "2026-07-13");
    expect(alertsFor(late, nextDay, { t: "settleLoans", asOf: "2026-07-13" })).toEqual([]);
    expect(late.audit[0].text).toMatch(/1 payment past due/);
  });
  it("warns at 30 and 90 days past due", () => {
    const start = night(realBook(), "2026-07-29");
    const thirty = night(start, "2026-07-31");
    expect(alertsFor(start, thirty, { t: "settleLoans", asOf: "2026-07-31" }).map((alert) => alert.event)).toContain("loan.delinquent");
    const before = night(start, "2026-09-28");
    const ninety = night(before, "2026-09-29");
    expect(alertsFor(before, ninety, { t: "settleLoans", asOf: "2026-09-29" }).filter((alert) => alert.event === "loan.default_review").map((alert) => alert.to)).toEqual(["team"]);
  });
  it("sends a maturity notice once and a matured notice when it passes", () => {
    const paidUp = realBook(loan({ boardedThrough: "2027-07-01" }));
    const sixty = night(paidUp, "2027-04-11");
    expect(alertsFor(paidUp, sixty, { t: "settleLoans", asOf: "2027-04-11" }).map((alert) => alert.event)).toEqual(["loan.maturity_notice", "loan.maturity_notice"]);
    expect(alertsFor(sixty, night(sixty, "2027-04-12"), { t: "settleLoans", asOf: "2027-04-12" })).toEqual([]);
    const before = night(sixty, "2027-06-10");
    const matured = night(before, "2027-06-11");
    expect(matured.deals[0].status).toBe("matured");
    expect(alertsFor(before, matured, { t: "settleLoans", asOf: "2027-06-11" }).map((alert) => alert.event)).toEqual(["loan.matured", "loan.matured"]);
  });
  it("does nothing on a day with nothing new", () => {
    const checked = night(realBook(), "2026-07-05");
    expect(night(checked, "2026-07-05")).toBe(checked);
  });
  it("sends the borrower a receipt for a payment", () => {
    const start = realBook();
    const action = record({ by: "servicer name" });
    const after = reducer(start, action);
    expect(alertsFor(start, after, action)).toMatchObject([{ to: "borrower", event: "payment.received" }]);
    expect(after.deals[0].payments).toHaveLength(1);
  });
});

describe("the demo book", () => {
  it("stays on its own day, so its loans don't fall further behind", () => {
    const demo = demoBook();
    expect(serviceDay(demo)).toBe(DEMO_SERVICING_DAY);
    const late = demo.deals.find((deal) => deal.id === "d13")!;
    const one = ledger(late).rows.find((item) => item.status === "late")!.amount;
    const after = reducer(demo, { t: "recordPayment", dealId: "d13", amount: one, receivedOn: DEMO_SERVICING_DAY, method: "wire", reference: "", by: "Demo" });
    expect(after.deals.find((deal) => deal.id === "d13")).toMatchObject({ paymentsLate: 1, servicedThrough: DEMO_SERVICING_DAY });
  });
  it("freezes what was due before a draw is released", () => {
    const demo = demoBook();
    const draw = demo.draws.find((item) => item.status === "approved");
    if (!draw) return;
    const after = reducer(demo, { t: "releaseDraw", drawId: draw.id });
    expect(after.deals.find((deal) => deal.id === draw.dealId)!.servicedThrough).toBe(DEMO_SERVICING_DAY);
  });
});
