import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { splitOf } from "@/lib/investor-statements";
import type { PortfolioProperty } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { heldProperties, limitsOf, PORTFOLIO, portfolioApp, portfolioNow, propertyLines, releaseQuote, scheduleProblem, type ReleaseQuote } from "@/lib/portfolio";
import { productFor } from "@/lib/quote";
import { balanceOf, ledger, paymentsMade, rentalBalance } from "@/lib/servicing";
import { loansInCone } from "@/lib/storms";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const underwriter = person("uma", ["UNDERWRITER"]);
const servicer = person("svc", ["SERVICER"]);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
type Row = Omit<PortfolioProperty, "geo" | "floodMap" | "released">;
const home = (n: number, change: Partial<Row> = {}): Row => ({ id: `p${n}`, address: `${n} Palm St`, city: "Hollywood", zip: "33020", county: "Broward", propertyType: "sfr", value: 200_000 + n * 10_000, monthlyRent: 1_900 + n * 50, taxesAnnual: 3_600, insuranceAnnual: 2_800, ...change });

describe("a portfolio loan's properties", () => {
  it("are checked before they're saved", () => {
    expect(scheduleProblem([])).toBeNull();
    expect(scheduleProblem([home(1)])).toMatch(/at least 2/);
    expect(scheduleProblem([home(1), home(2, { value: 50_000 })])).toMatch(/at least \$75,000/);
    expect(scheduleProblem([home(1), home(2, { monthlyRent: 0 })])).toMatch(/monthly rent/);
    expect(scheduleProblem([home(1), home(2, { zip: "330" })])).toMatch(/5-digit ZIP/);
    expect(scheduleProblem([home(1), home(2, { address: "1 PALM STREET" })])).toMatch(/twice/);
    expect(scheduleProblem(Array.from({ length: PORTFOLIO.maxProperties + 1 }, (_, n) => home(n)))).toMatch(/at most 20/);
    expect(scheduleProblem([home(1), home(2)])).toBeNull();
  });
  it("size the loan on their values, rents and costs added up", () => {
    const app = portfolioApp(demoBook().deals.find((d) => d.id === "d4")!.app, [home(1), home(2, { hoaMonthly: 150 })]);
    expect(app).toMatchObject({ product: "dscr", purchasePrice: 430_000, arv: 430_000, monthlyRent: 3_950, taxesAnnual: 7_200, insuranceAnnual: 5_600, hoaMonthly: 150, rehab: 0 });
  });
  it("are set by the team before the loan clears to close, and only on a rental loan", () => {
    const b = demoBook();
    const save = (dealId: string, properties = [home(1), home(2)]): BookAction => ({ t: "saveProperties", dealId, properties, by: "x" });
    expect(check(b, person("b-casey", ["BORROWER"]), save("d4"))).toHaveProperty("error");
    expect(check(b, underwriter, save("d1"))).toEqual({ error: "Portfolio loans are rental (DSCR) loans." });
    expect(check(b, underwriter, save("d10"))).toEqual({ error: "A loan's properties are set once it clears to close." });
    const { after } = run(b, underwriter, save("d4"));
    const d4 = deal(after, "d4");
    expect(d4).toMatchObject({ address: "1 Palm St", city: "Hollywood", zip: "33020" });
    expect(d4.properties).toHaveLength(2);
    expect(evaluate(d4.app).noteAmount).toBeGreaterThan(0);
    // Each property's share of the loan adds up to the loan.
    const lines = propertyLines(d4);
    expect(lines.reduce((total, line) => total + line.allocated, 0)).toBeCloseTo(evaluate(d4.app).noteAmount, 0);
    expect(lines[0].releasePrice).toBe(Math.ceil((lines[0].allocated * PORTFOLIO.releasePremium) / 100) * 100);
    // Its values and rents now come from the properties, not the loan's own number fields.
    expect(check(after, underwriter, { t: "updateDealNumbers", dealId: "d4", changes: { monthlyRent: 9_999 } })).toMatchObject({ error: expect.stringMatching(/property schedule/) });
    expect(check(after, underwriter, { t: "updateDealNumbers", dealId: "d4", changes: { fico: 760 } })).not.toHaveProperty("error");
    // Back to one property.
    expect(deal(run(after, underwriter, save("d4", [])).after, "d4").properties).toBeUndefined();
    expect(productFor("dscr_portfolio")).toBe("dscr");
  });
});

