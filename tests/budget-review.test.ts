import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { budgetReview, contractorKey, contractorRecord, lineRanges, peersOf } from "@/lib/budget-review";
import type { Deal } from "@/lib/mockData";

const b = demoBook();
const applied = b.deals.find((deal) => deal.id === "d1")!;
const rescope = (deal: Deal, change: Record<string, number>, extra: Deal["scope"] = []): Deal => ({ ...deal, scope: [...(deal.scope ?? []).map((line) => (line.id in change ? { ...line, budget: change[line.id] } : line)), ...(extra ?? [])] });

describe("the budget and contractor check before closing (rank 20)", () => {
  it("compares with funded loans of the same program in the county, or across Florida when the county has too few", () => {
    expect(peersOf(applied, b.deals)).toMatchObject({ where: "Broward County" });
    expect(peersOf(b.deals.find((deal) => deal.id === "d3")!, b.deals)).toMatchObject({ where: "Florida" });
    expect(peersOf(b.deals.find((deal) => deal.id === "d5")!, b.deals)).toMatchObject({ where: null, loans: [] });
    const ranges = lineRanges(peersOf(applied, b.deals).loans);
    expect(ranges.get("kitchen")).toMatchObject({ count: 5 });
    expect(ranges.get("kitchen")!.low).toBeCloseTo(0.16, 2);
  });

  it("calls a budget feasible, tight or short against the after-repair value", () => {
    expect(budgetReview(applied, b.deals)).toMatchObject({ verdict: "feasible" });
    expect(budgetReview({ ...applied, app: { ...applied.app, arv: 460_000 } }, b.deals).verdict).toBe("tight");
    const short = budgetReview({ ...applied, app: { ...applied.app, arv: 410_000 } }, b.deals);
    expect(short.verdict).toBe("short");
    expect(short.findings[0]).toMatchObject({ level: "bad", text: expect.stringMatching(/^The purchase and the work come to \$400,000, leaving 2% of the \$410,000/) });
  });

  it("flags a short line, a vague one, and lines that don't add up to the rehab", () => {
    const odd = rescope(applied, { kitchen: 2_000, flooring: 24_000 }, [{ id: "misc", division: "Misc and other items", budget: 9_000, released: 0 }]);
    const texts = budgetReview(odd, b.deals).findings.map((finding) => finding.text);
    expect(texts).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Kitchen is 2% of the budget; on LendHous's funded loans in Broward County it's usually about 16%\. It may be short\.$/),
      expect.stringMatching(/^"Misc and other items" \(\$9,000\) is too vague to inspect/),
      "The budget lines add up to $109,000, not the $100,000 rehab the loan was sized on.",
    ]));
  });

  it("finds the contractor on LendHous's other loans, however its name is spelled", () => {
    expect(contractorKey("Sample Construction, LLC (FAKE)")).toBe(contractorKey("sample construction"));
    const same = (deal: Deal): Deal => ({ ...deal, lienFile: { notices: [], contractor: "SAMPLE CONSTRUCTION LLC" } });
    const book = b.deals.map((deal) => (deal.id === "d13" ? { ...same(deal), overruns: [{ id: "o1", amount: 5_000, note: "", by: "x", at: "x" }] } : deal));
    const record = contractorRecord(b.deals.find((deal) => deal.id === "d2")!, book, b.draws);
    expect(record).toMatchObject({ loans: 1, funded: 1, withOverruns: 1, troubled: 1, loanNumbers: ["LH-DEMO-1013"] });
    expect(contractorRecord(applied, b.deals, b.draws)).toBeNull();
  });
});
