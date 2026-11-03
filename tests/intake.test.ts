import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { blankDraft, blankGuarantor, completeDraft, draftFromDeal, draftFromQuote, signProblems, stepProblems, toLoan, withoutSsn, type AppDraft } from "@/lib/borrower-application";
import { readAddress, readSuggestions } from "@/lib/places";
import { pricingConfig } from "@/lib/pricing-config";
import { comparePrograms } from "@/lib/program-compare";
import { indicativeTerms, quoteApplication, quoteProblem, quoteSummary, type Quote } from "@/lib/quote";
import { can, type Permission } from "@/lib/permissions";

const quote = (changes: Partial<Quote> = {}): Quote => ({
  submitter: "borrower", borrower: { firstName: "Kai", lastName: "Investor", email: "kai@example.com", phone: "(954) 555-0100" },
  citizenship: "us", creditBand: "720-759", experience: "3-4", address: { street: "1873 West 10th Street", city: "Jacksonville", state: "FL", zip: "32209", county: "Duval" },
  propertyType: "sfr", beds: 3, baths: 2, sqft: 1750, loanType: "fix_flip", purpose: "purchase", purchasePrice: 74_400, rehab: 80_000, arv: 200_000,
  requestedAmount: undefined, monthlyRent: undefined, fundingDate: "2026-11-20", comps: [{ address: "1901 W 10th St", price: 205_000, soldOn: "2026-08" }], exit: "sell", notes: "Fix it and sell it.", ...changes,
});

describe("the quote request", () => {
  it("asks for the ARV on a rehab loan, the rent on a rental, and a broker's own details", () => {
    expect(quoteProblem({ ...quote(), arv: undefined })).toEqual({ error: "Add the after-repair value (ARV)." });
    expect(quoteProblem({ ...quote({ loanType: "dscr" }), monthlyRent: undefined })).toEqual({ error: "Add the monthly rent." });
    expect(quoteProblem({ ...quote(), submitter: "broker" })).toMatchObject({ error: expect.stringMatching(/broker details/) });
    expect(quoteProblem({ ...quote(), borrower: { ...quote().borrower, phone: "" } })).toMatchObject({ error: expect.stringMatching(/phone/) });
    expect(quoteProblem({ ...quote(), address: { ...quote().address, zip: "322" } })).toEqual({ error: "Add the property's 5-digit ZIP." });
    expect(quoteProblem(quote())).toHaveProperty("quote");
  });
  it("prices it on the pricing it's given, and sends unpriced loan types to a person", () => {
    const terms = indicativeTerms(quote(), pricingConfig)!;
    expect(terms.eligible).toBe(true);
    expect(terms.noteAmount).toBeGreaterThan(0);
    expect(quoteApplication(quote())).toMatchObject({ product: "fix_flip", county: "Duval", fico: 740, verifiedDeals: 3, arv: 200_000 });
    expect(quoteApplication(quote({ address: { ...quote().address, county: "" } }))?.county).toBe("Other FL");
    expect(indicativeTerms(quote({ loanType: "transactional" }), pricingConfig)).toBeNull();
  });
  it("tells the team everything, the ARV and the comps included", () => {
    const text = quoteSummary(quote({ submitter: "broker", broker: { name: "Bea Broker", company: "Bea Loans", email: "bea@example.com", phone: "3055550100" } }));
    expect(text).toMatch(/Broker: Bea Broker, Bea Loans/);
    expect(text).toMatch(/ARV \$200,000/);
    expect(text).toMatch(/1901 W 10th St: \$205,000 sold 2026-08/);
  });
  it("compares programs from the pricing, so the site can't advertise numbers the engine won't give", () => {
    const flip = comparePrograms(pricingConfig).find((row) => row.key === "fix_flip")!;
    expect(flip.rateFrom).toBe(Math.min(...Object.values(pricingConfig.fixFlip.tiers).map((tier) => tier.rate[0])));
    expect(flip.financing).toMatch(/90% of cost/);
  });
});

