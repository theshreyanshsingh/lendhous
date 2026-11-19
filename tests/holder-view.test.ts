import { describe, expect, it } from "vitest";
import { scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, serviceDay, type Book } from "@/lib/book";
import { capitalAccount, expectedPayoff, holderWatch, monthlyLine, payoffLadder } from "@/lib/holder-view";
import { holdingsOf } from "@/lib/investor-statements";
import { DEMO_BUYER_ID, DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";

const b = demoBook();
const today = serviceDay(b);
const held = holdingsOf(b, { type: "partner", id: DEMO_PARTNER_ID })[0];
const bridge = held.deal;
const plan = (change: Partial<NonNullable<Deal["exitPlan"]>>): Deal["exitPlan"] => ({ choice: "sell", confidence: "likely", note: "Private: my cousin is buying it (FAKE)", by: "Borrower", at: "2026-10-01T12:00:00Z", ...change });

describe("what a partner or buyer sees about the loans it holds (rank 14)", () => {
  it("dates the payoff from the borrower's stated exit, else the maturity, and never repeats the borrower's note", () => {
    expect(expectedPayoff(bridge, today)).toEqual({ month: "2027-06", words: "Matures June 30, 2027; the borrower hasn't said how it will pay off yet.", basis: "maturity" });
    const selling = expectedPayoff({ ...bridge, exitPlan: plan({ saleBy: "2027-02-20" }) }, today);
    expect(selling).toEqual({ month: "2027-02", words: "The borrower plans to sell (likely), closing by February 20, 2027; it matures June 30, 2027.", basis: "plan" });
    expect(selling.words).not.toContain("cousin");
    expect(expectedPayoff({ ...bridge, exitPlan: plan({ choice: "refi_other", confidence: "sure" }) }, today).words).toBe("Matures June 30, 2027; the borrower is refinancing with another lender (sure).");
    expect(expectedPayoff({ ...bridge, exitPlan: plan({ saleBy: "2027-09-01" }) }, today).month).toBe("2027-06");
    expect(expectedPayoff({ ...bridge, app: { ...bridge.app, product: "dscr" } }, today)).toEqual({ words: "A 30-year rental loan: it pays off when the borrower sells or refinances.", basis: "term" });
    expect(expectedPayoff(bridge, "2027-08-01")).toMatchObject({ month: "2027-06", words: "Past its maturity of June 30, 2027." });
  });

  it("writes the month's line: payments, draws against the work, insurance and storms", () => {
    expect(monthlyLine(bridge, undefined, today)).toEqual([{ tone: "good", text: "Payments are current." }]);
    const flip = holdingsOf(b, { type: "buyer", id: DEMO_BUYER_ID })[0].deal;
    const watched = { done: 0.4, paid: 0.6, ahead: true, lastInspected: "2026-10-12", storm: "Hurricane Sample (FAKE)" };
    const lines = monthlyLine({ ...flip, disbursedDraws: 51_000 }, watched, today).map((line) => line.text);
    expect(lines).toContain("In the forecast cone of Hurricane Sample (FAKE). LendHous asks the borrower for photos once it passes.");
    expect(lines.find((line) => line.includes("holdback"))).toMatch(/^\$51,000 of the \$\d[\d,]* rehab holdback drawn; the work about 40% done at the last inspection, October 12, 2026\. Money paid out is running ahead of the work\.$/);
    const insured = { ...bridge, insurance: { policies: [{ kind: "hazard" as const, carrier: "Sample Mutual (FAKE)", policy: "H-1", expiresOn: "2026-12-01", by: "x", at: "x" }] } };
    expect(monthlyLine(insured, undefined, today)).toContainEqual({ tone: "warn", text: "The hazard (property) policy runs out December 1, 2026; LendHous asks the borrower for the renewal." });
    expect(monthlyLine(insured, undefined, "2026-12-05")).toContainEqual({ tone: "bad", text: "The hazard (property) policy ran out December 1, 2026; LendHous is following up." });
  });

  it("ladders the money coming back by when each loan should pay off, not only its maturity", () => {
    const holdings = [held, { ...held, deal: { ...bridge, id: "x2", loanNumber: "LH-X2", exitPlan: plan({ saleBy: "2027-01-10" }) } }];
    expect(payoffLadder(holdings, today).map((row) => row.month)).toEqual(["2027-01", "2027-06"]);
    // Past its date, it's counted this month; a share moved on to someone else isn't counted.
    expect(payoffLadder(holdings, "2027-02-02").map((row) => row.month)).toEqual(["2027-02", "2027-06"]);
    expect(payoffLadder([{ ...held, until: "2026-09-01" }], today)).toEqual([]);
  });

  it("keeps a capital account a row per loan: committed, called, received, paid back and rolled", () => {
    const [row] = capitalAccount(b, { type: "partner", id: DEMO_PARTNER_ID }, today);
    expect(row).toMatchObject({ loanNumber: "LH-DEMO-1011", share: 0.5, status: "Current", calledForDraws: 0, rolledOver: 0 });
    expect(row.paidToYou).toBeCloseTo(row.principalBack + row.interestToYou, 2);
    expect(row.committed).toBeGreaterThan(0);
    const [owned] = capitalAccount(b, { type: "buyer", id: DEMO_BUYER_ID }, today);
    expect(owned.committed).toBe(owned.received);
  });

  it("the server adds the draws and storm summary to a holder's own loans only", () => {
    const book: Book = { ...b, storms: [{ id: "al01", name: "Sample", label: "Hurricane Sample (FAKE)", advisory: "1", firstSeen: "x", lastSeen: "x", dealIds: [bridge.id], nowIn: [bridge.id], status: "active" }] };
    expect(holderWatch(bridge, book)).toMatchObject({ storm: "Hurricane Sample (FAKE)" });
    const partner: Viewer = { id: "pia", name: "Pia", roleCodes: ["PARTNER_LENDER"], organizationId: DEMO_PARTNER_ID } as Viewer;
    const scoped = scopeBook(book, partner);
    const mine = scoped.deals.find((deal) => deal.id === bridge.id)!;
    // The borrower asked for a payoff letter in the demo, which dates the payoff to it.
    expect(mine.holderWatch).toMatchObject({ storm: "Hurricane Sample (FAKE)", payoffAsked: "2026-11-15" });
    expect(expectedPayoff(mine, today)).toEqual({ month: "2026-11", words: "A payoff letter was asked for, good through November 15, 2026; it matures June 30, 2027.", basis: "letter" });
    expect(scoped.deals.filter((deal) => deal.id !== bridge.id).every((deal) => deal.holderWatch === undefined)).toBe(true);
    expect(scopeBook(book, { id: bridge.borrowerId, name: "b", roleCodes: ["BORROWER"] }).deals.every((deal) => deal.holderWatch === undefined)).toBe(true);
  });
});
