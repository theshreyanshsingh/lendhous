import { describe, expect, it } from "vitest";
import { approvalError, approversNeeded, defaultScope, drawRequestError, releaseToScope, reviewDraw, scopeError, scopeTotal } from "@/lib/draws";
import { evaluate } from "@/lib/engine";
import { canAdvance, nextStage } from "@/lib/loan-stages";
import { seedDeals, seedDraws, type Deal, type DrawRequest } from "@/lib/mockData";
import { addMonths, afterPayment, balanceOf, firstDueDate, paymentHistory, paymentsMade, payoffFor } from "@/lib/servicing";

const deal = (id: string, changes: Partial<Deal> = {}): Deal => {
  const base = seedDeals.find((item) => item.id === id)!;
  const e = evaluate(base.app);
  return { ...base, scope: defaultScope(base.app.product, e.holdback, base.disbursedDraws ?? 0), allocations: base.allocations.map((item) => ({ ...item, amount: item.amount || e.noteAmount })), ...changes };
};
const stageOf = (loan: Deal) => nextStage(loan, evaluate(loan.app));

describe("moving a loan through its stages", () => {
  it("walks forward one step at a time", () => {
    expect(stageOf(deal("d16"))).toMatchObject({ to: "initial_review", blockers: [] });
    expect(stageOf(deal("d6"))).toMatchObject({ to: "underwriting" });
    expect(stageOf(deal("d1"))).toMatchObject({ to: "term_sheet_issued" });
  });
  it("only the borrower can accept a term sheet", () => {
    const stage = stageOf(deal("d18"));
    expect(stage).toMatchObject({ to: "term_sheet_accepted", borrowerStep: true });
    expect(canAdvance(stage)).toBe(false);
  });
  it("won't clear to close with documents open or capital not committed", () => {
    const stage = stageOf(deal("d3"));
    expect(stage?.to).toBe("clear_to_close");
    expect(stage?.blockers.join(" ")).toMatch(/documents? still open/);
    expect(stage?.blockers.join(" ")).toMatch(/Capital isn't committed/);
    expect(canAdvance(stage)).toBe(false);
  });
  it("clears to close once the file is complete and the capital is committed", () => {
    const ready = deal("d3", { capitalStatus: "committed", allocations: [{ sourceId: "gt-main", amount: evaluate(deal("d3").app).noteAmount }], docs: deal("d3").docs.map((doc) => ({ ...doc, status: "accepted" as const })) });
    expect(canAdvance(stageOf(ready))).toBe(true);
    expect(stageOf({ ...ready, allocations: [{ sourceId: "gt-main", amount: 1_000 }] })?.blockers).toContain("Capital doesn't cover the whole loan yet");
  });
  it("won't fund without committed capital, and stops once in servicing", () => {
    const approved = { fundingApprovers: ["Olivia", "Uma"] };
    expect(canAdvance(stageOf(deal("d15", approved)))).toBe(true);
    expect(stageOf(deal("d15"))?.blockers).toContain("Needs two people to approve funding (0 of 2)");
    expect(canAdvance(stageOf(deal("d15", { fundingApprovers: ["Olivia"] })))).toBe(false);
    expect(stageOf(deal("d15", { ...approved, capitalStatus: "reserved" }))?.blockers).toContain("Capital isn't committed");
    expect(stageOf(deal("d2"))).toBeNull();
  });
});

describe("scope of work", () => {
  it("splits a budget into divisions that add up exactly", () => {
    for (const budget of [100_000, 137_350, 710_000]) {
      expect(scopeTotal(defaultScope("fix_flip", budget))).toBe(budget);
      expect(scopeTotal(defaultScope("ground_up", budget))).toBe(budget);
    }
    expect(defaultScope("bridge", 0)).toEqual([]);
  });
  it("spreads what was already released, without passing any line's budget", () => {
    const scope = defaultScope("fix_flip", 140_000, 70_000);
    expect(scope.reduce((sum, line) => sum + line.released, 0)).toBe(70_000);
    for (const line of scope) expect(line.released).toBeLessThanOrEqual(line.budget);
  });
  it("refuses a budget that doesn't match the loan", () => {
    const scope = defaultScope("fix_flip", 100_000);
    expect(scopeError(scope, 100_000)).toBeNull();
    expect(scopeError(scope, 90_000)).toMatch(/adds up to \$100,000/);
    expect(scopeError(scope.map((line, index) => (index ? line : { ...line, released: line.budget + 1 })), 100_000)).toMatch(/already been released/);
  });
});

describe("draws", () => {
  const draw = (id: string, changes: Partial<DrawRequest> = {}): DrawRequest => ({ ...seedDraws.find((item) => item.id === id)!, ...changes });
  it("checks a request against what's left on each line and on the loan", () => {
    const loan = deal("d2");
    const kitchen = loan.scope!.find((line) => line.id === "kitchen")!;
    expect(drawRequestError(loan, [])).toMatch(/at least one/);
    expect(drawRequestError(loan, [{ scopeId: "kitchen", requested: kitchen.budget - kitchen.released + 1 }])).toMatch(/Kitchen has only/);
    expect(drawRequestError(loan, [{ scopeId: "kitchen", requested: 1_000 }])).toBeNull();
    expect(drawRequestError(loan, [{ scopeId: "nope", requested: 1_000 }])).toMatch(/no longer/);
  });
  it("pays what the inspection supports, after retainage, not what was asked", () => {
    const loan = deal("d9");
    const scope = loan.scope!.find((line) => line.id === "plumbing")!;
    const review = reviewDraw(loan, draw("draw-2", { lines: [{ scopeId: "plumbing", requested: 5_000, observedPct: 0.8 }] }));
    const expected = Math.max(0, Math.min(5_000, 0.8 * scope.budget * 0.9 - scope.released));
    expect(review.approved).toBeCloseTo(expected, 2);
  });
  it("releases nothing on a loan that is behind on payments", () => {
    const late = deal("d13");
    const inspected = draw("draw-4", { status: "inspected", lines: [{ scopeId: "bathrooms", requested: 2_500, observedPct: 1 }] });
    expect(reviewDraw(late, inspected)).toMatchObject({ blocked: "Loan not current", approved: 0 });
    expect(approvalError(late, inspected, "Uma")).toMatch(/not current/);
  });
  it("needs two different people for a large draw or an affiliated contractor", () => {
    const loan = deal("d12");
    const big = draw("draw-3");
    expect(reviewDraw(loan, big).approved).toBeGreaterThan(50_000);
    expect(approversNeeded(loan, reviewDraw(loan, big).approved)).toBe(2);
    expect(approversNeeded(deal("d2"), 10_000)).toBe(1);
    expect(approversNeeded(deal("d5"), 10_000)).toBe(2);
    expect(approvalError(loan, big, "Cam Capital (FAKE)")).toMatch(/different approver/);
    expect(approvalError(loan, big, "Olivia Owner (FAKE)")).toBeNull();
    expect(approvalError(loan, { ...big, status: "submitted" }, "Olivia Owner (FAKE)")).toMatch(/isn't waiting/);
  });
  it("moves the released money onto the right budget lines", () => {
    const loan = deal("d12");
    const big = draw("draw-3");
    const approved = reviewDraw(loan, big).approved;
    const scope = releaseToScope(loan.scope!, loan, { ...big, approved });
    const before = loan.scope!.reduce((sum, line) => sum + line.released, 0);
    expect(scope.reduce((sum, line) => sum + line.released, 0)).toBeCloseTo(before + approved, 2);
    expect(scope.find((line) => line.id === "site")!.released).toBe(loan.scope!.find((line) => line.id === "site")!.released);
  });
});

describe("payments and payoff", () => {
  it("dates payments from the 1st after closing", () => {
    expect(firstDueDate("2026-05-12")).toBe("2026-06-01");
    expect(firstDueDate("2026-12-31")).toBe("2027-01-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("lists paid and late payments", () => {
    expect(paymentHistory(deal("d9")).map((row) => row.due)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(paymentsMade(deal("d9"))).toBe(5);
    const late = paymentHistory(deal("d13"));
    expect(late.filter((row) => row.status === "late").map((row) => row.due)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(paymentsMade(deal("d13"))).toBe(5);
    expect(paymentHistory(deal("d1"))).toEqual([]);
  });
  it("a payment clears the oldest late one first, then moves the due date", () => {
    const once = afterPayment(deal("d13"));
    expect(once).toMatchObject({ paymentsLate: 1, status: "servicing_delinquent", nextPaymentDue: "2026-10-01" });
    const twice = afterPayment(once);
    expect(twice).toMatchObject({ paymentsLate: 0, status: "servicing_current", nextPaymentDue: "2026-11-01" });
    expect(paymentsMade(twice)).toBe(7);
    expect(afterPayment(deal("d9"))).toMatchObject({ nextPaymentDue: "2026-12-01", status: "servicing_current" });
  });
  it("a payoff is principal plus interest since the last payment", () => {
    const quote = payoffFor(deal("d11"), "2026-10-16");
    // Bridge loan: $465,000 at 10.75%, paid through Oct 1, 15 days at a 360-day year.
    expect(quote.principal).toBe(465_000);
    expect(quote.perDiem).toBeCloseTo((465_000 * 0.1075) / 360, 2);
    expect(quote.accrued).toBeCloseTo(((465_000 * 0.1075) / 360) * 15, 1);
    expect(quote.total).toBeCloseTo(465_000 + quote.accrued, 2);
  });
  it("charges full-boat interest on the whole note, and draws-only interest on what was lent", () => {
    const fullBoat = deal("d13");
    const dutch = deal("d9");
    expect(payoffFor(fullBoat, "2026-10-01").perDiem).toBeCloseTo((evaluate(fullBoat.app).noteAmount * evaluate(fullBoat.app).rate) / 100 / 360, 2);
    expect(payoffFor(dutch, "2026-10-31").perDiem).toBeCloseTo((balanceOf(dutch) * evaluate(dutch.app).rate) / 100 / 360, 2);
  });
  it("counts a rental loan's balance down with its payments", () => {
    const rental = deal("d10");
    expect(balanceOf(rental)).toBeLessThan(evaluate(rental.app).noteAmount);
    expect(balanceOf(afterPayment(rental))).toBeLessThan(balanceOf(rental));
  });
});
