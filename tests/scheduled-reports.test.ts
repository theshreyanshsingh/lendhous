import { describe, expect, it } from "vitest";
import { demoBook, serviceDay, type Book } from "@/lib/book";
import { DEMO_PARTNER_ID } from "@/lib/mockData";
import { dueOn, readyEmail, scheduledRows, scheduleProblem, scheduleWords } from "@/lib/scheduled-reports";
import { JOBS } from "@/lib/jobs";

const b = demoBook();
const today = serviceDay(b);

describe("scheduled reports by email (rank 23)", () => {
  it("lists the late loans, the ones maturing soon and what's owed by age", () => {
    expect(scheduledRows("delinquency", b, today)).toEqual([expect.objectContaining({ Loan: "LH-DEMO-1013", Borrower: "Placeholder Homes LLC (FAKE)", "Days past due": 60, "Payments late": 2, "To bring current": 5131.88 })]);
    expect(scheduledRows("maturities", b, today)).toEqual([expect.objectContaining({ Loan: "LH-DEMO-1014", "Days to maturity": 76, "Extension asked": "3 months, requested" })]);
    const [owed] = scheduledRows("receivables", b, today);
    expect(owed).toMatchObject({ Loan: "LH-DEMO-1013", "Within grace": 0, "1-30 days": 2443.75, "31-60 days": 2443.75, "Over 90 days": 0, Total: 5131.88 });
  });

  it("gives a partner only the loans its firm holds, with its share and no borrower named", () => {
    const partnerLoan = b.bids.find((bid) => bid.partnerId === DEMO_PARTNER_ID && bid.status === "accepted")!.dealId;
    // Make the partner's loan late, then it's on the partner's report, and the other late loan isn't.
    const late: Book = { ...b, deals: b.deals.map((deal) => (deal.id === partnerLoan ? { ...deal, payments: [] } : deal)) };
    const rows = scheduledRows("delinquency", late, today, { type: "partner", id: DEMO_PARTNER_ID });
    expect(rows).toEqual([expect.objectContaining({ Loan: "LH-DEMO-1011", "Your share": "50%", "Days past due": 60 })]);
    for (const row of rows) {
      expect(row).not.toHaveProperty("Borrower");
      expect(row["Your share"]).toMatch(/%$/);
    }
    expect(scheduledRows("maturities", b, today, { type: "partner", id: DEMO_PARTNER_ID }).every((row) => !("Borrower's exit" in row))).toBe(true);
  });

  it("goes out weekly on its weekday or monthly on its day, once", () => {
    // November 23, 2026 is a Monday.
    expect(dueOn({ every: "week", day: 1 }, "2026-11-23")).toBe(true);
    expect(dueOn({ every: "week", day: 2 }, "2026-11-23")).toBe(false);
    expect(dueOn({ every: "week", day: 1, lastSent: "2026-11-23" }, "2026-11-23")).toBe(false);
    expect(dueOn({ every: "month", day: 1 }, "2026-12-01")).toBe(true);
    expect(scheduleWords({ every: "month", day: 22 })).toBe("Monthly on the 22nd");
    expect(scheduleProblem({ kind: "delinquency", every: "month", day: 31, to: [{ id: "u", name: "U" }] })).toMatch(/1 to 28/);
    expect(scheduleProblem({ kind: "delinquency", every: "week", day: 3, to: [] })).toBe("Choose who it goes to.");
    expect(JOBS).toHaveProperty("reports");
  });

  it("emails a link, never the file", () => {
    const email = readyEmail({ kind: "receivables", every: "week", day: 1 }, 3, "https://lendhous.example", "2026-11-23");
    expect(email.body).toContain("https://lendhous.example/api/reports/scheduled/receivables");
    expect(email.body).not.toMatch(/LH-|FAKE|\$/);
  });
});
