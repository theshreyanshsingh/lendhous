import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { bookingProblem, callSlots, CALL_HOURS, easternInstant, slotLabel } from "@/lib/calls";
import { COUNTIES, countyBySlug, countyTerms, fundedIn, MIN_SHOWN } from "@/lib/counties";
import { BORROWER_ID, DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { pricingConfig } from "@/lib/pricing-config";
import { promoter, surveyDue, surveyProblem, surveyScore } from "@/lib/surveys";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const alex = person(BORROWER_ID, ["BORROWER"]);
const deal = (b: Book, id = "d2") => b.deals.find((d) => d.id === id)!;

describe("county pages", () => {
  it("cover the eight counties, with the core ones lent at full leverage", () => {
    expect(COUNTIES.map((county) => county.slug)).toEqual(["miami-dade", "broward", "palm-beach", "hillsborough", "orange", "duval", "pinellas", "lee"]);
    expect(countyTerms(countyBySlug("broward")!, pricingConfig)).toEqual({ core: true, leverageCut: 0 });
    expect(countyTerms(countyBySlug("lee")!, pricingConfig)).toEqual({ core: false, leverageCut: pricingConfig.adjusters.expansionCountyLeverageCut });
  });
  it("only show LendHous's funded figures once there are enough not to point at one borrower", () => {
    const broward = countyBySlug("broward")!;
    const funded = (n: number): Deal[] => Array.from({ length: n }, (_, at) => ({ ...demoBook().deals.find((d) => d.id === "d2")!, id: `x${at}`, app: { ...demoBook().deals.find((d) => d.id === "d2")!.app, county: "Broward", state: "FL" } }));
    expect(fundedIn(funded(MIN_SHOWN - 1), broward)).toBeNull();
    expect(fundedIn(funded(MIN_SHOWN), broward)).toMatchObject({ loans: MIN_SHOWN });
    expect(fundedIn(funded(MIN_SHOWN), countyBySlug("lee")!)).toBeNull();
  });
});

describe("the survey", () => {
  it("is asked for 60 days after closing and again after payoff, once each", () => {
    const d2 = deal(demoBook());
    expect(surveyDue(d2, "2026-10-31")).toBe("funded");
    expect(surveyDue(d2, "2026-11-04")).toBeNull();
    expect(surveyDue({ ...d2, surveys: [{ stage: "funded", score: 8, comment: "", at: "x" }] }, "2026-10-31")).toBeNull();
    const paid = { ...d2, status: "paid_off" as const, paidOff: { ...(d2.paidOff ?? {}), receivedOn: "2026-10-20" } as Deal["paidOff"] };
    expect(surveyDue(paid, "2026-10-31")).toBe("paid_off");
    expect(surveyDue(deal(demoBook(), "d1"), "2026-10-31")).toBeNull();
  });
  it("is answered by the borrower alone, 0 to 10, and kept from brokers, partners and buyers", () => {
    const b = demoBook();
    expect(surveyProblem(deal(b), "funded", 11, "2026-10-31")).toMatch(/0 to 10/);
    expect(surveyProblem(deal(b), "paid_off", 9, "2026-10-31")).toMatch(/isn't open/);
    const action: BookAction = { t: "answerSurvey", dealId: "d2", stage: "funded", score: 9, comment: " Fast draws " };
    expect(check(b, person("olivia", ["ADMIN_OWNER"]), action)).toHaveProperty("error");
    const result = check(b, alex, action);
    if ("error" in result) throw new Error(result.error);
    const after = reducer(b, result.action);
    expect(deal(after).surveys).toMatchObject([{ stage: "funded", score: 9, comment: "Fast draws" }]);
    expect(check(after, alex, action)).toEqual({ error: "You've already answered this one. Thank you." });
    expect(deal(scopeBook(after, alex)).surveys).toHaveLength(1);
    const shared = { ...after, deals: after.deals.map((d) => (d.id === "d2" ? { ...d, teaserSentTo: [DEMO_PARTNER_ID] } : d)) };
    expect(scopeBook(shared, person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID)).deals.find((d) => d.id === "d2")?.surveys).toBeUndefined();
    expect(promoter(9) && !promoter(8)).toBe(true);
  });
  it("adds up to a net promoter score for the reports", () => {
    const score = surveyScore(demoBook().deals, { from: "2026-01-01", to: "2026-12-31" });
    // A 10, a 9 and a 6: two promoters and one detractor of three.
    expect(score).toMatchObject({ answers: 3, promoters: 2, detractors: 1, nps: 33 });
    expect(score.comments).toHaveLength(2);
    expect(surveyScore(demoBook().deals, { from: "2025-01-01", to: "2025-12-31" }).nps).toBeNull();
  });
});

describe("booking a call", () => {
  it("offers half hours in Florida business hours, daylight saving included", () => {
    expect(easternInstant("2026-11-09", 600).toISOString()).toBe("2026-11-09T15:00:00.000Z");
    expect(easternInstant("2026-07-09", 600).toISOString()).toBe("2026-07-09T14:00:00.000Z");
    const days = callSlots(new Date("2026-11-07T17:00:00Z"), []);
    expect(days).toHaveLength(CALL_HOURS.days);
    // Saturday the 7th and Veterans Day (a Florida holiday) are skipped.
    expect(days.map((item) => item.day).slice(0, 3)).toEqual(["2026-11-09", "2026-11-10", "2026-11-12"]);
    expect(days[0].slots).toHaveLength((CALL_HOURS.end - CALL_HOURS.start) / CALL_HOURS.slot);
    expect(slotLabel(days[0].slots[0])).toBe("Monday, November 9 at 10:00 am Eastern");
  });
  it("needs notice, and leaves out times already taken", () => {
    // 11:45 am on a Monday: nothing before 1:45 pm is offered that day, so the first is 2 pm.
    const now = new Date("2026-11-09T16:45:00Z");
    const today = callSlots(now, [])[0];
    expect(today.day).toBe("2026-11-09");
    expect(today.slots[0]).toBe("2026-11-09T19:00:00.000Z");
    // At 1:45 pm the last call, 3:30, is too soon, so Monday is gone.
    expect(callSlots(new Date("2026-11-09T18:45:00Z"), [])[0].day).toBe("2026-11-10");
    const taken = callSlots(now, ["2026-11-10T15:00:00.000Z"]).find((item) => item.day === "2026-11-10")!;
    expect(taken.slots).not.toContain("2026-11-10T15:00:00.000Z");
  });
  it("checks who to call and that the time is still open", () => {
    const now = new Date("2026-11-07T17:00:00Z");
    const request = { startsAt: "2026-11-09T15:00:00.000Z", name: "Tess Test", email: "tess@example.org", phone: "(954) 555-0100", topic: "new_loan" as const, notes: "" };
    expect(bookingProblem(request, now, [])).toBeNull();
    expect(bookingProblem(request, now, ["2026-11-09T15:00:00.000Z"])).toMatch(/isn't open/);
    expect(bookingProblem({ ...request, startsAt: "2026-11-11T15:00:00.000Z" }, now, [])).toMatch(/isn't open/);
    expect(bookingProblem({ ...request, email: "tess" }, now, [])).toMatch(/email/);
    expect(bookingProblem({ ...request, phone: "555" }, now, [])).toMatch(/phone/);
  });
});
