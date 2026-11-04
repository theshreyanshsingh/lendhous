import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book } from "@/lib/book";
import { evaluate, fundedBalances } from "@/lib/engine";
import { holdingsOf, monthName, previousMonth, splitOf, statementFor, statementRows } from "@/lib/investor-statements";
import { nextStage } from "@/lib/loan-stages";
import { can, type Permission } from "@/lib/permissions";
import { partnerFundsBlocker, sendToFor, sentProblem } from "@/lib/partner-funding";
import { SERVICING_STRIP_PCT } from "@/lib/loan-sale";

const allowedFor = (viewer: Viewer) => (permission: Permission) => can(viewer.roleCodes, permission, { member: viewer });
const check = (book: Book, viewer: Viewer, action: Parameters<typeof authorize>[2], trusted = false) => authorize(book, viewer, action, allowedFor(viewer), trusted);
const partner: Viewer = { id: "pia", name: "Pia Partner (FAKE)", roleCodes: ["PARTNER_LENDER"], organizationId: "p-a" };
const otherPartner: Viewer = { id: "pete", name: "Pete Other", roleCodes: ["PARTNER_LENDER"], organizationId: "p-b" };
const owner: Viewer = { id: "owner", name: "Olivia Owner (FAKE)", roleCodes: ["ADMIN_OWNER"] };
const borrower: Viewer = { id: "b-emery", name: "Emery", roleCodes: ["BORROWER"] };

describe("what each investor is paid", () => {
  const book = demoBook();
  it("a partner gets its share of the interest at its own rate; LendHous keeps the difference", () => {
    const statement = statementFor(book, { type: "partner", id: "p-a" }, "2026-10");
    const d11 = book.deals.find((deal) => deal.id === "d11")!;
    const monthly = fundedBalances(evaluate(d11.app), d11.app, d11.disbursedDraws).nextPayment;
    expect(statement.investor.name).toBe("Demo Partner Capital A (FAKE)");
    expect(statement.lines).toHaveLength(1);
    const [line] = statement.lines;
    expect(line).toMatchObject({ loanNumber: "LH-DEMO-1011", share: 0.5, investorRate: 9.25, payments: 1, principal: 0, balance: 232_500 });
    expect(line.interest).toBeCloseTo(monthly / 2, 1);
    expect(line.net).toBeCloseTo((232_500 * 0.0925) / 12, 1);
    expect(line.interest - line.servicingFee).toBeCloseTo(line.net, 2);
  });
  it("a buyer gets everything after the day it bought, less the servicing strip", () => {
    const [holding] = holdingsOf(book, { type: "buyer", id: book.buyerId });
    expect(holding).toMatchObject({ share: 1, since: "2026-08-18" });
    expect(holding.investorRate).toBeCloseTo(holding.noteRate - SERVICING_STRIP_PCT, 5);
    const october = splitOf(holding, (day) => day.startsWith("2026-10"));
    expect(october.payments).toBe(1);
    expect(october.servicingFee).toBeCloseTo(october.interest * (SERVICING_STRIP_PCT / holding.noteRate), 1);
    // Nothing paid before the sale counts.
    expect(splitOf({ ...holding, since: "2026-10-15" }, () => true).payments).toBe(0);
  });
  it("an amortizing loan's payment splits into interest and principal by the schedule", () => {
    const dscr = book.deals.find((deal) => deal.app.product === "dscr" && deal.status === "servicing_current")!;
    const paid = { ...dscr, boardedThrough: undefined, payments: [{ id: "p1", amount: evaluate(dscr.app).monthlyPayment, receivedOn: dscr.nextPaymentDue!, method: "ach" as const, reference: "x", by: "x", at: `${dscr.nextPaymentDue}T12:00:00Z` }] };
    const split = splitOf({ deal: paid, share: 1, investorRate: 7, noteRate: evaluate(dscr.app).rate }, () => true);
    if (split.payments) expect(split.interest + split.principal).toBeCloseTo(evaluate(dscr.app).monthlyPayment * split.payments, 0);
    expect(split.principal).toBeGreaterThanOrEqual(0);
  });
  it("a loan paid off pays back the principal, and nothing after", () => {
    const d11 = book.deals.find((deal) => deal.id === "d11")!;
    const paidOff = { ...d11, status: "paid_off" as const, paidOff: { amount: 470_000, owed: 470_000, receivedOn: "2026-11-10", method: "wire" as const, reference: "x", by: "x", at: "2026-11-10T12:00:00Z" } };
    const holding = { deal: paidOff, share: 0.5, investorRate: 9.25, noteRate: evaluate(d11.app).rate };
    const november = splitOf(holding, (day) => day.startsWith("2026-11"));
    expect(november.principal).toBeCloseTo(232_500, 0);
    expect(november.interest).toBeCloseTo((470_000 - 465_000) / 2, 0);
    const later = statementFor({ ...book, deals: book.deals.map((deal) => (deal.id === "d11" ? paidOff : deal)) }, { type: "partner", id: "p-a" }, "2026-12");
    expect(later.lines).toHaveLength(0);
  });
  it("months and spreadsheets", () => {
    expect(previousMonth("2026-11-01")).toBe("2026-10");
    expect(previousMonth("2027-01-04")).toBe("2026-12");
    expect(monthName("2026-10")).toBe("October 2026");
    expect(statementRows(statementFor(book, { type: "partner", id: "p-a" }, "2026-10"))[0]).toMatchObject({ Month: "2026-10", Loan: "LH-DEMO-1011", Share: "50%" });
  });
});

