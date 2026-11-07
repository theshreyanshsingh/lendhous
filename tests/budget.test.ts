import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { applyChange, arvCheck, budgetBalance, changeOrderProblem, CONTINGENCY_ID, projectHealth, reserveOf, reservePaymentProblem } from "@/lib/budget";
import { approvalError, drawRequestError } from "@/lib/draws";
import { evaluate } from "@/lib/engine";
import { BORROWER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const alex = person(BORROWER_ID, ["BORROWER"]);
const drawAdmin = person("dora", ["DRAW_ADMIN"]);
const servicer = person("svc", ["SERVICER"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const system = person("system", []);
const deal = (b: Book, id = "d2") => b.deals.find((d) => d.id === id)!;
const withDeal = (b: Book, id: string, change: (d: Deal) => Deal): Book => ({ ...b, deals: b.deals.map((d) => (d.id === id ? change(d) : d)) });
const ask = (changes: Partial<Extract<BookAction, { t: "requestChangeOrder" }>> = {}): BookAction => ({ t: "requestChangeOrder", dealId: "d2", orderId: "co-test", from: "flooring", to: "bathrooms", amount: 2_000, reason: "Tile instead of vinyl in the second bath", by: "browser says", byTeam: true, ...changes });

describe("contingency", () => {
  it("is added to the budget before closing and can't be drawn on directly", () => {
    const b = demoBook();
    // d1 is in underwriting: its scope can still change, and the borrower adds a contingency out of the kitchen line.
    const d1 = deal(b, "d1");
    const scope = d1.scope!.map((line) => (line.id === "kitchen" ? { ...line, budget: line.budget - 5_000 } : line));
    const { after } = run(b, alex, { t: "saveScope", dealId: "d1", scope: [...scope, { id: CONTINGENCY_ID, division: "Anything", budget: 5_000, released: 999 }], summary: "" });
    const saved = deal(after, "d1").scope!.find((line) => line.id === CONTINGENCY_ID)!;
    expect(saved).toEqual({ id: CONTINGENCY_ID, division: "Contingency", budget: 5_000, released: 0 });
    // Any other new line is ignored, and the total still has to match the loan's budget.
    expect(check(b, alex, { t: "saveScope", dealId: "d1", scope: [...d1.scope!, { id: CONTINGENCY_ID, division: "Contingency", budget: 5_000, released: 0 }], summary: "" })).toMatchObject({ error: expect.stringMatching(/adds up to/) });
    const funded = withDeal(b, "d2", (d) => ({ ...d, scope: [...d.scope!.map((line) => (line.id === "kitchen" ? { ...line, budget: line.budget - 4_000 } : line)), { id: CONTINGENCY_ID, division: "Contingency", budget: 4_000, released: 0 }] }));
    expect(drawRequestError(deal(funded), [{ scopeId: CONTINGENCY_ID, requested: 1_000 }])).toMatch(/change order to move it/);
  });
});

describe("change orders", () => {
  it("move money between a funded loan's lines, with the total unchanged", () => {
    const b = demoBook();
    expect(changeOrderProblem(deal(b), { from: "flooring", to: "bathrooms", amount: 2_000, reason: "x" })).toBeNull();
    expect(changeOrderProblem(deal(b), { from: "flooring", to: "bathrooms", amount: 8_000, reason: "x" })).toMatch(/only \$7,000 left/);
    expect(changeOrderProblem(deal(b), { from: "flooring", to: "flooring", amount: 1, reason: "x" })).toMatch(/different line/);
    expect(changeOrderProblem(deal(b), { from: "flooring", to: "bathrooms", amount: 1, reason: " " })).toMatch(/what changed/);
    expect(changeOrderProblem(deal(b), { from: "flooring", to: "new", newDivision: "Kitchen", amount: 1, reason: "x" })).toMatch(/already a line/);
    expect(changeOrderProblem(deal(b, "d1"), { from: "flooring", to: "bathrooms", amount: 1, reason: "x" })).toMatch(/Before closing/);
    const scope = applyChange(deal(b).scope!, { id: "x", from: "flooring", to: "new", newDivision: "Pool resurfacing", amount: 2_500, reason: "", by: "", byTeam: false, at: "", status: "approved" });
    expect(scope.reduce((sum, line) => sum + line.budget, 0)).toBe(deal(b).scope!.reduce((sum, line) => sum + line.budget, 0));
    expect(scope.at(-1)).toEqual({ id: "co-x", division: "Pool resurfacing", budget: 2_500, released: 0 });
  });
  it("are asked for by the borrower or the team, and decided by someone who approves draws", () => {
    const b = demoBook();
    const asked = run(b, alex, ask({ byTeam: true }));
    expect(deal(asked.after).changeOrders!.at(-1)).toMatchObject({ id: "co-test", by: `${BORROWER_ID} name`, byTeam: false, status: "requested" });
    expect(alertsFor(b, asked.after, asked.action)).toMatchObject([{ to: "team", event: "budget.change_requested", body: expect.stringMatching(/\$2,000\.00 from Flooring and paint to Bathrooms/) }]);
    expect(check(asked.after, servicer, { t: "decideChangeOrder", dealId: "d2", orderId: "co-test", approve: true, note: "", by: "x" })).toHaveProperty("error");
    expect(check(asked.after, drawAdmin, { t: "decideChangeOrder", dealId: "d2", orderId: "co-test", approve: false, note: " ", by: "x" })).toEqual({ error: "Say why, so the borrower knows what to change." });
    const approved = run(asked.after, drawAdmin, { t: "decideChangeOrder", dealId: "d2", orderId: "co-test", approve: true, note: "", by: "x" });
    expect(deal(approved.after).scope!.find((line) => line.id === "flooring")!.budget).toBe(12_000);
    expect(deal(approved.after).scope!.find((line) => line.id === "bathrooms")!.budget).toBe(18_800);
    expect(alertsFor(asked.after, approved.after, approved.action)).toMatchObject([{ to: "borrower", event: "budget.change_approved" }]);
    expect(budgetBalance(deal(approved.after)).inBalance).toBe(true);
  });
  it("are checked again when decided, against the budget as it is then", () => {
    const b = run(demoBook(), alex, ask({ amount: 6_000 })).after;
    // A draw has used most of the flooring money since it was asked for.
    const drawn = withDeal(b, "d2", (d) => ({ ...d, scope: d.scope!.map((line) => (line.id === "flooring" ? { ...line, released: 12_000 } : line)) }));
    expect(check(drawn, drawAdmin, { t: "decideChangeOrder", dealId: "d2", orderId: "co-test", approve: true, note: "", by: "x" })).toEqual({ error: "Flooring and paint has only $2,000 left to move." });
  });
  it("check a new after-repair value against the loan's limit", () => {
    const b = demoBook();
    const e = evaluate(deal(b).app);
    expect(arvCheck(deal(b), 760_000)).toMatchObject({ over: false });
    const tooLow = Math.floor(e.noteAmount / 0.8);
    expect(changeOrderProblem(deal(b), { from: "flooring", to: "bathrooms", amount: 1_000, reason: "x", arv: tooLow })).toMatch(/over its .*% limit/);
    expect(arvCheck(deal(b, "d10"), 100)).toBeNull();
  });
});

describe("overruns and the in-balance test", () => {
  it("put the loan out of balance, which holds the draw, until they're covered", () => {
    const b = demoBook();
    const recorded = run(b, drawAdmin, { t: "recordOverrun", dealId: "d2", overrunId: "ov-1", amount: 6_500, scopeId: "kitchen", note: "Cabinets re-ordered after water damage", by: "x" });
    expect(budgetBalance(deal(recorded.after))).toMatchObject({ inBalance: false, shortfall: 6_500 });
    expect(alertsFor(b, recorded.after, recorded.action).map((alert) => alert.event)).toEqual(["budget.out_of_balance", "budget.out_of_balance"]);
    const inspected = { ...recorded.after.draws.find((draw) => draw.dealId === "d2")!, status: "inspected" as const, lines: recorded.after.draws.find((draw) => draw.dealId === "d2")!.lines.map((line) => ({ ...line, observedPct: 0.8 })) };
    expect(approvalError(deal(recorded.after), inspected, "x")).toMatch(/out of balance by \$6,500/);
    expect(workQueue(recorded.after, { id: "" }, new Date("2026-10-31T16:00:00Z")).team.some((item) => item.key === "balance:d2")).toBe(true);
    expect(check(recorded.after, drawAdmin, { t: "coverOverrun", dealId: "d2", overrunId: "ov-1", how: " ", by: "x" })).toHaveProperty("error");
    const covered = run(recorded.after, drawAdmin, { t: "coverOverrun", dealId: "d2", overrunId: "ov-1", how: "Borrower paid the cabinet supplier directly", by: "x" }).after;
    expect(budgetBalance(deal(covered)).inBalance).toBe(true);
    expect(approvalError(deal(covered), inspected, "x")).toBeNull();
  });
  it("are recorded by the team, on a funded loan", () => {
    const b = demoBook();
    expect(check(b, alex, { t: "recordOverrun", dealId: "d2", overrunId: "ov-2", amount: 100, note: "x", by: "x" })).toHaveProperty("error");
    expect(check(b, drawAdmin, { t: "recordOverrun", dealId: "d1", overrunId: "ov-2", amount: 100, note: "x", by: "x" })).toEqual({ error: "Overruns are found on a funded loan's inspections." });
    expect(check(b, drawAdmin, { t: "recordOverrun", dealId: "d2", overrunId: "ov-2", amount: 100, note: " ", by: "x" })).toEqual({ error: "Say what the inspection found." });
  });
});

describe("how far the work has got", () => {
  it("weighs each line's latest inspection by its budget, next to the money out", () => {
    const b = demoBook();
    expect(projectHealth(deal(b), b.draws)).toMatchObject({ done: 0.5, paid: 0.5, ahead: false });
    const behind = { ...b, draws: [{ ...b.draws.find((draw) => draw.dealId === "d2")!, status: "inspected" as const, lines: deal(b).scope!.map((line) => ({ scopeId: line.id, requested: 0, observedPct: 0.3 })) }] };
    expect(projectHealth(deal(behind), behind.draws)).toMatchObject({ done: 0.3, paid: 0.5, ahead: true });
  });
});

describe("the interest reserve", () => {
  // d2 with its interest financed: the reserve is held from the loan to pay interest.
  const reserved = () => withDeal(demoBook(), "d2", (d) => ({ ...d, app: { ...d.app, interestReserve: "financed" } }));
  it("shows what's left and how long it lasts", () => {
    const d = deal(reserved());
    const reserve = reserveOf(d, "2026-10-31")!;
    expect(reserve.funded).toBe(evaluate(d.app).financedReserve);
    expect(reserve.funded).toBeGreaterThan(0);
    expect(reserve.remaining).toBe(reserve.funded);
    expect(reserve.months).toBe(Math.floor(reserve.remaining / reserve.monthly));
    expect(reserveOf(deal(demoBook()), "2026-10-31")).toBeNull();
  });
  it("pays interest only up to what's in it", () => {
    const b = reserved();
    const reserve = reserveOf(deal(b), "2026-10-31")!;
    const pay = (amount: number): BookAction => ({ t: "recordPayment", dealId: "d2", amount, receivedOn: "2026-10-31", method: "reserve", reference: "", by: "x" });
    const { after } = run(b, servicer, pay(reserve.monthly));
    expect(reserveOf(deal(after), "2026-10-31")!.remaining).toBeCloseTo(reserve.funded - reserve.monthly, 2);
    expect(reservePaymentProblem(deal(b), reserve.funded + 1, "2026-10-31")).toMatch(/only \$/);
    expect(check(demoBook(), servicer, pay(100))).toEqual({ error: "This loan has no interest reserve." });
  });
});

describe("the contractor's sign-off", () => {
  it("is recorded on the draw from their photo link, and only theirs", () => {
    const b = demoBook();
    const request = b.photoRequests.find((item) => item.drawId)!;
    const signed = run(b, system, { t: "finishPhotoRequest", requestId: request.id, by: "Mo Mock", note: "", signDraw: true }, true).after;
    expect(signed.draws.find((draw) => draw.id === request.drawId)!.contractorSigned).toMatchObject({ name: "Mo Mock", requestId: request.id });
    const borrowerLink = { ...b, photoRequests: b.photoRequests.map((item) => (item.id === request.id ? { ...item, who: "borrower" as const } : item)) };
    const notSigned = run(borrowerLink, system, { t: "finishPhotoRequest", requestId: request.id, by: "Alex", note: "", signDraw: true }, true).after;
    expect(notSigned.draws.find((draw) => draw.id === request.drawId)!.contractorSigned).toBeUndefined();
    expect(check(b, owner, { t: "finishPhotoRequest", requestId: request.id, by: "x", note: "", signDraw: true })).toHaveProperty("error");
  });
});

describe("the demo", () => {
  it("has a change order waiting on the borrower's flip", () => {
    const b = demoBook();
    expect(deal(b).changeOrders).toMatchObject([{ id: "co-demo-1", status: "requested" }]);
    expect(changeOrderProblem(deal(b), deal(b).changeOrders![0])).toBeNull();
    expect(workQueue(b, { id: "" }, new Date("2026-10-31T16:00:00Z")).team.find((item) => item.key === "change:d2")).toMatchObject({ label: "Decide a change order" });
  });
});
