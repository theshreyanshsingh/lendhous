import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { transferProblem } from "@/lib/capital-moves";
import { investorBlocker, ownStatusBlocker, statusProblem, statusState, type StatusInput } from "@/lib/investor-status";
import type { InvestorStatus } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const owner = person("olivia", ["ADMIN_OWNER"]);
const capital = person("cam", ["CAPITAL_MANAGER"]);
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};
const DAY = "2026-10-31";
const status = (change: Partial<InvestorStatus> = {}): InvestorStatus => ({ entity: "llc", basis: "accredited_investor", how: "entity_assets", evidence: "self_certified", on: "2026-06-01", expiresOn: "2027-06-01", signedName: "x", by: "x", at: "x", ...change });
const withStatus = (b: Book, kind: "partners" | "buyers", id: string, value: InvestorStatus | undefined): Book => ({ ...b, [kind]: (b[kind] as { id: string }[]).map((firm) => (firm.id === id ? { ...firm, investorStatus: value } : firm)) });

describe("an investor's status (rank 5, Fla. Stat. 494.001)", () => {
  it("is current until it runs out, warns a month before, and none of the institutional kinds counts as not institutional", () => {
    expect(statusState({}, DAY)).toBe("missing");
    expect(statusState({ investorStatus: status() }, DAY)).toBe("current");
    expect(statusState({ investorStatus: status({ expiresOn: "2026-11-20" }) }, DAY)).toBe("expiring");
    expect(statusState({ investorStatus: status({ expiresOn: "2026-10-30" }) }, DAY)).toBe("expired");
    expect(statusState({ investorStatus: status({ basis: "none" }) }, DAY)).toBe("noninstitutional");
    expect(investorBlocker({ name: "Firm", investorStatus: status({ basis: "none" }) }, DAY)).toMatch(/isn't an institutional investor under Fla. Stat. 494.001/);
    expect(investorBlocker({ name: "Firm", investorStatus: status({ expiresOn: "2026-11-20" }) }, DAY)).toBeNull();
    expect(ownStatusBlocker({ name: "Firm" }, DAY)).toMatch(/Certify what kind of investor/);
  });
  it("checks what's entered: the accredited test, the dates, a signature from the firm, a verifier from the team", () => {
    const input: StatusInput = { entity: "individual", basis: "accredited_investor", how: "net_worth", evidence: "self_certified", on: DAY, expiresOn: "2027-10-31", signedName: "Pia" };
    expect(statusProblem(input, DAY, "firm")).toBeNull();
    expect(statusProblem({ ...input, how: undefined }, DAY, "firm")).toMatch(/which test/);
    expect(statusProblem({ ...input, signedName: " " }, DAY, "firm")).toMatch(/Type your name/);
    expect(statusProblem({ ...input, evidence: "verified", verifiedBy: "CPA" }, DAY, "firm")).toMatch(/Only LendHous can mark/);
    expect(statusProblem({ ...input, evidence: "verified" }, DAY, "team")).toMatch(/Say who verified it/);
    expect(statusProblem({ ...input, on: "2026-11-02" }, DAY, "team")).toMatch(/today or earlier/);
    expect(statusProblem({ ...input, expiresOn: "2029-01-01" }, DAY, "team")).toMatch(/two years at most/);
  });
  it("a firm certifies only its own, on its word; the team records either kind for any firm", () => {
    const b = demoBook();
    const input: StatusInput = { entity: "fund", basis: "reit", evidence: "self_certified", on: DAY, expiresOn: "2027-10-31", signedName: "Dana" };
    const partner = person("p-d", ["PARTNER_LENDER"]);
    const own: BookAction = { t: "saveInvestorStatus", kind: "partner", firmId: "p-d", status: input, by: "spoofed" };
    expect(parseAction(own)).not.toBeNull();
    const after = run(b, partner, own);
    expect(after.partners.find((firm) => firm.id === "p-d")!.investorStatus).toMatchObject({ basis: "reit", evidence: "self_certified", signedName: "Dana", by: "p-d name" });
    expect(check(b, partner, { ...own, firmId: "p-a" })).toEqual({ error: "Your account can't do that." });
    expect(check(b, partner, { ...own, status: { ...input, evidence: "verified", verifiedBy: "Me" } })).toEqual({ error: "Only LendHous can mark a status verified." });
    expect(check(b, person("buy-a", ["LOAN_BUYER"]), { ...own, kind: "buyer", firmId: "buy-a" })).not.toHaveProperty("error");
    const verified = run(b, capital, { ...own, status: { ...input, evidence: "verified", verifiedBy: "Sample CPA, letter of Oct 30", signedName: undefined } });
    expect(verified.partners.find((firm) => firm.id === "p-d")!.investorStatus).toMatchObject({ evidence: "verified", verifiedBy: "Sample CPA, letter of Oct 30", by: "cam name" });
    // The firm sees its own status; the sanctions screening stays the team's.
    const view = scopeBook(after, partner);
    expect(view.partners[0]).toMatchObject({ id: "p-d", investorStatus: { basis: "reit" } });
    expect(view.partners[0].screening).toBeUndefined();
  });
  it("holds teasers, bids and their acceptance until the partner's status is current", () => {
    const b = withStatus(demoBook(), "partners", "p-a", undefined);
    expect(check(b, owner, { t: "sendTeaser", dealId: "d1", partnerIds: ["p-a", "p-b"] })).toEqual({ error: "Demo Partner Capital A (FAKE) hasn't certified what kind of investor it is (Partners & buyers)." });
    expect(check(b, owner, { t: "sendTeaser", dealId: "d1", partnerIds: ["p-b"] })).not.toHaveProperty("error");
    expect(check(b, owner, { t: "acceptBid", bidId: "bid1" })).toEqual({ error: "Demo Partner Capital A (FAKE) hasn't certified what kind of investor it is (Partners & buyers)." });
    // A teaser already went to it before the status lapsed: it can't bid on it now.
    const sent = { ...b, deals: b.deals.map((item) => (item.id === "d1" ? { ...item, teaserSentTo: ["p-a"] } : item)) };
    const bid: BookAction = { t: "bid", bid: { dealId: "d1", partnerId: "p-a", pct: 50, lenderRate: 10, lenderPoints: 0.5, conditions: "", type: "bid" } };
    expect(check(sent, person("p-a", ["PARTNER_LENDER"]), bid)).toEqual({ error: expect.stringMatching(/Certify what kind of investor your firm is/) });
    expect(check(withStatus(sent, "partners", "p-a", status()), person("p-a", ["PARTNER_LENDER"]), bid)).not.toHaveProperty("error");
    const expired = withStatus(demoBook(), "partners", "p-a", status({ expiresOn: "2026-10-01" }));
    expect(check(expired, owner, { t: "acceptBid", bidId: "bid1" })).toEqual({ error: expect.stringMatching(/ran out on October 1, 2026/) });
  });
  it("holds a buyer's offer, its acceptance, and a share moved to an uncertified partner", () => {
    const b = withStatus(demoBook(), "buyers", "buy-b", status({ basis: "none" }));
    const offer = b.offers.find((item) => item.buyerId === "buy-b" && item.status === "submitted")!;
    expect(check(b, owner, { t: "decideOffer", offerId: offer.id, accept: true })).toEqual({ error: expect.stringMatching(/isn't an institutional investor/) });
    expect(check(b, owner, { t: "decideOffer", offerId: offer.id, accept: false })).not.toHaveProperty("error");
    const listed = b.sales.find((sale) => sale.status === "listed" && !b.offers.some((item) => item.saleId === sale.id && item.buyerId === "buy-b"))!;
    expect(check(b, person("buy-b", ["LOAN_BUYER"]), { t: "offerLoan", saleId: listed.id, buyerId: "", pricePct: 99, note: "", atAsk: false })).toEqual({ error: expect.stringMatching(/isn't an institutional investor/) });
    // A share moved mid-loan goes to an uncertified partner only once it's certified.
    const book = withStatus(demoBook(), "partners", "p-b", undefined);
    const held = book.bids.find((bid) => bid.status === "accepted" && bid.partnerId !== "p-b" && book.deals.find((item) => item.id === bid.dealId)?.status === "servicing_current")!;
    const loan = book.deals.find((item) => item.id === held.dealId)!;
    expect(transferProblem(book, loan, held.partnerId, "p-b", DAY, DAY)).toMatch(/hasn't certified what kind of investor/);
    expect(transferProblem(withStatus(book, "partners", "p-b", status()), loan, held.partnerId, "p-b", DAY, DAY)).toBeNull();
  });
});