describe("a partner's money for closing", () => {
  // d15 is at closing with its escrow wire verified; give the demo partner a winning bid on it.
  const won = (): Book => {
    const base = demoBook();
    const book = { ...base, deals: base.deals.map((deal) => (deal.id === "d15" ? { ...deal, teaserSentTo: ["p-a"] } : deal)), bids: [...base.bids, { id: "bid-15", dealId: "d15", partnerId: "p-a", pct: 40, lenderRate: 9.5, lenderPoints: 0.5, conditions: "", status: "submitted" as const, type: "bid" as const, at: "2026-10-20T12:00:00Z" }] };
    return reducer(book, { t: "acceptBid", bidId: "bid-15" });
  };
  it("accepting a bid records the partner's share, and funding waits for it", () => {
    const book = won();
    const deal = book.deals.find((item) => item.id === "d15")!;
    expect(deal.partnerFunding).toEqual({ partnerId: "p-a", amount: Math.round((evaluate(deal.app).noteAmount * 40) / 100) });
    expect(partnerFundsBlocker(deal)).toMatch(/partner's share .* hasn't arrived/);
    expect(nextStage(deal, evaluate(deal.app))?.blockers.join(" ")).toMatch(/partner's share/);
  });
  it("only the winning partner says it's sent, once the escrow account is verified, and the team confirms it", () => {
    const book = won();
    const deal = book.deals.find((item) => item.id === "d15")!;
    const sent = { t: "partnerFundsSent" as const, dealId: "d15", sentOn: "2026-10-30", reference: "FED 123", by: "Pia" };
    expect(check(book, partner, sent)).not.toHaveProperty("error");
    expect(check(book, otherPartner, sent)).toHaveProperty("error");
    expect(check(book, owner, sent)).toHaveProperty("error");
    expect(sentProblem({ ...deal, wires: deal.wires?.map((wire) => ({ ...wire, verification: undefined })) }, "p-a")).toMatch(/verified the escrow account/);
    expect(sentProblem({ ...deal, status: "conditions" }, "p-a")).toMatch(/clear to close/);
    const after = reducer(book, sent);
    expect(after.deals.find((item) => item.id === "d15")!.partnerFunding?.sent).toMatchObject({ on: "2026-10-30", reference: "FED 123" });
    expect(alertsFor(book, after, sent)).toEqual([expect.objectContaining({ to: "team", event: "partner_funds.sent" })]);
    const received = { t: "partnerFundsReceived" as const, dealId: "d15", on: "2026-10-31", by: "Cam" };
    expect(check(after, partner, received)).toHaveProperty("error");
    expect(check(after, owner, received)).not.toHaveProperty("error");
    const done = reducer(after, received);
    expect(partnerFundsBlocker(done.deals.find((item) => item.id === "d15")!)).toBeNull();
    expect(alertsFor(after, done, received)).toEqual([expect.objectContaining({ to: "partner", firmId: "p-a", event: "partner_funds.received" })]);
    expect(parseAction(sent)).toEqual(sent);
    expect(parseAction({ ...sent, sentOn: "yesterday" })).toBeNull();
  });
  it("the winning partner sees where to send it; nobody else sees the partner side", () => {
    const book = won();
    const deal = book.deals.find((item) => item.id === "d15")!;
    const mine = scopeBook(book, partner).deals.find((item) => item.id === "d15")!;
    expect(mine.partnerFunding?.sendTo).toEqual(sendToFor(deal));
    expect(mine.partnerFunding?.sendTo?.account).toBe(deal.wires![0].account);
    expect(scopeBook(book, otherPartner).deals.find((item) => item.id === "d15")?.partnerFunding).toBeUndefined();
    expect(scopeBook(book, borrower).deals.find((item) => item.id === "d15")?.partnerFunding).toBeUndefined();
    // It's never stored.
    expect(deal.partnerFunding?.sendTo).toBeUndefined();
  });
});
