import { describe, expect, it } from "vitest";
import { cashFlows, holdingOf, pricePaid, tapeOf, yieldAtPrice } from "@/lib/loan-sale";
import { seedDeals, seedLoanSales } from "@/lib/mockData";

const interestOnly = { balance: 400_000, ratePct: 11, months: 12 };

describe("loan buyer arithmetic", () => {
  it("at par an interest-only loan yields its rate, less servicing", () => {
    expect(yieldAtPrice(interestOnly, 100)).toBe(10);
    expect(yieldAtPrice(interestOnly, 100, 0)).toBe(11);
  });
  it("a discount raises the yield and a premium lowers it", () => {
    expect(yieldAtPrice(interestOnly, 98)).toBeGreaterThan(yieldAtPrice(interestOnly, 100));
    expect(yieldAtPrice(interestOnly, 102)).toBeLessThan(yieldAtPrice(interestOnly, 100));
    // Checked by hand: at 12.13% a year, $0.8333 a month for 12 months plus $100 at the end is worth $98.00.
    expect(yieldAtPrice(interestOnly, 98)).toBeCloseTo(12.13, 2);
  });
  it("the same discount is worth more on a shorter loan", () => {
    expect(yieldAtPrice({ ...interestOnly, months: 3 }, 98)).toBeGreaterThan(yieldAtPrice({ ...interestOnly, months: 12 }, 98));
  });
  it("pays interest monthly and the balance at the end", () => {
    const flows = cashFlows({ balance: 120_000, ratePct: 12, months: 3 }, 0);
    expect(flows).toEqual([1_200, 1_200, 121_200]);
  });
  it("an amortizing loan at par yields its rate, and its balance runs down to nothing", () => {
    const payment = 2_338.87; // $315,000 at 8.125% over 30 years
    const note = { balance: 315_000, ratePct: 8.125, months: 360, monthlyPayment: payment };
    expect(yieldAtPrice(note, 100, 0)).toBeCloseTo(8.125, 1);
    const flows = cashFlows(note, 0);
    expect(flows[0]).toBeCloseTo(payment, 2);
    expect(flows.reduce((sum, flow) => sum + flow, 0)).toBeGreaterThan(315_000);
  });
  it("prices in dollars from a percent of the balance", () => {
    expect(pricePaid(360_000, 99.5)).toBe(358_200);
  });
});

describe("the loan tape", () => {
  const tapes = seedLoanSales.map((sale) => ({ sale, deal: seedDeals.find((item) => item.id === sale.dealId)!, tape: tapeOf(seedDeals.find((item) => item.id === sale.dealId)!, sale) }));
  it("names no borrower, entity or street", () => {
    for (const { deal, tape } of tapes) {
      const text = JSON.stringify(tape);
      for (const secret of [deal.borrowerName, deal.entityName, deal.address, deal.zip]) expect(text).not.toContain(secret);
    }
  });
  it("shows the draws a buyer would still have to fund", () => {
    const groundUp = tapes.find(({ deal }) => deal.id === "d12")!.tape;
    expect(groundUp.holdbackLeft).toBe(420_000);
    expect(groundUp.balance).toBe(388_000);
  });
  it("counts a rental loan's balance after its payments", () => {
    const rental = tapes.find(({ deal }) => deal.id === "d10")!.tape;
    expect(rental.balance).toBeLessThan(rental.noteAmount);
    expect(rental.balance).toBeGreaterThan(rental.noteAmount * 0.98);
  });
  it("flags a late loan and prices it to yield more", () => {
    const late = tapes.find(({ deal }) => deal.id === "d13")!.tape;
    expect(late.current).toBe(false);
    expect(late.paymentsLate).toBe(2);
    expect(late.askYield).toBeGreaterThan(tapes.find(({ deal }) => deal.id === "d9")!.tape.askYield);
  });
  it("every sample loan is eligible, has time left and a sensible price", () => {
    for (const { tape } of tapes) {
      expect(tape.balance).toBeGreaterThan(0);
      expect(tape.monthsLeft).toBeGreaterThan(0);
      expect(tape.askYield).toBeGreaterThan(5);
    }
    const sold = tapes.find(({ sale }) => sale.status === "sold")!;
    expect(holdingOf(sold.tape, sold.sale.soldPct!).paid).toBeCloseTo(sold.tape.balance * 0.9925, 2);
  });
});
