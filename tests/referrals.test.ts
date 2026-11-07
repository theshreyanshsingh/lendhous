import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { BORROWER_ID, DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { bonusesPaidIn, bonusOf, bonusPaidProblem, canRefer, DEMO_BONUS, friendCodeFor, referralProblem, referralsBy, referrerByCode, shortName } from "@/lib/referrals";
import { repeatBorrower, workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const owner = person("owner", ["ADMIN_OWNER"]);
const underwriter = person("uw", ["UNDERWRITER"]);
const servicer = person("svc", ["SERVICER"]);
const alex = person(BORROWER_ID, ["BORROWER"]);
const system = person("system", []);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const withDeal = (b: Book, id: string, change: (d: Deal) => Deal): Book => ({ ...b, deals: b.deals.map((d) => (d.id === id ? change(d) : d)) });
// The demo, less its seeded referrals, so each test sets up its own.
const fresh = (): Book => ({ ...demoBook(), deals: demoBook().deals.map(({ friendReferral: _referral, ...d }) => d) });

describe("who can refer, and their link", () => {
  it("is a borrower whose loan has funded, with a code that's always the same", () => {
    const b = demoBook();
    expect(canRefer(b.deals, BORROWER_ID)).toBe(true);
    expect(canRefer(b.deals, "b-harper")).toBe(false);
    expect(canRefer(b.deals, "")).toBe(false);
    expect(friendCodeFor(BORROWER_ID)).toBe(friendCodeFor(BORROWER_ID));
    expect(friendCodeFor(BORROWER_ID)).toMatch(/^[a-z2-9]{8}$/);
    expect(referrerByCode(b.deals, friendCodeFor(BORROWER_ID))).toEqual({ id: BORROWER_ID, name: "Alex Sample (FAKE)" });
    // Someone still applying has no link that works.
    expect(referrerByCode(b.deals, friendCodeFor("b-harper"))).toBeNull();
    expect(referrerByCode(b.deals, "zzzzzzzz")).toBeNull();
  });
  it("names the referrer to the friend by first name and initial only", () => {
    expect(shortName("Alex Sample (FAKE)")).toBe("Alex S.");
    expect(shortName("  maria  de la cruz ")).toBe("maria D.");
    expect(shortName("Cher")).toBe("Cher");
  });
});

describe("counting a referral", () => {
  it("only counts a new borrower's first loan, from someone else", () => {
    const b = fresh();
    expect(referralProblem(b.deals, "d16", BORROWER_ID)).toBeNull();
    expect(referralProblem(b.deals, "d1", BORROWER_ID)).toMatch(/their own loan/);
    expect(referralProblem(b.deals, "d16", "b-harper")).toMatch(/funded can refer/);
    // Avery already has a funded loan, so a new one isn't a new borrower.
    const again = { ...b, deals: [...b.deals, { ...deal(b, "d16"), id: "d-avery-2", borrowerId: "b-avery" }] };
    expect(referralProblem(again.deals, "d-avery-2", BORROWER_ID)).toMatch(/already has a LendHous loan/);
    expect(referralProblem(b.deals, "nope", BORROWER_ID)).toMatch(/no longer exists/);
  });
  it("is only recorded by the server, which reads the lead, and only once", () => {
    const b = fresh();
    const action: BookAction = { t: "referFriend", dealId: "d16", referrerId: BORROWER_ID, on: "2026-10-30", bonus: 500 };
    expect(check(b, owner, action)).toEqual({ error: "Your account can't do that." });
    const { after } = run(b, system, action, true);
    expect(deal(after, "d16").friendReferral).toEqual({ referrerId: BORROWER_ID, referrerName: "Alex Sample (FAKE)", on: "2026-10-30", bonus: 500 });
    expect(check(after, system, action, true)).toEqual({ error: "This loan is already counted as a referral." });
    expect(check(b, system, { ...action, dealId: "d1" }, true)).toEqual({ error: "A borrower can't refer their own loan." });
  });
});

describe("the bonus", () => {
  it("is expected until the friend's loan funds, earned after, and paid once recorded", () => {
    const b = demoBook();
    expect(bonusOf(deal(b, "d16"))).toEqual({ amount: DEMO_BONUS, state: "expected" });
    expect(bonusOf(deal(b, "d17"))).toEqual({ amount: DEMO_BONUS, state: "earned" });
    expect(bonusOf(deal(b, "d12"))).toEqual({ amount: DEMO_BONUS, state: "paid" });
    expect(bonusOf({ ...deal(b, "d16"), status: "declined" })).toEqual({ amount: 0, state: "none" });
    expect(bonusOf({ ...deal(b, "d17"), friendReferral: { ...deal(b, "d17").friendReferral!, bonus: 0 } })).toEqual({ amount: 0, state: "none" });
    expect(bonusOf(deal(b, "d2"))).toEqual({ amount: 0, state: "none" });
  });
  it("is recorded paid by servicing or capital staff, after funding, on a real day", () => {
    const b = demoBook();
    const d17 = deal(b, "d17");
    expect(bonusPaidProblem(d17, 500, "2026-10-30", "2026-10-31")).toBeNull();
    expect(bonusPaidProblem(d17, 0, "2026-10-30", "2026-10-31")).toMatch(/amount/);
    expect(bonusPaidProblem(d17, 500, "2026-11-02", "2026-10-31")).toMatch(/today or before/);
    expect(bonusPaidProblem(d17, 500, "2026-10-01", "2026-10-31")).toMatch(/before the loan funded/);
    expect(bonusPaidProblem(deal(b, "d16"), 500, "2026-10-30", "2026-10-31")).toMatch(/once the friend's loan funds/);
    expect(bonusPaidProblem(deal(b, "d12"), 500, "2026-10-30", "2026-10-31")).toMatch(/already recorded/);
    expect(bonusPaidProblem(deal(b, "d2"), 500, "2026-10-30", "2026-10-31")).toMatch(/wasn't referred/);
    const pay: BookAction = { t: "referralBonusPaid", dealId: "d17", amount: 500, on: "2026-10-30", reference: " ACH 77 ", by: "browser says" };
    expect(check(b, underwriter, pay)).toHaveProperty("error");
    const { after, action } = run(b, servicer, pay);
    expect(deal(after, "d17").friendReferral!.paid).toMatchObject({ amount: 500, on: "2026-10-30", reference: "ACH 77", by: "svc name" });
    expect(alertsFor(b, after, action).filter((alert) => alert.event.startsWith("referral."))).toMatchObject([{ to: "user", userId: BORROWER_ID, event: "referral.paid", body: expect.stringMatching(/\$500\.00 referral bonus on October 30, 2026 \(ACH 77\)/) }]);
  });
  it("tells the referrer and the team when the friend's loan funds", () => {
    const b = demoBook();
    const before = withDeal(b, "d16", (d) => ({ ...d, status: "closing" }));
    const after = withDeal(b, "d16", (d) => ({ ...d, status: "funded" }));
    const alerts = alertsFor(before, after, { t: "advanceLoan", dealId: "d16" }).filter((alert) => alert.event === "referral.earned");
    expect(alerts).toMatchObject([{ to: "user", userId: BORROWER_ID, body: expect.stringMatching(/earned your \$500\.00 referral bonus/) }, { to: "team", subject: "Referral bonus to pay: LH-DEMO-1016" }]);
    // The friend's name never reaches the referrer.
    expect(alerts[0].body).not.toMatch(/Harper/);
  });
  it("is in the team's queue until it's paid", () => {
    const b = demoBook();
    const queue = workQueue(b, { id: "" }, new Date("2026-10-31T16:00:00Z"));
    const items = [...queue.mine, ...queue.team].filter((item) => item.key.startsWith("referral:"));
    expect(items).toMatchObject([{ key: "referral:d17", label: "Pay Alex Sample (FAKE)'s referral bonus", href: "/admin/deals/d17?tab=Capital%20Routing" }]);
  });
  it("adds up by referrer and year for the 1099-MISC question", () => {
    const b = demoBook();
    expect(bonusesPaidIn(b.deals, 2026)).toEqual([{ referrerId: BORROWER_ID, name: "Alex Sample (FAKE)", total: DEMO_BONUS, loans: ["LH-DEMO-1012"], needsForm: false }]);
    expect(bonusesPaidIn(b.deals, 2025)).toEqual([]);
    const two = withDeal(b, "d17", (d) => ({ ...d, friendReferral: { ...d.friendReferral!, paid: { amount: 500, on: "2026-10-30", reference: "", by: "x", at: "y" } } }));
    expect(bonusesPaidIn(two.deals, 2026)[0]).toMatchObject({ total: 1000, needsForm: true });
  });
});

describe("what each side sees", () => {
  it("gives the referrer where each bonus stands, and never the friends' loans", () => {
    const view = scopeBook(demoBook(), alex);
    expect(view.deals.every((d) => d.borrowerId === BORROWER_ID)).toBe(true);
    expect(view.myReferrals).toEqual([
      { on: "2026-10-30", state: "expected", amount: DEMO_BONUS },
      { on: "2026-09-28", state: "earned", amount: DEMO_BONUS },
      { on: "2026-03-10", state: "paid", amount: DEMO_BONUS, paidOn: "2026-04-15" },
    ]);
    expect(referralsBy(demoBook().deals, BORROWER_ID)).toEqual(view.myReferrals);
  });
  it("keeps the referral off the friend's own loan, and off a partner's blind teaser", () => {
    const harper = scopeBook(demoBook(), person("b-harper", ["BORROWER"]));
    expect(deal(harper, "d16").friendReferral).toBeUndefined();
    const partner = scopeBook({ ...demoBook(), deals: demoBook().deals.map((d) => (d.id === "d16" ? { ...d, teaserSentTo: [DEMO_PARTNER_ID] } : d)) }, person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID));
    expect(partner.deals.find((d) => d.id === "d16")?.friendReferral).toBeUndefined();
    expect(scopeBook(demoBook(), owner).deals.find((d) => d.id === "d16")?.friendReferral).toBeDefined();
  });
});

describe("repeat borrowers go first", () => {
  it("ranks their items ahead of the same kind and tags them", () => {
    const b = demoBook();
    const d16 = deal(b, "d16");
    expect(repeatBorrower(d16)).toBe(false);
    expect(repeatBorrower({ app: { ...d16.app, repeat: { loans: 2, counted: [], asOf: "2026-10-31" } } })).toBe(true);
    expect(repeatBorrower({ app: { ...d16.app, repeat: { loans: 2, counted: [], pausedBy: "LH-1", asOf: "2026-10-31" } } })).toBe(false);
    const repeat = withDeal(b, "d16", (d) => ({ ...d, app: { ...d.app, repeat: { loans: 1, counted: ["LH-DEMO-1002"], asOf: "2026-10-31" } } }));
    const items = [...workQueue(repeat, { id: "" }, new Date("2026-10-31T16:00:00Z")).team];
    const mine = items.find((item) => item.key === "new:d16")!;
    expect(mine).toMatchObject({ repeat: true, priority: 13.5 });
  });
});
