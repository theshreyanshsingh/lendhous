import { describe, expect, it } from "vitest";
import { CALCULATOR_DEFAULTS, FIELD_LABELS, flipMargin, leverageCap, rentalCoverage, validInputs } from "@/lib/site-calculators";
import { leadSummary, MAX_LEAD_DOLLARS, parseLead } from "@/lib/leads";
import { GUIDES, PROGRAMS } from "@/lib/site-content";

describe("public site calculators", () => {
  it("rental coverage matches the example on the original site", () => {
    const result = rentalCoverage(CALCULATOR_DEFAULTS.rental);
    expect(result.dscr?.toFixed(2)).toBe("1.31");
    expect(Math.round(result.pi)).toBe(1834);
    expect(Math.round(result.pitia)).toBe(2284);
    expect(Math.round(result.spread)).toBe(716);
  });
  it("rental coverage handles a zero rate and no costs at all", () => {
    expect(rentalCoverage({ ...CALCULATOR_DEFAULTS.rental, rate: 0, loan: 360000, tax: 0, insurance: 0, hoa: 0 }).pi).toBe(1000);
    expect(rentalCoverage({ ...CALCULATOR_DEFAULTS.rental, rate: 0, loan: 0, tax: 0, insurance: 0, hoa: 0 }).dscr).toBeNull();
  });
  it("flip margin counts every entered cost once", () => {
    const result = flipMargin(CALCULATOR_DEFAULTS.flip);
    expect(result.interest).toBe(12500);
    expect(result.fees).toBe(5000);
    expect(result.total).toBe(359200);
    expect(result.profit).toBe(40800);
    expect(result.ltc?.toFixed(1)).toBe("83.3");
    expect(flipMargin({ ...CALCULATOR_DEFAULTS.flip, purchase: 0, rehab: 0 }).ltc).toBeNull();
  });
  it("the lower of the two caps controls, as in the leverage guide", () => {
    expect(leverageCap(CALCULATOR_DEFAULTS.leverage)).toEqual({ costCap: 285000, valueCap: 262500, loan: 262500, equity: 37500 });
  });
  it("refuses empty, negative and out-of-range inputs", () => {
    expect(validInputs(CALCULATOR_DEFAULTS.rental)).toBe(true);
    expect(validInputs({ ...CALCULATOR_DEFAULTS.rental, loan: NaN })).toBe(false);
    expect(validInputs({ ...CALCULATOR_DEFAULTS.rental, tax: -1 })).toBe(false);
    expect(validInputs({ ...CALCULATOR_DEFAULTS.rental, rate: 101 })).toBe(false);
    expect(validInputs({ ...CALCULATOR_DEFAULTS.rental, years: 0 })).toBe(false);
    expect(validInputs({ ...CALCULATOR_DEFAULTS.flip, months: 121 })).toBe(false);
    expect(validInputs({ ...CALCULATOR_DEFAULTS.leverage, value: 0 })).toBe(false);
  });
  it("labels every input", () => {
    for (const inputs of Object.values(CALCULATOR_DEFAULTS)) for (const field of Object.keys(inputs)) expect(FIELD_LABELS[field]).toBeTruthy();
  });
});

describe("public site content", () => {
  it("has one page per slug, and a landing-page line for every program", () => {
    const programs = PROGRAMS.map((program) => program.slug);
    expect(new Set(programs).size).toBe(programs.length);
    for (const program of PROGRAMS) expect(program.homeSummary).toBeTruthy();
    const guides = GUIDES.map((guide) => guide.slug);
    expect(new Set(guides).size).toBe(guides.length);
  });
});

describe("project briefs from the public site", () => {
  const form = { name: " Dana  Investor ", email: "Dana@Example.COM", phone: "", strategy: "DSCR rental", experience: "First investment", city: "Dallas", state: "TX", propertyValue: "300000", renovation: "0", requestedLoan: "240000", targetClosing: "", notes: "Hold as a rental." };
  it("cleans up a valid brief and stores money in cents", () => {
    const parsed = parseLead(form);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lead).toMatchObject({ name: "Dana Investor", email: "dana@example.com", propertyValueCents: 30000000, renovationCents: 0, requestedLoanCents: 24000000 });
    expect(leadSummary(parsed.lead)).toContain("Requested loan: $240,000");
    expect(leadSummary(parsed.lead)).toContain("Phone: Not given");
  });
  it("refuses a brief it couldn't act on", () => {
    expect(parseLead({ ...form, name: "  " }).ok).toBe(false);
    expect(parseLead({ ...form, email: "not-an-email" }).ok).toBe(false);
    expect(parseLead({ ...form, city: "" }).ok).toBe(false);
    expect(parseLead({ ...form, notes: " " }).ok).toBe(false);
    expect(parseLead({ ...form, propertyValue: "" }).ok).toBe(false);
    expect(parseLead({ ...form, requestedLoan: "0" }).ok).toBe(false);
    expect(parseLead({ ...form, renovation: "-1" }).ok).toBe(false);
    expect(parseLead({ ...form, targetClosing: "soon" }).ok).toBe(false);
  });
  it("keeps every amount inside the 32-bit cents column", () => {
    expect(MAX_LEAD_DOLLARS * 100).toBeLessThanOrEqual(2147483647);
    expect(parseLead({ ...form, requestedLoan: String(MAX_LEAD_DOLLARS + 1) }).ok).toBe(false);
  });
  it("won't let a header or an unknown option through", () => {
    const parsed = parseLead({ ...form, city: "Dallas\r\nBcc: someone@example.com", strategy: "<script>", experience: "x" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lead.city).not.toMatch(/[\r\n]/);
    expect(parsed.lead.strategy).toBe("Not sure yet");
    expect(parsed.lead.experience).toBe("");
  });
});
