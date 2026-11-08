import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { evaluate, ioPayment, round2 } from "@/lib/engine";
import { ratesOn, splitOf } from "@/lib/investor-statements";
import { modificationPreview, openModification, signProblem } from "@/lib/modifications";
import { can, type Permission } from "@/lib/permissions";
import { balanceOf, capitalizedOf, ledger, ledgerOf, maturityOf, noteRateOn, payoffFor, paymentsMade, rentalBalance } from "@/lib/servicing";
import { letterFigures } from "@/lib/payoffs";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const servicer = person("svc", ["SERVICER"]);
const uma = person("uma", ["UNDERWRITER"]);
const ugo = person("ugo", ["UNDERWRITER"]);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const propose = (dealId: string, change: Partial<Extract<BookAction, { t: "proposeModification" }>> = {}): BookAction => ({ t: "proposeModification", dealId, capitalize: false, waiveFees: false, reason: "Buyer's financing fell through; relisting (FAKE)", by: "x", ...change });
/** Proposed, approved by two people and signed today. */
function modify(b: Book, dealId: string, change: Partial<Extract<BookAction, { t: "proposeModification" }>>) {
  let { after } = run(b, servicer, propose(dealId, change));
  const id = openModification(deal(after, dealId))!.id;
  after = run(after, uma, { t: "approveModification", dealId, modificationId: id, by: "x" }).after;
  after = run(after, ugo, { t: "approveModification", dealId, modificationId: id, by: "x" }).after;
  const signed = run(after, servicer, { t: "signModification", dealId, modificationId: id, on: serviceDay(after), reference: "MOD-1 (FAKE)", by: "x" });
  return { ...signed, id };
}