describe("address lookup", () => {
  it("reads Google's suggestions and turns a picked place into the parts the forms use", () => {
    expect(readSuggestions({ suggestions: [{ placePrediction: { placeId: "abc", text: { text: "1873 West 10th Street, Jacksonville, FL" }, structuredFormat: { mainText: { text: "1873 West 10th Street" }, secondaryText: { text: "Jacksonville, FL 32209, USA" } } } }] })).toEqual([{ id: "abc", main: "1873 West 10th Street", secondary: "Jacksonville, FL 32209, USA" }]);
    const components = [{ longText: "1873", types: ["street_number"] }, { longText: "West 10th Street", shortText: "W 10th St", types: ["route"] }, { longText: "Jacksonville", types: ["locality", "political"] }, { longText: "Duval County", types: ["administrative_area_level_2"] }, { longText: "Florida", shortText: "FL", types: ["administrative_area_level_1"] }, { longText: "32209", types: ["postal_code"] }];
    expect(readAddress({ addressComponents: components })).toMatchObject({ street: "1873 W 10th St", city: "Jacksonville", state: "FL", zip: "32209", county: "Duval" });
    expect(readAddress({ addressComponents: components.map((item) => (item.longText === "Duval County" ? { ...item, longText: "Nassau County" } : item)) }).county).toBe("Other FL");
  });
});

// A complete application: one guarantor, an LLC, every declaration answered.
const complete = (): AppDraft => {
  const draft = draftFromQuote(quote());
  draft.property = { ...draft.property, floodZone: "unsure", propertyType: "sfr", occupancy: "vacant" };
  draft.loan = { ...draft.loan, plan: "Fix it and sell it.", exit: "sell", closeDate: "2026-11-20" };
  draft.vesting = { hasLlc: true, entityName: "Revive Jax LLC", entityState: "FL", ein: "42-3514732", address: { street: "8051 North Tamiami Trail", city: "Sarasota", state: "FL", zip: "34243", county: "Sarasota" } };
  draft.guarantors = [{ ...blankGuarantor(), firstName: "Kai", lastName: "Investor", email: "kai@example.com", phone: "(954) 555-0100", dob: "1964-11-19", fico: "710", ssn: "123456789", home: { street: "5024 SW 91st Ave", city: "Cooper City", state: "FL", zip: "33328", county: "Broward" }, twoYears: true, mailingSame: true, marital: "married", citizenship: "us", ownershipPct: "100", answers: { bankruptcy: false, foreclosure: false, delinquent: false, judgments: false, lawsuit: false, felony: false, borrowedDownPayment: false }, occupy: false }];
  draft.trackRecord = [{ id: "t1", address: "12 Flip Ln, Jacksonville", kind: "flip", completed: "2026-03", purchasePrice: 90_000, salePrice: 210_000 }];
  return draft;
};
const TODAY = "2026-11-03";

