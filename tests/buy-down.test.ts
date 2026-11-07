import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { buyDownOptions, optionAt, quoteBuyDowns, ratePerPointOf, RATE_PER_POINT } from "@/lib/buy-down";
import { evaluate } from "@/lib/engine";
import { BORROWER_ID } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { pricingConfig } from "@/lib/pricing-config";
import { applyDraft, draftOf } from "@/lib/pricing-draft";
import { indicativeTerms, quoteApplication, type QuoteDeal } from "@/lib/quote";
import { ratePercent } from "@/lib/format";
import { experienceLabels, gridAdjustments, rateGrid } from "@/lib/rate-grid";
import { latestSheet, matrixOf, pricedApp, sheetContent, startingTerms } from "@/lib/term-sheets";
import { usuryCheck } from "@/lib/usury";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};
const underwriter = person("uw", ["UNDERWRITER"]);
const borrower = person(BORROWER_ID, ["BORROWER"]);
const deal = (b: Book, id = "d1") => b.deals.find((d) => d.id === id)!;
// d1 is the demo borrower's fix and flip in underwriting, with its credit review signed off so a term sheet can go.
const ready = (): Book => { const b = demoBook(); return { ...b, deals: b.deals.map((d) => (d.id === "d1" ? { ...d, creditReview: { by: "Uma", at: "2026-10-30T00:00:00Z", note: "", verifiedDeals: d.app.verifiedDeals } } : d)) }; };
const sent = () => { const b = ready(); return run(b, underwriter, { t: "issueTermSheet", dealId: "d1", ...startingTerms(deal(b)), by: "x" }); };

describe("the choices", () => {
  it("trade rate for points in quarter-point steps, inside the matrix and the usury cap", () => {
    const app = deal(ready()).app;
    const m = matrixOf(app);
    const start = startingTerms(deal(ready()));
    const options = buyDownOptions(pricedApp(app, start), { rate: start.rate, points: start.points }, { rate: m.rate, points: m.points });
    expect(options.length).toBeGreaterThan(2);
    expect(optionAt(options, start.points)).toMatchObject({ rate: start.rate, points: start.points });
    for (const option of options) {
      expect(option.points).toBeGreaterThanOrEqual(m.points[0] - 1e-9);
      expect(option.points).toBeLessThanOrEqual(m.points[1] + 1e-9);
      expect(option.rate).toBeGreaterThanOrEqual(m.rate[0] - 1e-9);
      expect(option.rate).toBeLessThanOrEqual(m.rate[1] + 1e-9);
      expect(option.rate).toBeCloseTo(start.rate - (option.points - start.points) * RATE_PER_POINT.shortTerm, 9);
      expect(usuryCheck({ amount: option.noteAmount, rate: option.rate, points: option.points, termMonths: start.termMonths }).overLender).toBe(false);
    }
    // More points cost more at closing and less each month.
    const [fewest, most] = [options[0], options[options.length - 1]];
    expect(most.cashToClose).toBeGreaterThan(fewest.cashToClose);
    expect(most.monthlyPayment).toBeLessThan(fewest.monthlyPayment);
  });
  it("drops any that would go over the usury cap with the points spread over a short term", () => {
    const app = { ...deal(ready()).app, termMonths: 3 };
    // Four points over three months is 16% a year on top of the rate: over Florida's 18% cap.
    const options = buyDownOptions(app, { rate: 12, points: 1 }, { rate: [10, 14], points: [0, 4] });
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => !usuryCheck({ amount: option.noteAmount, rate: option.rate, points: option.points, termMonths: 3 }).overLender)).toBe(true);
    expect(optionAt(options, 4)).toBeUndefined();
  });
  it("use the rate-per-point the owner publishes for each kind of loan, and the starting ones for older pricing", () => {
    expect(ratePerPointOf(pricingConfig, "dscr")).toBe(0.25);
    expect(ratePerPointOf(pricingConfig, "bridge")).toBe(0.5);
    const older = { ...pricingConfig, adjusters: { ...pricingConfig.adjusters, buyDownRatePerPoint: undefined, buyDownShortRatePerPoint: undefined } };
    expect([ratePerPointOf(older, "dscr"), ratePerPointOf(older, "fix_flip")]).toEqual([RATE_PER_POINT.rental, RATE_PER_POINT.shortTerm]);
    const draft = { ...draftOf(pricingConfig), buyDownRatePerPoint: 0.375, buyDownShortRatePerPoint: 0.75 };
    const published = applyDraft(pricingConfig, draft, "v-test");
    expect([ratePerPointOf(published, "dscr"), ratePerPointOf(published, "ground_up")]).toEqual([0.375, 0.75]);
  });
  it("show a rate to as many decimals as it has, at least two", () => {
    expect([ratePercent(11.5), ratePercent(11.125), ratePercent(11.5625), ratePercent(8)]).toEqual(["11.50%", "11.125%", "11.5625%", "8.00%"]);
  });
});

