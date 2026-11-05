import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book } from "@/lib/book";
import { blankDraft, refinanceDraft, toLoan } from "@/lib/borrower-application";
import { evaluate } from "@/lib/engine";
import { exitPlanProblem, exitReport, maturityDesk, needsExitAnswer, outreachDue } from "@/lib/exit-plans";
import { payoffOn } from "@/lib/loan-exits";
import type { Deal } from "@/lib/mockData";
import { nextStepFor } from "@/lib/next-step";
import { can, type Permission } from "@/lib/permissions";
import { addDays, ledger, ledgerOf, maturityOf, settle } from "@/lib/servicing";
import { workQueue } from "@/lib/work-queue";

const book = demoBook();
const d2 = book.deals.find((deal) => deal.id === "d2")!;
const plan = { choice: "sell" as const, confidence: "likely" as const, listPrice: 610_000, saleBy: "2027-08-01", note: "Listing in June." };

describe("asking for the exit plan", () => {
  const at = (days: number) => addDays(maturityOf(d2), -days);
  it("asks at 120, 90, 60 and 30 days before maturity, once each, and stops once there's a plan", () => {
    expect(settle(d2, at(125)).exitAsked).toBeUndefined();
    expect(settle(d2, at(119)).exitAsked).toEqual([120]);
    const later = settle(settle(d2, at(119)), at(59));
    expect(later.exitAsked).toEqual([120, 90, 60]);
    expect(outreachDue(later, 59)).toEqual([]);
    expect(settle({ ...d2, exitPlan: { ...plan, by: "Alex", at: "x" } }, at(59)).exitAsked).toBeUndefined();
    // A 30-year rental loan isn't asked.
    expect(outreachDue({ ...d2, app: { ...d2.app, product: "dscr" } }, 59)).toEqual([]);
  });
  it("emails the borrower the question, or adds it to the maturity notice going out the same night", () => {
    const withDeal = (deal: Deal): Book => ({ ...book, deals: book.deals.map((item) => (item.id === deal.id ? deal : item)) });
    const first = alertsFor(withDeal(d2), withDeal(settle(d2, at(119))), { t: "settleLoans" } as never);
    expect(first).toContainEqual(expect.objectContaining({ to: "borrower", event: "exit.asked", subject: expect.stringContaining(d2.loanNumber) }));
    const before = settle(d2, at(61));
    const notice = alertsFor(withDeal(before), withDeal(settle(before, at(59))), { t: "settleLoans" } as never);
    expect(notice.some((alert) => alert.event === "exit.asked")).toBe(false);
    expect(notice.find((alert) => alert.to === "borrower" && alert.event === "loan.maturity_notice")?.body).toContain("#exit-plan");
  });
  it("makes the plan the borrower's next step, and the team's call at 60 days with no answer", () => {
    const near = settle(d2, at(100));
    // As if every payment so far is in: only the maturity decides this.
    const l = { ...ledgerOf(near, at(100)), amountDue: 0 };
    expect(nextStepFor(near, l)?.kind).toBe("exit");
    expect(nextStepFor({ ...near, exitPlan: { ...plan, by: "Alex", at: "x" } }, l)?.kind).not.toBe("exit");
    expect(needsExitAnswer(near, 100)).toBe(false);
    expect(needsExitAnswer(near, 59)).toBe(true);
  });
});

describe("the exit plan", () => {
  const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
  const allowedFor = (viewer: Viewer) => (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer });
  const live = (): Book => ({ ...book, deals: book.deals.map((item) => ({ ...item, borrowerId: item.borrowerId === "b-alex" ? "borrower-1" : item.borrowerId })) });
  const check = (viewer: Viewer, action: Record<string, unknown>) => authorize(live(), viewer, { t: "setExitPlan", dealId: "d2", plan, by: "x", ...action } as never, allowedFor(viewer), false);
  it("needs a list price and closing date for a sale", () => {
    expect(exitPlanProblem(plan)).toBeNull();
    expect(exitPlanProblem({ ...plan, listPrice: undefined })).toMatch(/list/);
    expect(exitPlanProblem({ ...plan, saleBy: undefined })).toMatch(/close/);
    expect(exitPlanProblem({ choice: "refi_lendhous", confidence: "sure", note: "" })).toBeNull();
  });
  it("is the borrower's to give on their funded loan, and the team's to write down", () => {
    expect(check(person("borrower-1", ["BORROWER"]), {})).toMatchObject({ action: { by: "borrower-1 name" } });
    expect(check(person("borrower-2", ["BORROWER"]), {})).toHaveProperty("error");
    expect(check(person("svc", ["SERVICER"]), {})).toHaveProperty("action");
    expect(check(person("uw", ["UNDERWRITER"]), {})).toHaveProperty("error");
    expect(authorize(live(), person("borrower-1", ["BORROWER"]), { t: "setExitPlan", dealId: "d1", plan, by: "x" }, allowedFor(person("borrower-1", ["BORROWER"])), false)).toHaveProperty("error");
    expect(parseAction({ t: "setExitPlan", dealId: "d2", by: "x", plan })).toBeTruthy();
    const after = reducer(live(), { t: "setExitPlan", dealId: "d2", plan, by: "Alex" });
    expect(after.deals.find((deal) => deal.id === "d2")!.exitPlan).toMatchObject({ choice: "sell", listPrice: 610_000, by: "Alex" });
  });
  it("shows on the maturity desk and in the reports", () => {
    const planned = reducer(book, { t: "setExitPlan", dealId: "d2", plan, by: "Alex" });
    const rows = maturityDesk(planned.deals).flatMap((group) => group.rows);
    expect(rows.find((row) => row.deal.id === "d2")?.plan?.choice).toBe("sell");
    expect(rows.every((row) => row.deal.app.product !== "dscr")).toBe(true);
    const day = planned.deals.find((deal) => deal.id === "d2")!.exitPlan!.at.slice(0, 10);
    expect(exitReport(planned, { from: day, to: day }).mix.sell).toBe(1);
  });
});

