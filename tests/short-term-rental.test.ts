import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { blankDraft, nightly, stepProblems, toLoan } from "@/lib/borrower-application";
import { DEFAULT_LIBRARY, templatesFor } from "@/lib/conditions";
import { needsList } from "@/lib/credit";
import { evaluate, qualifyingRent, shortTermFactor, shortTermOf, type Application } from "@/lib/engine";
import { can, type Permission } from "@/lib/permissions";
import { pricingConfig, SHORT_TERM_DEFAULTS } from "@/lib/pricing-config";
import { applyDraft, draftOf, draftProblems } from "@/lib/pricing-draft";
import { dealProblem, quoteApplication, quoteSummary, type Quote, type QuoteDeal } from "@/lib/quote";

const rental = (change: Partial<Application> = {}): Application => ({
  product: "dscr", purpose: "purchase", county: "Broward", state: "FL", propertyType: "sfr", occupancy: "vacant", purchasePrice: 400_000, rehab: 0, arv: 400_000,
  taxesAnnual: 7_200, insuranceAnnual: 6_000, interestReserve: "none", accrual: "full_boat", fico: 770, verifiedDeals: 4, liquidity: 150_000, valuationSource: "appraisal", ...change,
});
const nightlyRental = (change: Partial<Application> = {}) => rental({ rentalType: "short_term", strAnnualIncome: 60_000, strIncomeSource: "payouts", ...change });

describe("what a short-term rental counts as rent", () => {
  it("is the yearly income at a factor: more for 12 months of payouts than a projection, less on a cash-out", () => {
    expect(shortTermFactor({ strIncomeSource: "payouts", purpose: "purchase" }, pricingConfig)).toBe(0.8);
    expect(shortTermFactor({ strIncomeSource: "projection", purpose: "purchase" }, pricingConfig)).toBe(0.75);
    expect(shortTermFactor({ strIncomeSource: "projection", purpose: "refi_co" }, pricingConfig)).toBeCloseTo(0.7, 10);
    expect(qualifyingRent(nightlyRental(), pricingConfig)).toBe(4_000);
    expect(qualifyingRent(nightlyRental({ strIncomeSource: "projection" }), pricingConfig)).toBe(3_750);
    // A lease is counted as it is.
    expect(qualifyingRent(rental({ monthlyRent: 3_100 }), pricingConfig)).toBe(3_100);
    expect(qualifyingRent(rental({ monthlyRent: 3_100, rentalType: "short_term" }), pricingConfig)).toBe(0);
  });
  it("uses the starting rules for pricing published before short-term rentals were priced", () => {
    const old = { ...pricingConfig, dscr: { ...pricingConfig.dscr, shortTerm: undefined } };
    expect(shortTermOf(old)).toEqual(SHORT_TERM_DEFAULTS);
    expect(qualifyingRent(nightlyRental(), old)).toBe(4_000);
  });
});

describe("sizing a short-term rental", () => {
  it("prices it above the same counted rent on a lease, with less leverage, and says why", () => {
    // $60,000 a year at 80% is $4,000 a month, the same as this lease.
    const lease = evaluate(rental({ monthlyRent: 4_000 }), pricingConfig);
    const stays = evaluate(nightlyRental(), pricingConfig);
    expect(stays.eligible).toBe(true);
    expect(stays.rate).toBeGreaterThan(lease.rate);
    expect(stays.noteAmount).toBeLessThanOrEqual(lease.noteAmount);
    expect(stays.ratios.find((ratio) => ratio.key === "ltv")!.limit).toBeCloseTo(lease.ratios.find((ratio) => ratio.key === "ltv")!.limit - 0.05, 10);
    expect(stays.flags).toContain("Short-term rental: 80% of the last 12 months' income counted, −5% leverage, +0.25%");
  });
  it("stops without its income", () => {
    const e = evaluate(nightlyRental({ strAnnualIncome: undefined }), pricingConfig);
    expect(e.eligible).toBe(false);
    expect(e.hardStops).toContain("Short-term rental: enter its yearly income");
  });
});

