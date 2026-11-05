import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { borrowerStatementFor, gets1098, interestPaidIn, monthEnd, statementDue } from "@/lib/borrower-statements";
import { borrowerStatementPdf } from "@/lib/borrower-statement-pdf";
import type { Deal, LoanPayment } from "@/lib/mockData";
import { balanceOf, firstDueDate, ledgerOf, payoffFor } from "@/lib/servicing";

const book = demoBook();
const d2 = book.deals.find((deal) => deal.id === "d2")!;
const pay = (id: string, receivedOn: string, amount: number, reversed = false): LoanPayment => ({ id, amount, receivedOn, method: "wire", reference: id, by: "Sam", at: `${receivedOn}T15:00:00Z`, ...(reversed ? { reversed: { by: "Sam", at: `${receivedOn}T16:00:00Z`, reason: "Recalled" } } : {}) });

describe("a borrower's monthly statement", () => {
  it("goes to funded loans from the month they fund, and a paid-off loan's last one is the month it paid off", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(statementDue(d2, "2026-10")).toBe(true);
    expect(statementDue({ ...d2, closingDate: "2026-11-03" }, "2026-10")).toBe(false);
    expect(statementDue(book.deals.find((deal) => deal.status === "underwriting")!, "2026-10")).toBe(false);
    const paid = { ...d2, status: "paid_off" as const, paidOff: { amount: 1, receivedOn: "2026-10-20", method: "wire" as const, reference: "x", by: "x", at: "x", owed: 1 } };
    expect(statementDue(paid, "2026-10")).toBe(true);
    expect(statementDue(paid, "2026-11")).toBe(false);
    expect(borrowerStatementFor(book, paid, "2026-10")).toMatchObject({ paidOff: "2026-10-20", principal: 0, nextDue: null, payoff: null });
  });
  it("adds up what came in that month against the ledger, and shows what's due next and the payoff", () => {
    const first = firstDueDate(d2.closingDate);
    const deal: Deal = { ...d2, payments: [pay("a", "2026-10-01", 2000), pay("b", "2026-10-15", 1896), pay("c", "2026-10-20", 500, true), pay("d", "2026-09-30", 100)] };
    const statement = borrowerStatementFor(book, deal, "2026-10")!;
    expect(statement.payments.map((payment) => payment.on)).toEqual(["2026-10-01", "2026-10-15"]);
    expect(statement.received).toBe(3896);
    const next = ledgerOf(deal, "2026-11-01");
    expect(statement.nextDue?.on).toBe(next.nextDue);
    expect(statement.amountDue).toBe(next.amountDue);
    expect(statement.principal).toBe(balanceOf(deal));
    expect(statement.payoff?.goodThrough).toBe("2026-11-01");
    expect(statement.payoff?.total).toBe(payoffFor(deal, "2026-11-01", next).total);
    expect(statement.billed.every((bill) => bill.due.startsWith("2026-10-"))).toBe(true);
    expect(first <= "2026-11-01").toBe(true);
    expect(statement.holdback.total).toBe(statement.holdback.drawn + statement.holdback.remaining);
  });
  it("counts the interest for the 1098, which only an individual borrower over the threshold gets", () => {
    const deal: Deal = { ...d2, entityName: "", payments: [pay("a", "2026-10-01", 3896), pay("b", "2025-12-01", 100)] };
    expect(interestPaidIn(deal, 2026)).toBeGreaterThan(0);
    expect(gets1098(deal, 2026)).toBe(interestPaidIn(deal, 2026) >= 600);
    expect(gets1098({ ...deal, entityName: "Sample Flips LLC" }, 2026)).toBe(false);
  });
  it("makes a PDF", async () => {
    const statement = borrowerStatementFor(book, d2, "2026-10")!;
    expect((await borrowerStatementPdf(statement, "LendHous", "Wire to: LendHous Servicing\nReference: your loan number")).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
