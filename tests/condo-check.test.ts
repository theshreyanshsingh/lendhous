import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { condoCheck, milestoneDue, type CondoInput } from "@/lib/condo-check";
import { evaluate } from "@/lib/engine";
import { nextStage } from "@/lib/loan-stages";
import type { CondoFile, Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const DAY = "2026-10-31";
const building = (change: Partial<CondoFile> = {}): CondoFile => ({ association: "Sample Towers (FAKE)", stories: 12, units: 80, coYear: 2000, at25: false, reservesPaused: false, associationLoan: false, websitePosted: true, sirsOn: "2025-06-01", by: "x", at: "2026-10-30T12:00:00Z", ...change });

describe("the condo building check (rank 12, Fla. Stat. 553.899, 718.112)", () => {
  const rental = demoBook().deals.find((deal) => deal.app.product === "dscr")!;
  const condo: Deal = { ...rental, app: { ...rental.app, propertyType: "condo", hoaMonthly: 450 } };
  it("dates the milestone inspection: the year it turns 30 (or 25), the 2024 catch-up, then every 10 years", () => {
    expect(milestoneDue(building({ coYear: 2000 }), DAY)).toBe("2030-12-31");
    expect(milestoneDue(building({ coYear: 1985 }), DAY)).toBe("2024-12-31");
    expect(milestoneDue(building({ coYear: 1985 }), "2035-03-01")).toBe("2034-12-31");
    expect(milestoneDue(building({ coYear: 1996 }), DAY)).toBe("2026-12-31");
    expect(milestoneDue(building({ coYear: 2000, at25: true }), DAY)).toBe("2025-12-31");
    expect(milestoneDue(building({ stories: 2 }), DAY)).toBeNull();
  });
  it("calls a building overdue, repairs pending or current", () => {
    expect(condoCheck({ ...condo, condo: building({ coYear: 1985 }) }, DAY)).toMatchObject({ state: "overdue", flags: [{ level: "bad", text: "Its milestone inspection was due by December 31, 2024 and isn't on file." }] });
    const inspected = building({ coYear: 1985, milestone: { phase1On: "2024-08-01" } });
    expect(condoCheck({ ...condo, condo: inspected }, DAY)).toMatchObject({ state: "current", flags: [{ level: "note", text: expect.stringMatching(/next is due by December 31, 2034/) }] });
    const phase2 = building({ coYear: 1985, milestone: { phase1On: "2024-08-01", phase2On: "2026-03-01" } });
    expect(condoCheck({ ...condo, condo: phase2 }, DAY).state).toBe("repairs_pending");
    expect(condoCheck({ ...condo, condo: phase2 }, "2027-04-01").state).toBe("overdue");
    expect(condoCheck({ ...condo, condo: { ...phase2, milestone: { ...phase2.milestone, repairsDone: true } } }, "2027-04-01").state).toBe("current");
    expect(condoCheck({ ...condo, condo: building({ sirsOn: undefined }) }, DAY)).toMatchObject({ state: "overdue", flags: [expect.objectContaining({ text: expect.stringMatching(/reserve study/) }), expect.anything()] });
    expect(condoCheck({ ...condo, condo: building({ reservesPaused: true }) }, DAY).state).toBe("repairs_pending");
    expect(condoCheck({ ...condo, condo: building({ stories: 2 }) }, DAY).flags).toEqual([{ level: "note", text: "Under 3 stories: no milestone inspection or reserve study is required." }]);
  });
  it("shows what an assessment does to the rent coverage, and an association that doesn't post its records", () => {
    const flags = condoCheck({ ...condo, condo: building({ assessment: { monthly: 300 }, websitePosted: false }) }, DAY).flags.map((flag) => flag.text);
    const withAssessment = evaluate({ ...condo.app, hoaMonthly: 750 }).ratios.find((ratio) => ratio.key === "dscr")!.actual;
    expect(flags).toEqual(expect.arrayContaining([`A special assessment of $300 a month: with it, the rent covers the payment ${withAssessment.toFixed(2)} times.`, "An association of 25 or more units has to post its records on a website; this one doesn't."]));
  });
  it("a condo loan clears to close only once the building is recorded", () => {
    const atConditions: Deal = { ...condo, status: "conditions" };
    expect(nextStage(atConditions, evaluate(atConditions.app))?.blockers).toContain("Record the condo building check (Score & Flags)");
    expect(nextStage({ ...atConditions, condo: building() }, evaluate(atConditions.app))?.blockers).not.toContain("Record the condo building check (Score & Flags)");
    expect(nextStage({ ...atConditions, app: rental.app }, evaluate(rental.app))?.blockers).not.toContain("Record the condo building check (Score & Flags)");
  });
  it("staff who underwrite record it, only on a condo, with sane numbers", () => {
    const b = demoBook();
    const book: Book = { ...b, deals: b.deals.map((deal) => (deal.id === rental.id ? condo : deal)) };
    const input: CondoInput = { association: "Sample Towers (FAKE)", stories: 12, units: 80, coYear: 2000, at25: false, reservesPaused: false, associationLoan: false, websitePosted: true };
    const save: BookAction = { t: "saveCondo", dealId: rental.id, condo: input, by: "x" };
    expect(check(book, person("borrower", ["BORROWER"]), save)).toEqual({ error: "Your account can't do that." });
    expect(check(b, person("uma", ["UNDERWRITER"]), save)).toEqual({ error: "This loan isn't on a condo." });
    expect(check(book, person("uma", ["UNDERWRITER"]), { ...save, condo: { ...input, coYear: 2030 } })).toEqual({ error: "Enter the year of the certificate of occupancy." });
    expect(check(book, person("uma", ["UNDERWRITER"]), { ...save, condo: { ...input, milestone: { phase2On: "2026-01-01" } } })).toEqual({ error: "A phase 2 follows a phase 1: add its date." });
    const result = check(book, person("uma", ["UNDERWRITER"]), save);
    if ("error" in result) throw new Error(result.error);
    expect(reducer(book, result.action).deals.find((deal) => deal.id === rental.id)!.condo).toMatchObject({ association: "Sample Towers (FAKE)", by: "uma name" });
  });
});