describe("refinancing into a LendHous rental loan", () => {
  it("starts a rental application on the same property, with the rehab as a finished project", () => {
    const draft = refinanceDraft(d2, { name: "Alex Sample", email: "alex@x" }, "2026-10-31");
    expect(draft).toMatchObject({ loanType: "dscr", refinanceOf: "d2", loan: { purpose: "refinance", exit: "hold" } });
    expect(draft.property.address.street).toBe(d2.address);
    expect(Number(draft.loan.asIsValue.replace(/,/g, ""))).toBe(d2.app.arv);
    expect(draft.trackRecord.some((item) => item.address.startsWith(d2.address) && item.completed === "2026-10-31")).toBe(true);
    expect(toLoan(draft).refinances).toBe("d2");
  });
  it("can be estimated before the rent and credit scores are in, without breaking the page", () => {
    expect(() => evaluate(toLoan(refinanceDraft(d2, { name: "Alex Sample", email: "alex@x" }, "2026-10-31")).app)).not.toThrow();
    expect(() => evaluate(toLoan({ ...blankDraft(), loanType: "dscr" }).app)).not.toThrow();
  });
  it("links the application only to the borrower's own funded loan", () => {
    const app = toLoan(refinanceDraft(d2, { name: "Alex Sample", email: "alex@x" }, "2026-10-31"));
    Object.assign(app.app, { monthlyRent: 4_200, taxesAnnual: 9_000, insuranceAnnual: 6_000, fico: 720 });
    // The borrower enters each guarantor's credit score again before signing.
    app.sponsor.guarantors = app.sponsor.guarantors.map((guarantor) => ({ ...guarantor, fico: 720 }));
    const submit = (refinances: string) => reducer(book, { t: "submitApp", app: app.app, address: app.address, city: app.city, zip: app.zip, entityName: app.entityName, exitStrategy: app.exitStrategy, sponsor: app.sponsor, refinances });
    expect(submit("d2").deals[0].refinances).toBe("d2");
    const someoneElse = book.deals.find((deal) => deal.borrowerId !== d2.borrowerId && deal.status === "servicing_current")!;
    expect(submit(someoneElse.id).deals[0].refinances).toBeUndefined();
  });
  it("pays off the old loan from the new one when it funds", () => {
    const today = serviceDay(book);
    const old = book.deals.find((deal) => deal.id === "d2")!;
    const ready = { ...book, deals: book.deals.map((deal) => (deal.id === "d15" ? { ...deal, refinances: "d2" } : deal)) };
    const approved = reducer(reducer(ready, { t: "approveFunding", dealId: "d15", by: "Olivia" }), { t: "approveFunding", dealId: "d15", by: "Uma" });
    const funded = reducer(approved, { t: "advanceLoan", dealId: "d15" });
    expect(funded.deals.find((deal) => deal.id === "d15")?.status).toBe("funded");
    const paid = funded.deals.find((deal) => deal.id === "d2")!;
    expect(paid.status).toBe("paid_off");
    expect(paid.paidOff).toMatchObject({ receivedOn: today, reference: "Refinanced by LH-DEMO-1015", amount: payoffOn(settle(old, today), today).quote.total });
    expect(ledger(paid).payments.length).toBeGreaterThanOrEqual(0);
    expect(workQueue(funded, { id: "x" }, new Date(`${today}T15:00:00-04:00`)).team.some((item) => item.key === "exit:d2")).toBe(false);
  });
});
