import { describe, expect, it } from "vitest";
import { demoBook, serviceDay } from "@/lib/book";
import type { Deal } from "@/lib/mockData";
import { balanceOf } from "@/lib/servicing";
import { SMALL_GROUP, trackLoan, trackRecord } from "@/lib/track-record";

const b = demoBook();
const bridge = b.deals.find((deal) => deal.status === "servicing_current" && deal.app.product === "bridge")!;
const balance = balanceOf(bridge);
const paidOff = (change: Partial<NonNullable<Deal["paidOff"]>>, extra: Partial<Deal> = {}): Deal => ({ ...bridge, ...extra, status: "paid_off", paidOff: { amount: balance + 3000, owed: balance + 3000, receivedOn: "2026-10-20", method: "wire", reference: "W-1 (FAKE)", by: "x", at: "x", ...change } });

describe("the track record partners and buyers see under the NDA (rank 17)", () => {
  it("counts every funded loan in the demo book, with nothing ended yet and a small-count warning", () => {
    const record = trackRecord(b, serviceDay(b));
    const funded = b.deals.filter((deal) => ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off", "reo"].includes(deal.status));
    expect(record.overall).toMatchObject({ funded: funded.length, paidOff: 0, open: funded.length, realizedYield: null, medianDays: null, lateNow: 1, small: funded.length < SMALL_GROUP });
    expect(record.byProgram.reduce((sum, row) => sum + row.funded, 0)).toBe(funded.length);
    expect(record.byVintage.map((row) => row.label)).toEqual(["Funded in 2026"]);
    // Totals only: no loan numbers, addresses or names.
    expect(JSON.stringify(record)).not.toMatch(/LH-|Placeholder|FAKE/);
  });

  it("earns a paid-off loan its yield, and charges a foreclosure sale's shortfall as a loss", () => {
    const paid = trackLoan(paidOff({}))!;
    expect(paid.resolved).toMatchObject({ days: 112, lent: balance, loss: 0 });
    const yearly = (paid.resolved!.interest / paid.resolved!.lent / (112 / 365)) * 100;
    expect(yearly).toBeGreaterThan(5);
    expect(yearly).toBeLessThan(15);

    const short = paidOff({ amount: balance * 0.8, owed: balance + 9000, foreclosureSale: { saleOn: "2026-10-15", shortfall: balance * 0.2 + 9000 } }, { defaults: [{ id: "def1", kind: "monetary", effectiveOn: "2026-05-01", note: "", by: "x", at: "x" } as unknown as NonNullable<Deal["defaults"]>[number]] });
    const lost = trackLoan(short)!;
    expect(lost).toMatchObject({ defaulted: true, foreclosed: true, resolved: { lent: balance, loss: balance * 0.2, recovered: balance * 0.8 } });

    const record = trackRecord({ deals: [paidOff({}), short] }, "2026-10-31").overall;
    expect(record).toMatchObject({ funded: 2, paidOff: 2, open: 0, defaults: 1, foreclosures: 1, losses: Math.round(balance * 0.2), recoveries: Math.round(balance * 0.8), medianDays: 112 });
    expect(record.realizedYield).toBeLessThan(0);
  });

  it("leaves out loans that never funded", () => {
    expect(b.deals.filter((deal) => deal.status === "underwriting").map(trackLoan)).toEqual([null, null]);
  });
});
