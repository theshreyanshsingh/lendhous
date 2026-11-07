import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { brandContact, brandProblem, brokerLetterProblem, brokerStanding, priorityBroker, protectingBroker, BROKER_LETTER_DAYS } from "@/lib/broker-program";
import { INVESTOR_STATUS, investorStatus, latestUpdate, workoutProblem } from "@/lib/investor-updates";
import { letterNumber } from "@/lib/letters";
import { DEMO_BROKER_ID, DEMO_BUYER_ID, DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const owner = person("owner", ["ADMIN_OWNER"]);
const servicer = person("svc", ["SERVICER"]);
const bea = person("bea", ["BROKER"], DEMO_BROKER_ID);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
// The demo brokerage's loan, funded again and again: enough volume for a tier.
const withVolume = (b: Book, loans: number, status: Deal["status"] = "servicing_current"): Book => ({ ...b, deals: [...b.deals, ...Array.from({ length: loans }, (_, at) => ({ ...deal(b, "d10"), id: `v${at}`, loanNumber: `LH-V${at}`, status, closingDate: "2026-06-01" }))] });

describe("broker tiers", () => {
  it("come from the last 12 months' funded loans and how many are behind", () => {
    const b = demoBook();
    expect(brokerStanding(b.deals, DEMO_BROKER_ID, "2026-10-31")).toMatchObject({ loans: 1, funded: 315_000, tier: null, next: { name: "Silver", more: 685_000 } });
    // Ten more like it: $3.465M funded, Gold.
    const gold = brokerStanding(withVolume(b, 10).deals, DEMO_BROKER_ID, "2026-10-31");
    expect(gold.tier?.name).toBe("Gold");
    expect(gold.next).toMatchObject({ name: "Platinum" });
    // The same volume with too many behind drops to the tier that allows it.
    // One of eleven behind (9%) is too many for Gold's 5%, fine for Silver's 10%.
    const late = withVolume(withVolume(b, 9), 1, "servicing_delinquent");
    expect(brokerStanding(late.deals, DEMO_BROKER_ID, "2026-10-31").tier?.name).toBe("Silver");
    // Old loans fall out of the window.
    expect(brokerStanding(withVolume(b, 10).deals, DEMO_BROKER_ID, "2027-07-01").tier).toBeNull();
  });
  it("put Gold and Platinum brokers' files first in the team's queue", () => {
    const b = withVolume(demoBook(), 10);
    expect(priorityBroker(b.deals, deal(b, "d3"), "2026-10-31")).toBe(true);
    const items = workQueue(b, { id: "" }, new Date("2026-10-31T16:00:00Z"));
    const d3 = [...items.mine, ...items.team].find((item) => item.deal?.id === "d3");
    expect(d3?.brokerTier).toBe("Gold");
    expect(Number.isInteger(d3!.priority)).toBe(false);
  });
});

describe("a broker's brand", () => {
  it("is set by the brokerage itself once approved, and checked", () => {
    const b = demoBook();
    const brand = { name: "Bright Path Capital", phone: "(305) 555-0123", email: "Deals@BrightPath.example", website: "https://brightpath.example" };
    expect(brandProblem({ ...brand, website: "brightpath.example" })).toMatch(/https/);
    expect(brandProblem({ ...brand, phone: "555" })).toMatch(/area code/);
    expect(check(b, person("other", ["BROKER"], "brk-z"), { t: "saveBrokerBrand", brokerId: DEMO_BROKER_ID, brand })).toHaveProperty("error");
    const { after } = run(b, bea, { t: "saveBrokerBrand", brokerId: DEMO_BROKER_ID, brand });
    const saved = after.brokers.find((item) => item.id === DEMO_BROKER_ID)!.brand!;
    expect(saved.email).toBe("deals@brightpath.example");
    expect(brandContact(saved)).toBe("(305) 555-0123 · deals@brightpath.example · brightpath.example");
    expect(scopeBook(after, bea).brokers[0].brand?.name).toBe("Bright Path Capital");
  });
});

describe("a broker's pre-qualification letters", () => {
  it("stay within the limit an owner sets, and are numbered PQ", () => {
    const b = demoBook();
    const firm = b.brokers.find((item) => item.id === DEMO_BROKER_ID)!;
    expect(brokerLetterProblem(firm, 400_000, 30)).toBeNull();
    expect(brokerLetterProblem(firm, 600_000, 30)).toMatch(/up to \$500,000/);
    expect(brokerLetterProblem(firm, 400_000, BROKER_LETTER_DAYS + 1)).toMatch(/at most 30 days/);
    expect(brokerLetterProblem({ ...firm, letterLimit: undefined }, 1, 30)).toMatch(/hasn't set a letter limit/);
    expect(brokerLetterProblem({ ...firm, status: "suspended" }, 1, 30)).toMatch(/approves a brokerage/);
    expect(check(b, bea, { t: "setBrokerLetterLimit", brokerId: DEMO_BROKER_ID, limit: 750_000, by: "x" })).toHaveProperty("error");
    const { after } = run(b, owner, { t: "setBrokerLetterLimit", brokerId: DEMO_BROKER_ID, limit: 750_000, by: "x" });
    expect(after.brokers.find((item) => item.id === DEMO_BROKER_ID)!.letterLimit).toBe(750_000);
    expect(run(after, owner, { t: "setBrokerLetterLimit", brokerId: DEMO_BROKER_ID, limit: 0, by: "x" }).after.brokers.find((item) => item.id === DEMO_BROKER_ID)!.letterLimit).toBeUndefined();
    expect(letterNumber("pre_qualification", "2026", 7)).toBe("PQ-2026-0007");
  });
});

describe("a client who comes back on their own", () => {
  it("is still the broker's, and the broker hears so", () => {
    const b = demoBook();
    const referred = { ...b, deals: b.deals.map((d) => (d.id === "d16" ? { ...d, brokerId: DEMO_BROKER_ID, referredBy: { brokerId: DEMO_BROKER_ID, on: "2026-06-01" } } : d)) };
    expect(protectingBroker(referred.deals, "b-harper", "2026-10-31")).toEqual({ brokerId: DEMO_BROKER_ID, on: "2026-06-01" });
    expect(protectingBroker(referred.deals, "b-harper", "2027-07-01")).toBeNull();
    // Harper applies again from her own portal: no broker on the application.
    const action: BookAction = { t: "submitApp", app: deal(b, "d16").app, address: "9 Return St", city: "Miami", zip: "33130", entityName: "Harper Holdings LLC", exitStrategy: "Sell", client: { name: "Harper Mockup (FAKE)", borrowerId: "b-harper" } };
    const after = reducer(referred, action);
    const added = after.deals.find((d) => !referred.deals.some((old) => old.id === d.id))!;
    expect(added).toMatchObject({ brokerId: DEMO_BROKER_ID, referredBy: { brokerId: DEMO_BROKER_ID } });
    expect(alertsFor(referred, after, action).map((alert) => [alert.to, alert.event])).toEqual([["team", "loan.submitted"], ["broker", "broker.client_direct"]]);
    // One the broker sent themselves isn't news to them.
    const sent: BookAction = { ...action, client: { name: "Harper Mockup (FAKE)", borrowerId: "b-harper", brokerId: DEMO_BROKER_ID } };
    expect(alertsFor(referred, reducer(referred, sent), sent).map((alert) => alert.event)).toEqual(["loan.submitted"]);
  });
});

describe("what investors see", () => {
  it("is a plain status, a workout outranking the rest", () => {
    const b = demoBook();
    expect(investorStatus(deal(b, "d11"))).toBe("current");
    expect(investorStatus(deal(b, "d13"))).toBe("late");
    expect(investorStatus({ status: "default", paymentsLate: 2 })).toBe("default_late");
    expect(investorStatus({ status: "default", paymentsLate: 2, workout: { since: "x", note: "", by: "", at: "" } })).toBe("workout");
    expect(INVESTOR_STATUS.default_late).toBe("In default, payments late");
  });
  it("includes the team's updates, which only the loan's holders see and hear about", () => {
    const b = demoBook();
    const { after, action } = run(b, servicer, { t: "postInvestorUpdate", dealId: "d11", updateId: "iu-1", text: " Roof done, listing soon ", by: "x" });
    expect(latestUpdate(deal(after, "d11"))).toMatchObject({ id: "iu-1", text: "Roof done, listing soon", by: "svc name" });
    expect(alertsFor(b, after, action)).toMatchObject([{ to: "partner", firmId: DEMO_PARTNER_ID, event: "investor.update" }]);
    expect(deal(scopeBook(after, person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID)), "d11").investorUpdates).toHaveLength(2);
    expect(scopeBook(after, person("b-avery", ["BORROWER"])).deals.find((d) => d.id === "d11")?.investorUpdates).toBeUndefined();
    expect(deal(scopeBook(b, person("bella", ["LOAN_BUYER"], DEMO_BUYER_ID)), "d14").investorUpdates).toHaveLength(1);
    expect(check(b, person("bea", ["BROKER"], DEMO_BROKER_ID), { t: "postInvestorUpdate", dealId: "d11", updateId: "iu-2", text: "x", by: "x" })).toHaveProperty("error");
  });
  it("shows a workout the team declares on a loan in trouble, until it ends", () => {
    const b = demoBook();
    expect(workoutProblem(deal(b, "d11"), true, "x")).toMatch(/late, past maturity or in default/);
    expect(workoutProblem(deal(b, "d13"), true, " ")).toMatch(/what's agreed/);
    const declared = run(b, servicer, { t: "setWorkout", dealId: "d13", on: true, note: "Six-month forbearance while the house sells", by: "x" }).after;
    expect(investorStatus(deal(declared, "d13"))).toBe("workout");
    const ended = run(declared, servicer, { t: "setWorkout", dealId: "d13", on: false, note: "Sold and paid off in full", by: "x" }).after;
    expect(deal(ended, "d13").workout).toBeUndefined();
    expect(latestUpdate(deal(ended, "d13"))?.text).toBe("Workout ended: Sold and paid off in full");
  });
});
