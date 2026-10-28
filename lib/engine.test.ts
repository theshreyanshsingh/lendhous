import { describe, it, expect } from "vitest";
import * as E from "./engine";
import { pricingConfig } from "./pricing-config";

// Spec v3 Section 5.1 worked-example deal
const P = 300_000, R = 100_000, ARV = 550_000;
const tier2 = pricingConfig.fixFlip.tiers[2];

describe("Spec 5.1 worked example A — sizing & core ratios", () => {
  const s = E.sizeFixFlip({ purchasePrice: P, rehab: R, arv: ARV, asIs: P, costBasis: P + R, limits: tier2 });
  it("L_max = $340k with LTC binding", () => {
    expect(s.loan).toBe(340_000);
    expect(s.binding).toBe("LTC");
    expect(s.candidates.LTARV).toBeCloseTo(385_000, 6);
    expect(s.candidates["Initial LTV + rehab"]).toBeCloseTo(355_000, 6);
  });
  it("initial advance $240k = 80% of purchase", () => {
    expect(s.initialAdvance).toBe(240_000);
    expect(E.initialLtv(s.initialAdvance, P)).toBeCloseTo(0.8, 10);
  });
  it("LTC 85%, LTARV 61.8%, LTV 113.3%", () => {
    expect(E.ltc(340_000, 400_000)).toBeCloseTo(0.85, 10);
    expect(E.ltarv(340_000, ARV)).toBeCloseTo(0.6182, 4);
    expect(E.ltv(340_000, P)).toBeCloseTo(1.1333, 4);
  });
  it("Tier 1 is capped at 80% LTC = $320k", () => {
    const t1 = E.sizeFixFlip({ purchasePrice: P, rehab: R, arv: ARV, asIs: P, costBasis: P + R, limits: pricingConfig.fixFlip.tiers[1] });
    expect(t1.loan).toBe(320_000);
  });
  it("requested amount below max becomes binding", () => {
    const r = E.sizeFixFlip({ purchasePrice: P, rehab: R, arv: ARV, asIs: P, costBasis: P + R, limits: tier2, requested: 300_000 });
    expect(r.loan).toBe(300_000); expect(r.binding).toBe("Requested amount"); expect(r.initialAdvance).toBe(200_000);
  });
  it("as-is value = lesser of price and appraisal", () => {
    expect(E.asIsValue(300_000, 280_000)).toBe(280_000);
    expect(E.asIsValue(300_000, 320_000)).toBe(300_000);
  });
  it("refi cost basis = original price + rehab spent + remaining rehab", () => {
    expect(E.costBasis({ purpose: "refi_rt", purchasePrice: 0, rehab: 50_000, originalPurchasePrice: 250_000, rehabSpent: 30_000 })).toBe(330_000);
  });
});

describe("Worked example B — interest reserve", () => {
  it("full-boat 12 months at 11% on $340k = $37,400", () => {
    expect(E.fullBoatReserve(340_000, 11, 12)).toBeCloseTo(37_400, 6);
  });
  it("Dutch with $25k draws end of months 1–4 = $35,108.33", () => {
    expect(E.round2(E.dutchReserve(240_000, E.evenDraws(100_000, 4), 11, 12))).toBe(35_108.33);
  });
  it("add-on reserve compounds: $42,022.47 and pushes LTC to 95.5%", () => {
    const r = E.addOnReserve(340_000, 11, 12);
    expect(E.round2(r)).toBe(42_022.47);
    expect(E.ltc(340_000 + r, 400_000)).toBeCloseTo(0.9551, 4);
  });
  it("carving the reserve out of the note drops initial advance to $202,600", () => {
    const s = E.sizeFixFlip({ purchasePrice: P, rehab: R, arv: ARV, asIs: P, costBasis: P + R, limits: tier2 });
    expect(s.loan - s.holdback - 37_400).toBe(202_600);
  });
});

