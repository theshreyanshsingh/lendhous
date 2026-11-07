import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { ACCOUNTS, monthJournal, ownShare } from "@/lib/journal";

const money = (value: number | string) => (typeof value === "number" ? value : 0);
const entries = (rows: ReturnType<typeof monthJournal>) => [...new Set(rows.map((row) => row["Journal No."]))].map((no) => rows.filter((row) => row["Journal No."] === no));

describe("the accounting journal", () => {
  it("balances every entry", () => {
    const b = demoBook();
    for (const month of ["2026-06", "2026-09", "2026-10"]) {
      const rows = monthJournal(b, month);
      expect(rows.length).toBeGreaterThan(0);
      for (const lines of entries(rows)) expect(lines.reduce((sum, row) => sum + money(row.Debits) - money(row.Credits), 0)).toBeCloseTo(0, 6);
    }
  });
  it("books a loan's closing: the advance, and the points and fees", () => {
    const b = demoBook();
    // d17 closed on October 20.
    const d17 = b.deals.find((d) => d.id === "d17")!;
    const e = evaluate(d17.app);
    const closing = monthJournal(b, "2026-10").filter((row) => row.Description.startsWith("LH-DEMO-1017") && row["Journal Date"] === "2026-10-20");
    expect(closing.find((row) => row.Description.includes("advanced at closing") && row["Account Name"] === ACCOUNTS.loans)?.Debits).toBe(e.initialAdvance);
    expect(closing.find((row) => row["Account Name"] === ACCOUNTS.origination)?.Credits).toBe(e.points + e.lenderFees);
  });
  it("splits payments into interest, principal and late fees, and books referral bonuses", () => {
    const b = demoBook();
    const october = monthJournal(b, "2026-10");
    expect(october.some((row) => row["Account Name"] === ACCOUNTS.interest && money(row.Credits) > 0)).toBe(true);
    // A rental's payment pays down principal as well as interest.
    const rental = b.deals.find((d) => d.id === "d10")!;
    const monthly = evaluate(rental.app).monthlyPayment;
    const paid = { ...b, deals: b.deals.map((d) => (d.id === "d10" ? { ...d, boardedThrough: "2026-10-01", payments: [{ id: "p1", amount: monthly, receivedOn: "2026-10-01", method: "ach" as const, reference: "", by: "x", at: "2026-10-01T15:00:00Z" }] } : d)) };
    const lines = monthJournal(paid, "2026-10").filter((row) => row.Description.startsWith("LH-DEMO-1010"));
    expect(lines.find((row) => row["Account Name"] === ACCOUNTS.loans && money(row.Credits) > 0)).toBeDefined();
    expect(lines.find((row) => row["Account Name"] === ACCOUNTS.cash)?.Debits).toBeCloseTo(monthly, 2);
    const april = monthJournal(b, "2026-04");
    expect(april.find((row) => row["Account Name"] === ACCOUNTS.referrals)).toMatchObject({ Debits: 500, "Journal Date": "2026-04-15", Description: "LH-DEMO-1012: referral bonus paid to Alex Sample (FAKE)" });
    expect(monthJournal(b, "2025-01")).toEqual([]);
  });
  it("notes LendHous's share when partners hold part of the loan", () => {
    const b = demoBook();
    expect(ownShare(b.deals.find((d) => d.id === "d11")!)).toBeCloseTo(0.5, 2);
    expect(ownShare(b.deals.find((d) => d.id === "d2")!)).toBe(1);
    expect(monthJournal(b, "2026-10").find((row) => row.Description.startsWith("LH-DEMO-1011"))?.Description).toMatch(/LendHous's share 50%/);
  });
});
