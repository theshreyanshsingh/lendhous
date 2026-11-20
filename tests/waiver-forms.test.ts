import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { waiverFields, waiverText } from "@/lib/waiver-forms";
import { waiverPdf } from "@/lib/waiver-pdf";

const b = demoBook();
const deal = b.deals.find((item) => item.id === "d2")!;
const draw = b.draws.find((item) => item.dealId === "d2")!;

describe("Florida's statutory lien waivers, filled in (rank 21)", () => {
  it("fills the progress form with the contractor, the company, the property, the date and the draw", () => {
    const fields = waiverFields(deal, { ...draw, approved: 19_500 }, { key: "contractor", name: "Sample Construction (FAKE)" }, "progress", "2026-11-02");
    expect(fields).toMatchObject({ lienor: "Sample Construction (FAKE)", customer: "Sample Flips LLC (FAKE)", owner: "Sample Flips LLC (FAKE)", amount: 19_500, throughOn: "2026-11-02" });
    const form = waiverText(fields);
    expect(form.title).toBe("WAIVER AND RELEASE OF LIEN UPON PROGRESS PAYMENT");
    expect(form.body).toBe("The undersigned lienor, in consideration of the sum of $19,500.00, hereby waives and releases its lien and right to claim a lien for labor, services, or materials furnished through November 2, 2026 to Sample Flips LLC (FAKE) on the job of Sample Flips LLC (FAKE) to the following property:\n\n456 Placeholder Ave, Fort Lauderdale, Florida 33311, in Broward County\n\nThis waiver and release does not cover any retention or labor, services, or materials furnished after the date specified.");
    expect(form.cite).toBe("Fla. Stat. 713.20(4)");
  });

  it("leaves a supplier's amount to write in, and uses the final form on the last draw", () => {
    const supplier = waiverText(waiverFields(deal, draw, { key: "nto1", name: "Coastal Lumber Supply (FAKE)" }, "final", "2026-11-02"));
    expect(supplier.title).toBe("WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT");
    expect(supplier.body).toMatch(/^The undersigned lienor, in consideration of the final payment in the amount of \$________________, hereby waives/);
    expect(supplier.body).not.toMatch(/through/);
    expect(supplier.cite).toBe("Fla. Stat. 713.20(5)");
  });

  it("makes a one-page PDF to sign", async () => {
    const pdf = await waiverPdf(waiverFields(deal, draw, { key: "contractor", name: "Sample Construction (FAKE)" }, "progress", "2026-11-02"), deal.loanNumber);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