describe("Worked example C — flip profit", () => {
  const base = { purchasePrice: P, rehab: R, arv: ARV, initialAdvance: 240_000, closingCosts: 6_000, points: 6_800, lenderFees: 1_500, otherHolding: 9_000, sellingCostPct: 0.07 };
  it("full-boat: TPC $489,850, profit $60,150, margin 10.9%, ROI 54.0%", () => {
    const f = E.flipAnalysis({ ...base, totalInterest: E.fullBoatReserve(340_000, 11, 9) });
    expect(f.tpc).toBeCloseTo(489_850, 6);
    expect(f.profit).toBeCloseTo(60_150, 6);
    expect(f.margin).toBeCloseTo(0.10936, 4);
    expect(f.cashInvested).toBeCloseTo(111_350, 6);
    expect(f.roi).toBeCloseTo(0.5402, 4);
  });
  it("Dutch: interest $25,758.33, profit $62,441.67", () => {
    const i = E.dutchReserve(240_000, E.evenDraws(100_000, 4), 11, 9);
    expect(E.round2(i)).toBe(25_758.33);
    expect(E.round2(E.flipAnalysis({ ...base, totalInterest: i }).profit)).toBe(62_441.67);
  });
  it("interest paid from a financed reserve is not cash invested", () => {
    const f = E.flipAnalysis({ ...base, totalInterest: 28_050, interestFromFinancedReserve: 28_050 });
    expect(f.cashInvested).toBeCloseTo(111_350 - 28_050, 6);
  });
});

describe("Worked example D — cash to close", () => {
  it("$74,300, or $64,300 after $10k EMD", () => {
    const c = { purchasePrice: P, closingCosts: 6_000, points: 6_800, lenderFees: 1_500, initialAdvance: 240_000 };
    expect(E.cashToClosePurchase(c)).toBe(74_300);
    expect(E.cashToClosePurchase({ ...c, earnestMoneyPaid: 10_000 })).toBe(64_300);
  });
  it("refi with cash out is negative", () => {
    expect(E.cashToCloseRefi({ lienPayoffs: 150_000, closingCosts: 3_000, points: 4_000, lenderFees: 1_500, initialAdvance: 200_000 })).toBe(-41_500);
  });
});

describe("Worked example E — DSCR", () => {
  it("P&I $1,957.80 → DSCR 1.12; IO → 1.21", () => {
    const pi = E.amortizingPayment(280_000, 7.5, 360);
    expect(E.round2(pi)).toBe(1_957.8);
    const a = E.dscr({ monthlyRent: 3_200, payment: pi, taxesAnnual: 6_000, insuranceAnnual: 4_800 });
    expect(E.round2(a.pitia)).toBe(2_857.8);
    expect(a.dscr).toBeCloseTo(1.1197, 4);
    const io = E.dscr({ monthlyRent: 3_200, payment: E.ioPayment(280_000, 7.5), taxesAnnual: 6_000, insuranceAnnual: 4_800 });
    expect(io.dscr).toBeCloseTo(1.2075, 4);
  });
});

describe("Worked example F — payoff", () => {
  it("$341,808.33 good through day 15; per diem $103.89", () => {
    const q = E.payoffQuote({ disbursedPrincipal: 340_000, ratePct: 11, daysAccrued: 15, payoffFees: 250 });
    expect(q.perDiem).toBe(103.89);
    expect(q.accrued).toBe(1_558.33);
    expect(q.total).toBe(341_808.33);
  });
  it("undisbursed holdback is not owed (only disbursed principal)", () => {
    const q = E.payoffQuote({ disbursedPrincipal: 290_000, ratePct: 11, daysAccrued: 0 });
    expect(q.total).toBe(290_000);
  });
});

describe("Worked example G — draw release", () => {
  const line = { budget: 30_000, observedPct: 0.7, retainagePct: 0.1, releasedToDate: 9_000, requested: 15_000 };
  it("v3 formula approves $9,900", () => {
    expect(E.drawLineApproved(line).approved).toBeCloseTo(9_900, 6);
  });
  it("v2 formula would have paid $10,800 (under-held retainage)", () => {
    expect(E.drawLineApprovedV2(line)).toBeCloseTo(10_800, 6);
  });
  it("never negative and never above 100% complete", () => {
    expect(E.drawLineApproved({ ...line, observedPct: 0.2 }).approved).toBe(0);
    expect(E.drawLineApproved({ ...line, observedPct: 1.5, releasedToDate: 0, requested: 99_999 }).approved).toBeCloseTo(27_000, 6);
  });
  it("out-of-balance or delinquent loan blocks the draw", () => {
    expect(E.inBalanceTest({ remainingHoldback: 40_000, balancingDeposits: 0, costToComplete: 55_000 })).toEqual({ inBalance: false, shortfall: 15_000 });
    expect(E.approveDraw([line], { holdbackRemaining: 50_000, inBalance: false, loanCurrent: true }).blocked).toBe("Loan out of balance");
    expect(E.approveDraw([line], { holdbackRemaining: 50_000, inBalance: true, loanCurrent: false }).approved).toBe(0);
    expect(E.approveDraw([line], { holdbackRemaining: 5_000, inBalance: true, loanCurrent: true }).approved).toBe(5_000);
  });
});