describe("asking for it", () => {
  const deal = (change: Partial<QuoteDeal> = {}): QuoteDeal => ({
    citizenship: "us", creditBand: "760+", experience: "3-4", address: { street: "1 Beach Rd", city: "Hollywood", state: "FL", zip: "33019", county: "Broward" },
    propertyType: "sfr", loanType: "dscr", purpose: "purchase", purchasePrice: 400_000, rehab: 0, rentalType: "short_term", strAnnualIncome: 60_000, strIncomeSource: "payouts", fundingDate: "2026-12-15", comps: [], exit: "hold", notes: "", ...change,
  });
  it("the quote needs the yearly income instead of a monthly rent, and prices on it", () => {
    expect("deal" in dealProblem(deal())).toBe(true);
    expect(dealProblem(deal({ strAnnualIncome: undefined }))).toEqual({ error: "Add the yearly income from short-term stays." });
    expect(dealProblem(deal({ rentalType: "long_term", strAnnualIncome: undefined }))).toEqual({ error: "Add the monthly rent." });
    expect(quoteApplication(deal())).toMatchObject({ rentalType: "short_term", strAnnualIncome: 60_000, strIncomeSource: "payouts", taxesAnnual: 7_200 });
    // A bridge loan is never sized on nightly income.
    expect(quoteApplication(deal({ loanType: "bridge" }))).not.toHaveProperty("rentalType");
    const quote = { ...deal(), submitter: "borrower", borrower: { firstName: "Tess", lastName: "Test", email: "t@example.org", phone: "" } } as Quote;
    expect(quoteSummary(quote)).toMatch(/short-term rental, \$60,000\/yr from the last 12 months' payouts/);
  });
  it("the borrower's application asks for it, and the loan keeps it", () => {
    const draft = blankDraft();
    draft.loanType = "dscr";
    draft.loan = { ...draft.loan, rentalType: "short_term", strIncomeSource: "projection", purchasePrice: "400,000", strAnnualIncome: "", monthlyRent: "" };
    expect(nightly(draft)).toBe(true);
    expect(stepProblems(draft, 2, "2026-11-01")).toContain("The yearly income from short-term stays.");
    expect(stepProblems(draft, 2, "2026-11-01")).not.toContain("The monthly rent.");
    draft.loan.strAnnualIncome = "52,000";
    expect(toLoan(draft).app).toMatchObject({ rentalType: "short_term", strAnnualIncome: 52_000, strIncomeSource: "projection", monthlyRent: undefined });
    // Picking short-term on a bridge loan does nothing.
    expect(nightly({ ...draft, loanType: "bridge" })).toBe(false);
  });
  it("asks for the payouts or the projection in place of a lease, and Florida's short-term conditions", () => {
    const ids = (app: Application) => needsList(app, undefined).map((doc) => doc.id);
    expect(ids(nightlyRental())).toContain("str-income");
    expect(ids(nightlyRental())).not.toContain("lease");
    expect(needsList(nightlyRental({ strIncomeSource: "projection" }), undefined).find((doc) => doc.id === "str-income")!.name).toBe("Short-term rental income projection");
    expect(ids(rental({ monthlyRent: 3_000 }))).toContain("lease");
    const conditions = (app: Application) => templatesFor(DEFAULT_LIBRARY, app).map((item) => item.id);
    expect(conditions(nightlyRental())).toEqual(expect.arrayContaining(["std-str-income", "std-str-hoa", "std-str-license", "std-str-local"]));
    expect(conditions(nightlyRental())).not.toContain("std-lease");
    expect(conditions(rental())).toContain("std-lease");
    expect(conditions(rental())).not.toContain("std-str-license");
  });
});

describe("changing it", () => {
  it("is in the owner's pricing editor, checked before publishing", () => {
    const draft = draftOf(pricingConfig);
    expect(draft.dscr.shortTerm).toEqual(SHORT_TERM_DEFAULTS);
    const edited = { ...draft, dscr: { ...draft.dscr, shortTerm: { ...draft.dscr.shortTerm, historyFactor: 0.7, rateAdd: 0.5 } } };
    expect(applyDraft(pricingConfig, edited, "v-test").dscr.shortTerm).toMatchObject({ historyFactor: 0.7, rateAdd: 0.5 });
    expect(draftProblems(edited)).toEqual([]);
    expect(draftProblems({ ...draft, dscr: { ...draft.dscr, shortTerm: { ...draft.dscr.shortTerm, cashOutFactorCut: 0.8 } } })).toContain("The cash-out cut would leave a short-term rental with no income counted.");
  });
  it("on a loan, swaps the lease for the payout statements", () => {
    const owner: Viewer = { id: "owner", name: "Owner", roleCodes: ["ADMIN_OWNER"] };
    const b: Book = demoBook();
    const action: BookAction = { t: "updateDealNumbers", dealId: "d4", changes: { rentalType: "short_term", strIncomeSource: "payouts", strAnnualIncome: 58_000 } };
    const result = authorize(b, owner, action, (permission: Permission, amountCents?: number) => can(owner.roleCodes, permission, { amountCents, member: owner }), false);
    if ("error" in result) throw new Error(result.error);
    const before = b.deals.find((d) => d.id === "d4")!;
    const after = reducer(b, result.action).deals.find((d) => d.id === "d4")!;
    expect(after.app.rentalType).toBe("short_term");
    const lease = before.docs.find((doc) => doc.id === "lease");
    // A lease already sent stays on file; one still owed is no longer asked for.
    if (lease?.status === "requested") expect(after.docs.some((doc) => doc.id === "lease")).toBe(false);
    expect(after.docs.find((doc) => doc.id === "str-income")).toMatchObject({ name: "Payout statements, last 12 months", status: "requested" });
  });
});
