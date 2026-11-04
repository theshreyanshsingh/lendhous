import { describe, expect, it } from "vitest";
import { demoBook, type Book } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { deadlines, irisRows, maskTin, taxYear, TAX_CONFIG, w8ExpiresOn, w9Problem, type OnFile, type W9 } from "@/lib/tax-forms";

const w9 = (changes: Partial<W9> = {}): W9 => ({ legalName: "Pia Partner", businessName: "", classification: "individual", tinType: "ssn", tin: "123-45-6789", exemptPayeeCode: "", address: { street: "1 Main St", city: "Miami", state: "FL", zip: "33130" }, ...changes });
const onFileOf = (forms: Record<string, OnFile>) => (type: string, id: string) => forms[`${type}:${id}`] ?? null;
const signed = (form: W9): OnFile => ({ kind: "w9", form, signedAt: "2026-06-01T12:00:00Z" });

describe("year-end tax forms", () => {
  const book = demoBook();
  it("1099-INT for partners' and buyers' interest after servicing, and 1099-NEC for broker fees", () => {
    const year = taxYear(book, 2026, () => null);
    const partner = year.lines.find((line) => line.payeeType === "partner")!;
    expect(partner).toMatchObject({ form: "1099-INT", amount: 3584.38, due: true, onFile: "missing", loans: ["LH-DEMO-1011"] });
    expect(partner.backupWithholding).toBeCloseTo(3584.38 * 0.24, 2);
    expect(year.lines.find((line) => line.payeeType === "buyer")).toMatchObject({ form: "1099-INT", due: true });
    const broker = year.lines.find((line) => line.form === "1099-NEC")!;
    expect(broker).toMatchObject({ payeeType: "broker", due: true });
    expect(broker.amount).toBeGreaterThanOrEqual(TAX_CONFIG.brokerFeeThreshold);
    expect(year.missingW9).toHaveLength(3);
    // The demo lends only to LLCs, so no borrower gets a 1098.
    expect(year.lines.some((line) => line.form === "1098")).toBe(false);
  });
  it("a W-9 on file clears backup withholding; corporations and IRAs are exempt from 1099-INT, corporations from 1099-NEC", () => {
    const year = (forms: Record<string, OnFile>) => taxYear(book, 2026, onFileOf(forms));
    expect(year({ "partner:p-a": signed(w9()) }).lines.find((line) => line.payeeType === "partner")).toMatchObject({ due: true, onFile: "w9", backupWithholding: 0 });
    expect(year({ "partner:p-a": signed(w9({ classification: "c_corp", tinType: "ein" })) }).lines.find((line) => line.payeeType === "partner")).toMatchObject({ due: false, reason: "Exempt: C corporation" });
    expect(year({ "partner:p-a": signed(w9({ exemptPayeeCode: "1" })) }).lines.find((line) => line.payeeType === "partner")?.due).toBe(false);
    const brokerId = book.brokers[0].id;
    expect(year({ [`broker:${brokerId}`]: signed(w9({ exemptPayeeCode: "1" })) }).lines.find((line) => line.form === "1099-NEC")?.due).toBe(true);
    expect(year({ [`broker:${brokerId}`]: signed(w9({ classification: "s_corp", tinType: "ein" })) }).lines.find((line) => line.form === "1099-NEC")?.due).toBe(false);
    expect(year({ "partner:p-a": { kind: "w8", form: { name: "Foreign Fund", entity: true, country: "Canada", foreignTin: "", address: "1 Bay St, Toronto" }, signedAt: "2026-01-02T00:00:00Z", expiresOn: "2029-12-31" } }).lines.find((line) => line.payeeType === "partner")?.reason).toMatch(/1042-S/);
  });
  it("1098 for $600 or more of interest from an individual borrower, on a business-purpose loan too", () => {
    const d11 = book.deals.find((deal) => deal.id === "d11")!;
    const personal: Book = { ...book, deals: book.deals.map((deal) => (deal.id === "d11" ? { ...deal, entityName: "" } : deal)) };
    const line = taxYear(personal, 2026, () => null).lines.find((item) => item.form === "1098")!;
    expect(line).toMatchObject({ payeeType: "borrower", name: d11.borrowerName, due: true, originated: d11.closingDate, loans: ["LH-DEMO-1011"] });
    expect(line.amount).toBeCloseTo(2 * (evaluate(d11.app).noteAmount * evaluate(d11.app).rate) / 100 / 12, 0);
    const toBeFormed = { ...personal, deals: personal.deals.map((deal) => (deal.id === "d11" ? { ...deal, entityName: "Avery Mock (LLC to be formed)" } : deal)) };
    expect(taxYear(toBeFormed, 2026, () => null).lines.some((item) => item.form === "1098")).toBe(true);
    expect(taxYear(personal, 2025, () => null).lines.some((item) => item.form === "1098")).toBe(false);
  });
  it("deadlines move off weekends: recipients' copies Feb 1, 2027; e-filing March 31", () => {
    expect(deadlines(2026)).toEqual({ recipients: "2027-02-01", brokerFeesToIrs: "2027-02-01", paperToIrs: "2027-03-01", efileToIrs: "2027-03-31" });
    expect(deadlines(2027).recipients).toBe("2028-01-31");
  });
  it("checks a W-9 and knows how long a W-8 lasts", () => {
    expect(w9Problem(w9())).toBeNull();
    expect(w9Problem(w9({ tin: "1234" }))).toMatch(/9 digits/);
    expect(w9Problem(w9({ classification: "llc_p" }))).toMatch(/gives its EIN/);
    expect(w9Problem(w9({ classification: "llc_disregarded" }))).toBeNull();
    expect(w9Problem(w9({ address: { street: "1 Main", city: "Miami", state: "Florida", zip: "33130" } }))).toMatch(/full US address/);
    expect(w8ExpiresOn("2026-11-04")).toBe("2029-12-31");
    expect(maskTin("123-45-6789")).toBe("•••-••-6789");
  });
  it("exports the forms due in IRIS's columns, with the TINs from the W-9s", () => {
    const year = taxYear(book, 2026, () => null);
    const rows = irisRows(year.lines, (line) => (line.payeeType === "partner" ? { tinType: "ssn", tin: "123456789", name: "Pia Partner", street: "1 Main St", city: "Miami", state: "FL", zip: "33130" } : null), 2026);
    expect(rows).toHaveLength(year.due.length);
    expect(rows.find((row) => row["Recipient Name"] === "Pia Partner")).toMatchObject({ "Form Type": "1099-INT", "Tax Year": 2026, "Recipient TIN": "123456789", "Box 1 Interest Income": 3584.38 });
    expect(rows.find((row) => row["Form Type"] === "1099-NEC")).toHaveProperty("Box 1 Nonemployee Compensation");
  });
});
