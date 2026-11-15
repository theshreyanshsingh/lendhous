import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import type { Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { billYear, taxReminder, taxStage, taxTask } from "@/lib/property-taxes";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const servicer = person("sam", ["SERVICER"]);
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};

describe("property-tax status (rank 7, Fla. Stat. ch. 197)", () => {
  const b = demoBook();
  // Funded in January 2026, so it owes the 2025 bill (due by March 31, 2026).
  const loan: Deal = { ...b.deals.find((deal) => deal.id === "d14")!, status: "servicing_current", taxes: { parcels: ["P-1"], checks: [] } };
  it("follows Florida's calendar: due by March 31, delinquent April 1, a tax certificate by June 1", () => {
    expect([billYear("2026-10-31"), billYear("2026-11-01")]).toEqual([2025, 2026]);
    expect(taxStage(loan, "2026-02-15")).toBeNull();
    expect(taxStage(loan, "2026-03-05")).toBe("due_soon");
    expect(taxStage(loan, "2026-04-01")).toBe("delinquent");
    expect(taxStage(loan, "2026-06-01")).toBe("certificate");
    expect(taxTask(loan, "2026-04-02")).toBe("2025 property taxes delinquent: get them paid before a tax certificate is sold");
  });
  it("is quiet once every parcel's bill is paid, for a bill settled at closing, and off the books", () => {
    const paid = { ...loan, taxes: { parcels: ["P-1", "P-2"], checks: [{ id: "a", parcel: "P-1", year: 2025, status: "paid" as const, checkedOn: "2026-03-02", note: "", by: "x", at: "x" }] } };
    expect(taxStage(paid, "2026-03-05")).toBe("due_soon");
    const both = { ...paid, taxes: { ...paid.taxes, checks: [...paid.taxes.checks, { ...paid.taxes.checks[0], id: "b", parcel: "P-2" }] } };
    expect(taxStage(both, "2026-04-05")).toBeNull();
    // A newer check showing it unpaid wins over an older one.
    const regressed = { ...both, taxes: { ...both.taxes, checks: [...both.taxes.checks, { ...both.taxes.checks[0], id: "c", status: "delinquent" as const, checkedOn: "2026-04-03" }] } };
    expect(taxStage(regressed, "2026-04-05")).toBe("delinquent");
    expect(taxStage({ ...loan, closingDate: "2026-05-01" }, "2026-06-15")).toBeNull();
    expect(taxStage({ ...loan, status: "paid_off" }, "2026-04-05")).toBeNull();
    expect(taxStage({ ...loan, taxes: undefined }, "2026-01-05")).toBe("no_parcel");
  });
  it("staff who service loans record parcels and checks; a parcel has to be on the loan and the year's bill out", () => {
    const book: Book = { ...b, deals: b.deals.map((deal) => (deal.id === "d14" ? { ...deal, taxes: undefined } : deal)) };
    expect(check(book, person("pat", ["PROCESSOR"]), { t: "saveTaxParcels", dealId: "d14", parcels: ["x"] })).toEqual({ error: "Your account can't do that." });
    const withParcels = run(book, servicer, { t: "saveTaxParcels", dealId: "d14", parcels: [" 06-42-43-11-0140 ", "06-42-43-11-0140", ""] });
    expect(withParcels.deals.find((deal) => deal.id === "d14")!.taxes).toEqual({ parcels: ["06-42-43-11-0140"], checks: [] });
    const record = (parcel: string, year: number): BookAction => ({ t: "recordTaxCheck", dealId: "d14", checkId: "t1", check: { parcel, year, status: "paid", paidOn: "2025-11-20", checkedOn: "2026-10-30", note: "" }, by: "x" });
    expect(check(withParcels, servicer, record("99", 2025))).toEqual({ error: "Add the parcel to the loan first." });
    expect(check(withParcels, servicer, record("06-42-43-11-0140", 2026))).toEqual({ error: "Choose a tax year whose bill has gone out." });
    const after = run(withParcels, servicer, record("06-42-43-11-0140", 2025));
    expect(after.deals.find((deal) => deal.id === "d14")!.taxes!.checks[0]).toMatchObject({ status: "paid", by: "sam name" });
    // Partners and buyers who haven't closed on a loan don't see its taxes.
    expect(scopeBook(after, { id: "buy-b", name: "b", roleCodes: ["LOAN_BUYER"] }).deals.every((deal) => deal.taxes === undefined)).toBe(true);
  });
  it("the nightly check reminds the borrower and the team once at each step", () => {
    const book: Book = { ...b, deals: b.deals.map((deal) => (deal.id === "d14" ? loan : deal)) };
    expect(check(book, servicer, { t: "checkTaxes", asOf: "2026-03-05" })).toEqual({ error: "Your account can't do that." });
    const march = run(book, servicer, { t: "checkTaxes", asOf: "2026-03-05" }, true);
    expect(march.deals.find((deal) => deal.id === "d14")!.taxes!.reminded).toEqual(["2025:due_soon"]);
    const alerts = alertsFor(book, march, { t: "checkTaxes", asOf: "2026-03-05" });
    expect(alerts.filter((alert) => alert.to === "borrower")).toEqual([expect.objectContaining({ dealId: "d14", event: "taxes.due_soon", body: expect.stringMatching(/due by March 31/) })]);
    expect(alerts.find((alert) => alert.to === "team")?.body).toMatch(/LH-DEMO-1014 .*2025 taxes due by March 31/);
    expect(taxReminder(march.deals.find((deal) => deal.id === "d14")!, "2026-03-20")).toBeNull();
    expect(reducer(march, { t: "checkTaxes", asOf: "2026-03-20" })).toBe(march);
    const april = reducer(march, { t: "checkTaxes", asOf: "2026-04-02" });
    expect(april.deals.find((deal) => deal.id === "d14")!.taxes!.reminded).toEqual(["2025:due_soon", "2025:delinquent"]);
    // The demo's loan with a certificate sold was already reminded.
    expect(taxStage(b.deals.find((deal) => deal.id === "d13")!, "2026-10-31")).toBe("certificate");
  });
});