describe("the borrower application", () => {
  it("starts from what the quote request already said", () => {
    const draft = draftFromQuote(quote());
    expect(draft.contact.email).toBe("kai@example.com");
    expect(draft.property.address.zip).toBe("32209");
    expect(draft.loan.arv).toBe("200,000");
    expect(draft.guarantors[0]).toMatchObject({ firstName: "Kai", citizenship: "us" });
  });
  it("checks each step before moving on", () => {
    expect(stepProblems(blankDraft(), 0, TODAY)).toHaveLength(3);
    expect(stepProblems(complete(), 0, TODAY)).toEqual([]);
    expect(stepProblems({ ...complete(), loan: { ...complete().loan, arv: "" } }, 2, TODAY)).toContain("The after-repair value (ARV).");
    expect(stepProblems({ ...complete(), loan: { ...complete().loan, closeDate: "2026-10-01" } }, 2, TODAY)).toContain("A closing date from today on.");
    const young = { ...complete(), guarantors: [{ ...complete().guarantors[0], dob: "2010-01-01", ssn: "1234" }] };
    expect(stepProblems(young, 3, TODAY)).toEqual(expect.arrayContaining(["date of birth (18 or older).", "Social Security number, 9 digits."]));
    expect(stepProblems(complete(), 3, TODAY)).toEqual([]);
  });
  it("won't sign for a home the borrower will live in", () => {
    const home = { ...complete(), guarantors: [{ ...complete().guarantors[0], occupy: true, explanation: "My daughter will live there." }] };
    expect(signProblems(home, TODAY)[0]).toMatch(/business-purpose loans only/);
    expect(signProblems(complete(), TODAY)).toEqual([]);
  });
  it("puts what underwriting prices on into the loan, and keeps private details out of it", () => {
    const loan = toLoan(complete());
    expect(loan).toMatchObject({ borrowerName: "Kai Investor", entityName: "Revive Jax LLC", city: "Jacksonville", zip: "32209", exitStrategy: "Sell" });
    expect(loan.app).toMatchObject({ product: "fix_flip", county: "Duval", purchasePrice: 74_400, rehab: 80_000, arv: 200_000 });
    expect(loan.sponsor.guarantors).toEqual([{ name: "Kai Investor", ownershipPct: 100, fico: 710, citizenship: "us" }]);
    expect(JSON.stringify(loan)).not.toMatch(/123456789|1964-11-19|5024 SW|42-3514732/);
    const yes = { ...complete(), guarantors: [{ ...complete().guarantors[0], answers: { ...complete().guarantors[0].answers, lawsuit: true }, explanation: "Settled." }] };
    expect(toLoan(yes).sponsor.declarations).toMatchObject({ lawsuit: true, explanation: "Kai Investor: Settled." });
    expect(toLoan({ ...complete(), vesting: { ...complete().vesting, hasLlc: false } }).entityName).toBe("Kai Investor (LLC to be formed)");
  });
  it("masks Social Security numbers for staff, and opens an older draft in a newer form", () => {
    expect(withoutSsn(complete()).guarantors[0].ssn).toBe("•••-••-6789");
    expect(completeDraft({ contact: { firstName: "Old" } }).contact).toMatchObject({ firstName: "Old", lastName: "", email: "" });
    expect(completeDraft(null).guarantors).toHaveLength(1);
  });
  it("prefills a link for a started loan from the loan", () => {
    const deal = demoBook().deals.find((item) => item.id === "d5")!;
    const draft = draftFromDeal(deal, "riley@example.com");
    expect(draft.guarantors.map((g) => `${g.firstName} ${g.lastName}`)).toEqual(["Riley Placeholder (FAKE)", "Sky Sample (FAKE)"]);
    expect(draft.loanType).toBe("ground_up");
  });
});

describe("applying a signed application to a loan in review", () => {
  const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
  const check = (book: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(book, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
  const deal = { ...demoBook().deals.find((item) => item.id === "d1")!, sponsor: undefined, creditReview: undefined };
  const loan = toLoan(complete());
  const apply: BookAction = { t: "applyBorrowerInfo", dealId: "d1", app: loan.app, address: loan.address, city: loan.city, zip: loan.zip, entityName: loan.entityName, exitStrategy: loan.exitStrategy, sponsor: loan.sponsor, signedBy: "Kai Investor" };
  it("is only the server's to do", () => {
    expect(check({ ...emptyBook(), deals: [deal] }, person("owner", ["ADMIN_OWNER"]), apply)).toHaveProperty("error");
    expect(check({ ...emptyBook(), deals: [deal] }, person("system", []), apply, true)).toHaveProperty("action");
  });
  it("updates the loan's numbers and profile while it's in review, keeping its pricing, and not after credit sign-off", () => {
    const after = reducer({ ...emptyBook(), deals: [deal] }, apply).deals[0];
    expect(after).toMatchObject({ address: "1873 West 10th Street", entityName: "Revive Jax LLC", sponsor: { guarantors: [{ name: "Kai Investor" }] } });
    expect(after.app).toMatchObject({ fico: 710, verifiedDeals: 1, pricingVersion: deal.app.pricingVersion });
    const signedOff = { ...deal, creditReview: { by: "Uma", at: "2026-11-01T00:00:00Z", note: "", verifiedDeals: 3 } };
    const book = { ...emptyBook(), deals: [signedOff] };
    expect(reducer(book, apply)).toBe(book);
  });
});