describe("Worked example H — capital availability", () => {
  it("$1,360,000 available", () => {
    expect(E.capitalAvailable({ commitment: 5_000_000, reserved: 400_000, committed: 340_000, deployed: 2_600_000, unfunded: 300_000 })).toBe(1_360_000);
  });
  it("credit line capped by undrawn balance", () => {
    expect(E.capitalAvailable({ commitment: 1_000_000, reserved: 0, committed: 0, deployed: 0, unfunded: 0, lineUndrawn: 600_000 })).toBe(600_000);
  });
});

describe("Worked example I — all-in cost", () => {
  it("13% + 3 pts + $1,500 on $200k: 16.75% at 12 mo, 20.5% at 6 mo", () => {
    expect(E.allInCost(13, 6_000, 1_500, 200_000, 12)).toBeCloseTo(0.1675, 10);
    expect(E.allInCost(13, 6_000, 1_500, 200_000, 6)).toBeCloseTo(0.205, 10);
  });
});

describe("Tiers, colors, score, routing", () => {
  it("experience tier band edges (lower-bound inclusive)", () => {
    expect([0, 1, 2, 4, 5, 9, 10, 25].map((n) => E.experienceTier(n))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it("ratio colors", () => {
    expect(E.ratioColor(0.618, 0.7)).toBe("green");
    expect(E.ratioColor(0.68, 0.7)).toBe("yellow");
    expect(E.ratioColor(0.85, 0.85)).toBe("yellow");
    expect(E.ratioColor(0.86, 0.85)).toBe("red");
    expect(E.ratioColor(1.12, 1.0, "min")).toBe("green");
    expect(E.ratioColor(1.05, 1.0, "min")).toBe("yellow");
    expect(E.ratioColor(0.95, 1.0, "min")).toBe("red");
  });
  it("score weights add to 100 and a perfect deal scores 100 (A)", () => {
    const w = pricingConfig.score.weights;
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100);
    const s = E.dealScore({ product: "fix_flip", leverageActual: 0.5, leverageLimit: 0.7, fico: 780, tier: 4, profitMargin: 0.3, reserveMonths: 12, location: "core", valuationSource: "appraisal" });
    expect(s.score).toBe(100); expect(s.grade).toBe("A");
  });
  it("over-limit leverage scores 0 on leverage; grade bands", () => {
    const s = E.dealScore({ product: "fix_flip", leverageActual: 0.8, leverageLimit: 0.7, fico: 600, tier: 1, profitMargin: 0.05, reserveMonths: 0, location: "partner_only", valuationSource: "avm" });
    expect(s.factors.leverage).toBe(0); expect(s.grade).toBe("E");
  });
  it("routing rules evaluate in order with reasons", () => {
    expect(E.recommendRoute({ product: "dscr", noteAmount: 300_000, grade: "A", location: "core", inHouseAvailable: 9e9 }).route).toBe("PARTNER");
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 2_000_000, grade: "A", location: "core", inHouseAvailable: 9e9 }).route).toBe("SPLIT");
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 340_000, grade: "D", location: "core", inHouseAvailable: 9e9 }).route).toBe("PARTNER_OR_DECLINE");
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 340_000, grade: "A", location: "expansion", inHouseAvailable: 9e9 }).route).toBe("PARTNER");
    // v3 fix: compare against note amount (holdback already inside it)
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 340_000, grade: "B", location: "core", inHouseAvailable: 345_000 }).route).toBe("IN_HOUSE");
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 340_000, grade: "B", location: "core", inHouseAvailable: 300_000 }).route).toBe("SPLIT");
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 340_000, grade: "C", location: "core", inHouseAvailable: 9e9 }).route).toBe("MANUAL");
    expect(E.recommendRoute({ product: "fix_flip", noteAmount: 340_000, grade: "A", location: "core", inHouseAvailable: 9e9, gtIsBorrower: true }).route).toBe("MANUAL");
  });
  it("split falls back to partner when disabled (MVP)", () => {
    const cfg = { ...pricingConfig, routing: { ...pricingConfig.routing, splitEnabled: false } };
    const r = E.recommendRoute({ product: "fix_flip", noteAmount: 2_000_000, grade: "A", location: "core", inHouseAvailable: 9e9 }, cfg);
    expect(r.route).toBe("PARTNER"); expect(r.reasons.join(" ")).toMatch(/Split not enabled/);
  });
});