describe("a loan modification", () => {
  it("is proposed by servicing with a change that's allowed", () => {
    const b = demoBook();
    expect(check(b, person("b-x", ["BORROWER"]), propose("d13", { capitalize: true }))).toHaveProperty("error");
    expect(check(b, servicer, propose("d13"))).toEqual({ error: "Choose at least one change." });
    expect(check(b, servicer, propose("d13", { rate: 19 }))).toMatchObject({ error: expect.stringMatching(/Florida caps the rate on this loan at 18%/) });
    expect(check(b, servicer, propose("d13", { rate: noteRateOn(deal(b, "d13")) }))).toEqual({ error: "That's the rate it has now." });
    expect(check(b, servicer, propose("d10", { months: 6 }))).toMatchObject({ error: expect.stringMatching(/rental loan's term isn't extended/) });
    expect(check(b, servicer, propose("d10", { capitalize: true }))).toEqual({ error: "Nothing is behind to add to principal." });
    expect(check(b, servicer, propose("d1", { rate: 9 }))).toEqual({ error: "Only a loan being serviced can be modified." });
    expect(check(b, servicer, propose("d13", { capitalize: true, reason: "  " }))).toEqual({ error: "Say why the loan is being modified." });
  });

  it("needs two different approvers, then the borrower's signature", () => {
    const b = demoBook();
    let { after } = run(b, servicer, propose("d13", { capitalize: true }));
    const id = openModification(deal(after, "d13"))!.id;
    expect(check(after, servicer, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" })).toHaveProperty("error");
    expect(check(after, servicer, { t: "signModification", dealId: "d13", modificationId: id, on: serviceDay(after), reference: "M", by: "x" })).toEqual({ error: "It needs two approvals first." });
    after = run(after, uma, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" }).after;
    expect(check(after, uma, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" })).toEqual({ error: "A second, different approver is required." });
    expect(workQueue(after, { id: "" }, new Date("2026-10-31T15:00:00Z")).team.map((item) => item.label)).toContain("Decide the loan modification");
    after = run(after, ugo, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" }).after;
    expect(deal(after, "d13").modifications![0]).toMatchObject({ status: "approved", approvers: ["uma name", "ugo name"] });
    expect(check(after, servicer, { t: "signModification", dealId: "d13", modificationId: id, on: serviceDay(after), reference: " ", by: "x" })).toEqual({ error: "Enter the signed agreement's reference." });
    expect(check(after, servicer, { t: "signModification", dealId: "d13", modificationId: id, on: "2026-09-30", reference: "M", by: "x" })).toEqual({ error: "That's before the modification was proposed." });
    // Its terms start on the 1st of the month it's signed, so a signing from last month can't be recorded this month.
    expect(signProblem(deal(after, "d13"), { ...deal(after, "d13").modifications![0], proposedOn: "2026-10-20" }, "2026-10-31", "2026-11-02", false)).toMatch(/record it in that month/);
    // The borrower sees the agreed terms before signing; the team's reason and approvers stay behind.
    const mine = scopeBook(after, person(deal(after, "d13").borrowerId, ["BORROWER"])).deals.find((d) => d.id === "d13")!;
    expect(mine.modifications?.[0]).toMatchObject({ status: "approved", reason: "", approvers: [] });
  });

  it("adds what's behind to principal, cuts the rate and adds months, from the 1st of the month", () => {
    const b = demoBook();
    const before = deal(b, "d13");
    const l = ledger(before);
    const behind = l.rows.filter((row) => row.status === "late");
    expect(behind.map((row) => row.due)).toEqual(["2026-09-01", "2026-10-01"]);
    const rate = round2(noteRateOn(before) - 1);
    const { after, action } = modify(b, "d13", { capitalize: true, rate, months: 6 });
    const d13 = deal(after, "d13");
    const signed = d13.modifications![0].executed!;
    expect(signed).toMatchObject({ effectiveOn: "2026-10-01", capitalizedDues: ["2026-09-01", "2026-10-01"], capitalizedPayments: round2(behind.reduce((sum, row) => sum + row.amount, 0)), capitalizedFees: l.feesOwed, waivedFees: 0, toRate: rate });
    // Nothing is behind now, and the payments behind show as added to principal rather than paid.
    const now = ledger(d13);
    expect(now).toMatchObject({ amountDue: 0, paymentsLate: 0, feesOwed: 0, paidThrough: "2026-10-01" });
    expect(now.rows.filter((row) => row.status === "capitalized").map((row) => row.due)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(d13.status).toBe("servicing_current");
    // Principal is what was lent plus what was added, interest runs at the new rate on it, and it matures six months later.
    const added = signed.capitalizedPayments + signed.capitalizedFees;
    expect(capitalizedOf(d13)).toBeCloseTo(added, 2);
    expect(balanceOf(d13)).toBeCloseTo(balanceOf(before) + added, 2);
    const e = evaluate(d13.app);
    const basis = d13.app.accrual === "dutch" ? balanceOf(before) : e.noteAmount;
    expect(now.rows.find((row) => row.due === "2026-11-01")!.amount).toBeCloseTo(round2(ioPayment(basis + added, rate)), 2);
    expect(now.rows.find((row) => row.due === "2026-10-01")!.amount).toBeCloseTo(behind[1].amount, 2);
    expect(maturityOf(d13) > maturityOf(before)).toBe(true);
    expect(signed.toMaturity).toBe(maturityOf(d13));
    const payoff = payoffFor(d13, "2026-10-31", now);
    expect(payoff.accrued).toBeCloseTo((((d13.app.accrual === "dutch" ? balanceOf(d13) : e.noteAmount + added) * rate) / 100 / 360) * 30, 2);
    expect(letterFigures(d13, "2026-10-31", "2026-10-31").rate).toBe(rate);
    // The borrower hears the new terms; the work queue has nothing left on it.
    const told = alertsFor(b, after, action).find((alert) => alert.to === "borrower")!;
    expect(told).toMatchObject({ event: "modification.signed" });
    expect(told.body).toMatch(/Your next payment is \$[\d,]+\.\d\d, due November 1, 2026/);
    expect(workQueue(after, { id: "" }, new Date("2026-10-31T15:00:00Z")).team.filter((item) => item.deal?.id === "d13" && /past due|promise|modification|notice/i.test(item.label))).toEqual([]);
  });

  it("can waive the late fees instead, and leaves payments owed that it didn't add", () => {
    const b = demoBook();
    const before = ledger(deal(b, "d13"));
    const preview = modificationPreview(deal(b, "d13"), { waiveFees: true, capitalize: false }, serviceDay(b));
    expect(preview).toMatchObject({ capitalizedPayments: 0, capitalizedFees: 0, waivedFees: before.feesOwed, stillOwed: round2(before.pastDue) });
    const { after } = modify(b, "d13", { waiveFees: true });
    expect(ledger(deal(after, "d13"))).toMatchObject({ feesOwed: 0, pastDue: before.pastDue, paymentsLate: 2 });
  });

  it("ends a default once nothing is behind", () => {
    const b = run(demoBook(), person("o", ["ADMIN_OWNER"]), { t: "declareDefault", dealId: "d13", kind: "monetary", effectiveOn: "2026-10-15", note: "Two payments behind (FAKE)", by: "x" }).after;
    expect(deal(b, "d13").status).toBe("default");
    const { after } = modify(b, "d13", { capitalize: true });
    const d13 = deal(after, "d13");
    expect(d13.status).toBe("servicing_current");
    expect(d13.defaults![0].cured).toMatchObject({ note: "Cured by the modification" });
  });

  it("works a rental loan's payment out again at the new rate, and moves the investor's rate with it", () => {
    const b = demoBook();
    const before = deal(b, "d10");
    const rate = noteRateOn(before) - 0.5;
    const { after } = modify(b, "d10", { rate });
    const d10 = deal(after, "d10");
    const signed = d10.modifications![0].executed!;
    expect(signed.newPayment).toBeLessThan(signed.fromPayment);
    // A rate change alone doesn't move principal; the payments after it follow the new schedule.
    expect(balanceOf(d10)).toBeCloseTo(balanceOf(before), 2);
    const made = paymentsMade(d10);
    expect(rentalBalance(d10, made + 1)).toBeCloseTo(balanceOf(d10) - (signed.newPayment - (balanceOf(d10) * rate) / 100 / 12), 2);
    expect(ledgerOf(d10, "2026-12-15").rows.find((row) => row.due === "2026-11-01")!.amount).toBeCloseTo(signed.newPayment, 2);
    // An investor at 9% on a note priced at the old rate earns 0.5% less from the 1st of the month it was signed.
    const holding = { deal: d10, share: 0.5, investorRate: 9, noteRate: evaluate(d10.app).rate };
    expect(ratesOn(holding, "2026-09-15")).toEqual({ note: evaluate(d10.app).rate, investor: 9 });
    expect(ratesOn(holding, "2026-10-15").investor).toBeCloseTo(8.5, 6);
    const paid = { ...d10, payments: [...(d10.payments ?? []), { id: "p-nov", amount: signed.newPayment, receivedOn: "2026-11-01", method: "ach" as const, reference: "ACH", by: "x", at: "2026-11-01T15:00:00Z" }], servicedThrough: "2026-11-02" };
    const split = splitOf({ ...holding, deal: paid }, (day) => day.startsWith("2026-11"));
    expect(split.servicingFee).toBeCloseTo(split.interest * (1 - 8.5 / rate), 2);
  });

  it("can't be proposed or signed while the borrower is in bankruptcy", () => {
    let b = demoBook();
    const proposed = run(b, servicer, propose("d13", { capitalize: true })).after;
    b = run(proposed, servicer, { t: "recordBankruptcy", dealId: "d13", debtor: "Sample LLC", chapter: 11, caseNumber: "26-10001-ABC", court: "S.D. Fla.", filedOn: "2026-10-30", by: "x" }).after;
    const id = openModification(deal(b, "d13"))!.id;
    const filed = run(demoBook(), servicer, { t: "recordBankruptcy", dealId: "d13", debtor: "Sample LLC", chapter: 11, caseNumber: "26-10001-ABC", court: "S.D. Fla.", filedOn: "2026-10-30", by: "x" }).after;
    expect(check(filed, servicer, propose("d13", { capitalize: true }))).toMatchObject({ error: expect.stringMatching(/bankruptcy court/) });
    expect(check(b, uma, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" })).not.toHaveProperty("error");
    const approved = run(run(b, uma, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" }).after, ugo, { t: "approveModification", dealId: "d13", modificationId: id, by: "x" }).after;
    expect(check(approved, servicer, { t: "signModification", dealId: "d13", modificationId: id, on: serviceDay(approved), reference: "M", by: "x" })).toMatchObject({ error: expect.stringMatching(/bankruptcy/) });
  });
});