describe("releasing a property", () => {
  // The demo's Coral Springs rental is a portfolio of two, funded and paying.
  const b = demoBook();
  const today = serviceDay(b);
  const d10 = deal(b, "d10");
  it("costs its share of the loan times the premium, or more to keep the rest within the limits", () => {
    expect(propertyLines(d10).map((line) => line.share)).toEqual([240 / 420, 180 / 420]);
    for (const property of d10.properties!) {
      const quote = releaseQuote(d10, property.id, today) as ReleaseQuote;
      expect(quote.price).toBe(Math.min(balanceOf(d10), Math.max(quote.premiumPrice, Math.ceil(quote.minimum / 100) * 100)));
      const { maxLtv, minDscr } = limitsOf(d10);
      expect(quote.after.ltv).toBeLessThanOrEqual(maxLtv + 1e-6);
      expect(quote.after.dscr).toBeGreaterThanOrEqual(minDscr - 1e-6);
      expect(quote.after.payment).toBeLessThan(evaluate(d10.app).monthlyPayment);
      expect(quote.total).toBeCloseTo(quote.price + quote.interest, 2);
    }
    expect(releaseQuote(deal(b, "d4"), "x", today)).toEqual({ problem: "Properties are released from a funded loan." });
  });
  it("pays principal down and works the payment out again on what's left", () => {
    const property = d10.properties![1];
    const quote = releaseQuote(d10, property.id, today) as ReleaseQuote;
    const release: BookAction = { t: "releaseProperty", dealId: "d10", propertyId: property.id, on: today, amount: quote.total, reference: "TITLE-9", by: "x" };
    expect(check(b, person("b-drew", ["BORROWER"]), release)).toHaveProperty("error");
    expect(check(b, servicer, { ...release, amount: quote.total - 1 } as BookAction)).toMatchObject({ error: expect.stringMatching(/The release takes/) });
    expect(check(b, servicer, { ...release, on: "2099-01-01" } as BookAction)).toHaveProperty("error");
    const { after, action } = run(b, servicer, release);
    const loan = deal(after, "d10");
    expect(loan.properties![1].released).toMatchObject({ on: today });
    expect(heldProperties(loan)).toHaveLength(1);
    expect(loan.releases![0]).toMatchObject({ principal: quote.price, interest: quote.interest, afterPayments: paymentsMade(d10), reference: "TITLE-9" });
    expect(balanceOf(loan)).toBeCloseTo(balanceOf(d10) - quote.price, 2);
    expect(loan.releases![0].newPayment).toBeCloseTo(quote.after.payment, 2);
    // Payments due from now on are the new one; the ones already due keep theirs.
    const rows = ledger(loan).rows;
    expect(rows.find((row) => row.due > today)!.amount).toBeCloseTo(loan.releases![0].newPayment, 2);
    expect(rows[0].amount).toBeCloseTo(ledger(d10).rows[0].amount, 2);
    // The balance after more payments follows the new payment on the lower balance.
    expect(rentalBalance(loan, paymentsMade(d10) + 1)).toBeLessThan(balanceOf(loan));
    expect(portfolioNow(loan)).toMatchObject({ held: 1, released: 1 });
    // The last one goes with the loan's payoff.
    expect(releaseQuote(loan, loan.properties![0].id, today)).toEqual({ problem: "That's the last property on the loan: pay the loan off instead." });
    const told = alertsFor(b, after, action).find((alert) => alert.to === "borrower")!;
    expect(told).toMatchObject({ event: "loan.property_released" });
    expect(told.body).toMatch(/your monthly payment is now \$[\d,]+\.\d\d/);
    // An investor holding the loan gets its share of the release.
    const holding = { deal: loan, share: 0.5, investorRate: 7, noteRate: evaluate(loan.app).rate };
    const withRelease = splitOf(holding, (day) => day === today);
    expect(withRelease.principal).toBeCloseTo(0.5 * quote.price, 2);
  });
});

describe("what others see of a portfolio", () => {
  it("is the numbers without the addresses on a partner's teaser", () => {
    const b = demoBook();
    const teased = { ...b, deals: b.deals.map((d) => (d.id === "d10" ? { ...d, teaserSentTo: ["p-c"] } : d)) };
    const blind = scopeBook(teased, person("cy", ["PARTNER_LENDER"], "p-c")).deals.find((d) => d.id === "d10")!;
    expect(blind.properties!.every((property) => property.address === "" && property.zip.endsWith("xx"))).toBe(true);
    expect(blind.properties!.map((property) => property.value)).toEqual([240_000, 180_000]);
  });
  it("puts the loan in a storm's cone when any property is", () => {
    const b = demoBook();
    const parkland = [{ outer: [[-80.3, 26.28], [-80.2, 26.28], [-80.2, 26.34], [-80.3, 26.34], [-80.3, 26.28]] as [number, number][], holes: [] }];
    expect(loansInCone(b.deals, parkland)).toContain("d10");
  });
});