describe("evaluate() — instant estimate end to end", () => {
  const app: E.Application = { product: "fix_flip", purpose: "purchase", county: "Broward", state: "FL", propertyType: "sfr", occupancy: "vacant", purchasePrice: P, rehab: R, arv: ARV, interestReserve: "none", accrual: "full_boat", fico: 720, verifiedDeals: 3, liquidity: 150_000 };
  it("matches worked example A sizing for a Tier 2 borrower", () => {
    const e = E.evaluate(app);
    expect(e.tier).toBe(2); expect(e.noteAmount).toBe(340_000); expect(e.initialAdvance).toBe(240_000); expect(e.holdback).toBe(100_000);
    expect(e.eligible).toBe(true); expect(e.binding).toBe("LTC");
    expect(e.ratios.find((r) => r.key === "ltc")!.color).toBe("yellow"); // at the limit
    expect(e.ratios.find((r) => r.key === "ltarv")!.color).toBe("green");
  });
  it("owner-occupied is a hard stop", () => {
    expect(E.evaluate({ ...app, occupancy: "owner_occupied" }).eligible).toBe(false);
  });
  it("FICO below minimum is a hard stop", () => {
    expect(E.evaluate({ ...app, fico: 600 }).hardStops.join()).toMatch(/FICO/);
  });
  it("expansion county cuts leverage 5 points", () => {
    const e = E.evaluate({ ...app, county: "Lee" });
    expect(e.noteAmount).toBe(320_000); // 80% LTC
  });
  it("financed reserve is carved out of the note, not added on top", () => {
    const e = E.evaluate({ ...app, interestReserve: "financed" });
    expect(e.noteAmount).toBe(340_000);
    expect(e.initialAdvance + e.holdback + e.financedReserve).toBeCloseTo(340_000, 6);
  });
  it("DSCR picks the best eligible grid column", () => {
    const e = E.evaluate({ ...app, product: "dscr", purchasePrice: 350_000, rehab: 0, arv: 350_000, monthlyRent: 3_200, taxesAnnual: 6_000, insuranceAnnual: 4_800, fico: 765 });
    expect(e.dscr!).toBeGreaterThanOrEqual(1.0);
    expect(e.noteAmount).toBeLessThanOrEqual(0.8 * 350_000);
  });
  it("bridge uses as-is LTV", () => {
    const e = E.evaluate({ ...app, product: "bridge", rehab: 0, verifiedDeals: 6 });
    expect(e.noteAmount).toBe(225_000); // 75% of 300k (tier 3)
  });
  it("small-loan +0.5% is in the payment and financed reserve, not just the headline rate", () => {
    const e = E.evaluate({ ...app, purchasePrice: 80_000, rehab: 20_000, arv: 150_000, interestReserve: "financed" });
    expect(e.noteAmount).toBe(85_000); // 85% LTC of $100k
    expect(e.rate).toBeCloseTo(12, 10); // 11.5 mid + 0.5
    expect(e.monthlyPayment).toBe(850);
    expect(e.financedReserve).toBe(10_200);
    expect(e.flags.join()).toMatch(/< \$100k/);
  });
  it("small-loan +0.5% is in the DSCR qualifying payment", () => {
    const e = E.evaluate({ ...app, product: "dscr", purchasePrice: 120_000, rehab: 0, arv: 120_000, monthlyRent: 1_500, taxesAnnual: 1_800, insuranceAnnual: 1_200, fico: 770 });
    expect(e.noteAmount).toBe(96_000);
    expect(e.rate).toBeCloseTo(8.25, 10); // 7.75 mid + 0.5
    const pi = E.amortizingPayment(96_000, 8.25, 360);
    expect(e.monthlyPayment).toBe(E.round2(pi));
    expect(e.dscr!).toBeCloseTo(E.dscr({ monthlyRent: 1_500, payment: pi, taxesAnnual: 1_800, insuranceAnnual: 1_200 }).dscr, 10);
  });
  it("$3M max overall caps the note before holdback, initial advance and ratios are set", () => {
    const e = E.evaluate({ ...app, purchasePrice: 3_000_000, rehab: 1_000_000, arv: 6_000_000, verifiedDeals: 12, fico: 780, liquidity: 2_000_000 });
    expect(e.noteAmount).toBe(3_000_000); // uncapped: 90% LTC = $3.6M
    expect(e.maxLoan).toBe(3_000_000); expect(e.binding).toBe("Max loan size");
    expect(e.holdback).toBe(1_000_000); expect(e.initialAdvance).toBe(2_000_000);
    expect(e.ratios.find((r) => r.key === "ltc")!.actual).toBeCloseTo(0.75, 10);
    expect(e.flags.join()).toMatch(/capped/);
    const b = E.evaluate({ ...app, product: "bridge", purchasePrice: 5_000_000, rehab: 0, arv: 5_000_000, verifiedDeals: 6, liquidity: 2_000_000 });
    expect(b.noteAmount).toBe(3_000_000); expect(b.initialAdvance).toBe(3_000_000);
    expect(b.ratios[0].actual).toBeCloseTo(0.6, 10);
  });
  it("requested amount below the cap still binds", () => {
    const s = E.sizeFixFlip({ purchasePrice: P, rehab: R, arv: ARV, asIs: P, costBasis: P + R, limits: tier2, cap: 320_000, requested: 300_000 });
    expect(s.loan).toBe(300_000); expect(s.maxLoan).toBe(320_000); expect(s.binding).toBe("Requested amount");
  });
  it("all-in cost spreads points and fees over the actual term (Spec 5.1)", () => {
    // 11.5% rate, 2.25 points ($7,650) + $1,500 fees on $340k = 2.691% of the loan
    expect(E.evaluate({ ...app, termMonths: 18 }).allIn).toBeCloseTo(0.115 + (9_150 / 340_000) * (12 / 18), 10);
    expect(E.evaluate({ ...app, termMonths: 12 }).allIn).toBeCloseTo(0.115 + 9_150 / 340_000, 10);
    expect(E.evaluate({ ...app, termMonths: 6 }).allIn).toBeCloseTo(0.115 + (9_150 / 340_000) * 2, 10);
  });
  it("funded balances: Dutch interest on disbursed principal, full-boat on the note", () => {
    const dutch = E.evaluate({ ...app, accrual: "dutch" });
    const b = E.fundedBalances(dutch, { product: "fix_flip", accrual: "dutch" }, 70_000);
    expect(b.disbursed).toBe(310_000); expect(b.holdbackRemaining).toBe(30_000);
    expect(b.nextPayment).toBe(2_970.83); // 310,000 × 11.5% ÷ 12
    expect(E.fundedBalances(dutch, { product: "fix_flip", accrual: "dutch" }).nextPayment).toBe(dutch.monthlyPayment); // before any draw
    const full = E.evaluate(app);
    expect(E.fundedBalances(full, app, 70_000).nextPayment).toBe(3_258.33); // 340,000 × 11.5% ÷ 12
  });
  it("maturity date = closing + term, clamped to month end", () => {
    expect(E.maturityDate("2026-09-04", 12)).toBe("2027-09-04");
    expect(E.maturityDate("2026-11-30", 18)).toBe("2028-05-30");
    expect(E.maturityDate("2027-01-31", 1)).toBe("2027-02-28");
    expect(E.maturityDate("2027-08-31", 6)).toBe("2028-02-29"); // leap year
  });
  it("funded balances: DSCR next payment is the amortizing P&I", () => {
    const d = { ...app, product: "dscr" as const, purchasePrice: 350_000, rehab: 0, arv: 350_000, monthlyRent: 3_200, taxesAnnual: 6_000, insuranceAnnual: 4_800, fico: 765 };
    const e = E.evaluate(d);
    expect(E.fundedBalances(e, d).nextPayment).toBe(e.monthlyPayment);
  });
});