describe("on the quote", () => {
  const quote = (change: Partial<QuoteDeal> = {}): QuoteDeal => ({
    citizenship: "us", creditBand: "720-759", experience: "3-4", address: { street: "100 Test Way", city: "Hollywood", state: "FL", zip: "33020", county: "Broward" },
    propertyType: "sfr", loanType: "fix_flip", purpose: "purchase", purchasePrice: 300_000, rehab: 80_000, arv: 520_000, fundingDate: "2026-12-15", comps: [], exit: "sell", notes: "", ...change,
  });
  it("re-prices the indicative terms at the points picked, and ignores a pick the pricing doesn't allow", () => {
    const options = quoteBuyDowns(quoteApplication(quote())!, pricingConfig);
    const base = indicativeTerms(quote(), pricingConfig)!;
    const most = options[options.length - 1];
    const picked = indicativeTerms(quote({ buyDownPoints: most.points }), pricingConfig)!;
    expect(picked).toMatchObject({ rate: most.rate, pointsPct: most.points });
    expect(picked.rate).toBeLessThan(base.rate);
    expect(indicativeTerms(quote({ buyDownPoints: 9.75 }), pricingConfig)).toMatchObject({ rate: base.rate, pointsPct: base.pointsPct });
  });
});

describe("on the term sheet", () => {
  it("are fixed when it's sent, printed on it, and shown to no one as an exception", () => {
    const b = sent();
    const sheet = latestSheet(deal(b))!;
    expect(sheet.buyDowns!.length).toBeGreaterThan(1);
    expect(optionAt(sheet.buyDowns, sheet.terms.pointsPct)).toMatchObject({ rate: sheet.terms.rate });
    expect(sheetContent(deal(b), sheet).terms.find(([label]) => label === "Other rate choices")?.[1]).toMatch(/quarter-point steps: choose one when accepting/);
  });
  it("let the borrower accept one, which then becomes the loan's rate and points and the sheet's terms", () => {
    const b = sent();
    const sheet = latestSheet(deal(b))!;
    const most = sheet.buyDowns![sheet.buyDowns!.length - 1];
    const after = run(b, borrower, { t: "acceptTermSheet", dealId: "d1", signedName: "Alex Sample", points: most.points });
    const accepted = latestSheet(deal(after))!;
    expect(deal(after).app).toMatchObject({ termRate: most.rate, termPoints: most.points });
    expect(accepted).toMatchObject({ status: "accepted", boughtDown: { rate: sheet.terms.rate, pointsPct: sheet.terms.pointsPct }, terms: { rate: most.rate, pointsPct: most.points, cashToClose: most.cashToClose, monthlyPayment: most.monthlyPayment } });
    expect(evaluate(deal(after).app)).toMatchObject({ rate: most.rate, pointsPct: most.points });
    expect(sheetContent(deal(after), accepted).terms.find(([label]) => label === "Rate and points chosen")?.[1]).toMatch(/the borrower chose/);
  });
  it("keep the terms as sent when the borrower doesn't choose, and refuse a choice that isn't on it", () => {
    const b = sent();
    const sheet = latestSheet(deal(b))!;
    const kept = latestSheet(deal(run(b, borrower, { t: "acceptTermSheet", dealId: "d1", signedName: "Alex Sample" })))!;
    expect(kept.terms).toEqual(sheet.terms);
    expect(kept.boughtDown).toBeUndefined();
    const same = latestSheet(deal(run(b, borrower, { t: "acceptTermSheet", dealId: "d1", signedName: "Alex Sample", points: sheet.terms.pointsPct })))!;
    expect(same.boughtDown).toBeUndefined();
    expect(check(b, borrower, { t: "acceptTermSheet", dealId: "d1", signedName: "Alex Sample", points: 9.5 })).toEqual({ error: "That rate and points choice isn't on this term sheet." });
  });
});

describe("the public rate grid", () => {
  it("comes from the pricing, row by row", () => {
    const tables = rateGrid(pricingConfig);
    expect(tables.map((table) => table.key)).toEqual(["fix_flip", "bridge", "ground_up", "dscr"]);
    expect(experienceLabels(pricingConfig)).toEqual({ 1: "0–1 deals", 2: "2–4 deals", 3: "5–9 deals", 4: "10+ deals" });
    const flip = tables[0];
    const tier4 = pricingConfig.fixFlip.tiers[4];
    expect(flip.rows[3]).toEqual({ label: "10+ deals", cells: [`${tier4.rate[0]}–${tier4.rate[1]}%`, `${tier4.points[0]}–${tier4.points[1]}`, `${tier4.maxLTC * 100}%`, `${tier4.maxLTARV * 100}%`, `${tier4.maxInitialLTV * 100}%`, String(tier4.minFico)] });
    const dscr = tables[3];
    expect(dscr.rows[0].cells[0]).toBe(`${pricingConfig.dscr.grid[0][0]!.maxLTV * 100}% at ${pricingConfig.dscr.baseRate[0].toFixed(2)}%`);
    expect(dscr.rows[3].cells[3]).toBe("Not offered");
    // A new version on the pricing page changes the grid with it.
    const draft = draftOf(pricingConfig);
    const raised = applyDraft(pricingConfig, { ...draft, fixFlip: { ...draft.fixFlip, tiers: { ...draft.fixFlip.tiers, 4: { ...draft.fixFlip.tiers[4], rate: [9.75, 11] } } } }, "v-test");
    expect(rateGrid(raised)[0].rows[3].cells[0]).toBe("9.75–11%");
  });
  it("lists what moves the numbers, from the same pricing", () => {
    const lines = gridAdjustments(pricingConfig).join(" ");
    expect(lines).toMatch(/Condos: 5% less leverage and 0\.25% more/);
    expect(lines).toMatch(/Short-term rentals \(Airbnb, VRBO\): 80% of the last 12 months' payouts/);
    expect(lines).toMatch(/Each point you pay at closing takes 0\.5% off the rate on a flip, bridge or construction loan and 0\.25% on a rental/);
    expect(lines).toMatch(/Repeat borrowers: up to 1% off the rate and 0\.75 points/);
  });
});
