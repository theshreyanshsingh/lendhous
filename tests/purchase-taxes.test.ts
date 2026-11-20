import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { evaluate, purchaseTaxes, taxesForDscr } from "@/lib/engine";

const rental = demoBook().deals.find((deal) => deal.id === "d4")!.app;

describe("a rental purchase's taxes on its price (rank 22)", () => {
  it("estimates taxes on the price at the county's millage, and sizes on the higher figure", () => {
    expect(purchaseTaxes(rental)).toBeNull();
    expect(purchaseTaxes({ ...rental, millage: 20 })).toBe(7_000);
    expect(taxesForDscr({ ...rental, millage: 20 })).toBe(7_000);
    expect(taxesForDscr({ ...rental, millage: 15 })).toBe(6_000);
    expect(purchaseTaxes({ ...rental, purpose: "refi_rt", millage: 20 })).toBeNull();
    expect(purchaseTaxes({ ...rental, product: "fix_flip", millage: 20 })).toBeNull();
  });

  it("lowers the coverage when the price's taxes are higher, and says so", () => {
    const before = evaluate(rental);
    const after = evaluate({ ...rental, millage: 20 });
    expect(after.dscr!).toBeLessThan(before.dscr!);
    expect(after.flags).toContain("Taxes on the price: $7,000 a year at 20 mills, above the $6,000 bill; the DSCR uses the higher");
    expect(evaluate({ ...rental, millage: 15 }).flags.some((flag) => flag.startsWith("Taxes on the price"))).toBe(false);
    expect(evaluate({ ...rental, millage: 15 }).dscr).toBeCloseTo(before.dscr!, 10);
  });
});
