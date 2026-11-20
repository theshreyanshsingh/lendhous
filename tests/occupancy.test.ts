import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import type { Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { leaseNotes, leaseReviewApplies, occupancyProblem, SHERIFF_CONDITIONS, sheriffProblem, type OccupancyInput, type SheriffCondition } from "@/lib/occupancy";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const b = demoBook();
const today = serviceDay(b);
const rental = b.deals.find((deal) => deal.id === "d10")!;
const all = Object.keys(SHERIFF_CONDITIONS) as SheriffCondition[];
const stamp = { by: "x", at: "2026-10-30T12:00:00Z" };

describe("leases, tenants and who's living in a property LendHous owns (rank 26)", () => {
  it("reviews a rental's leases and tenants and says what to act on", () => {
    expect(leaseReviewApplies(rental)).toBe(true);
    expect(leaseReviewApplies({ app: { ...rental.app, rentalType: "short_term" } })).toBe(false);
    expect(leaseNotes(rental)).toEqual([{ tone: "note", text: "The leases and tenants haven't been reviewed yet." }]);
    const reviewed = (change: Partial<NonNullable<Deal["leaseReview"]>>) => ({ ...rental, leaseReview: { flags: [], emailAddendum: "yes" as const, floodDisclosure: "yes" as const, note: "", ...stamp, ...change } });
    expect(leaseNotes(reviewed({}))).toEqual([]);
    const notes = leaseNotes(reviewed({ flags: ["cash_rent", "documents_edited"], floodDisclosure: "no", emailAddendum: "no", note: "Paystubs don't match the employer's format." }));
    expect(notes.map((note) => note.tone)).toEqual(["bad", "warn", "note"]);
    expect(notes[0].text).toMatch(/^2 red flags: rent is paid in cash.*7 days' notice \(ch\. 2026-143\)\.$/);
    expect(notes[1].text).toMatch(/83\.512/);
    const edited = { ...reviewed({}), fileChecks: [{ documentId: "doc1", fileName: "lease-unit-a.pdf", label: "Current leases", at: "x", software: ["Sample Editor"], saves: 3, flags: [{ level: "warn" as const, text: "Edited after it was made" }] }] };
    expect(leaseNotes(edited)).toEqual([expect.objectContaining({ tone: "bad", text: expect.stringMatching(/^lease-unit-a\.pdf shows signs of editing/) })]);
  });

  it("keeps the review to the team, and asks for a note with any red flag", () => {
    const save: BookAction = { t: "saveLeaseReview", dealId: rental.id, review: { flags: ["new_lease"], emailAddendum: "no", floodDisclosure: "yes", note: "" }, by: "" };
    expect(check(b, person("u-proc", ["PROCESSOR"]), save)).toEqual({ error: "Say what you found, so the underwriter can clear or keep each flag." });
    const ok = { ...save, review: { ...save.review, note: "Signed nine days before the application." } } as BookAction;
    expect(check(b, person("u-proc", ["PROCESSOR"]), ok)).toHaveProperty("action");
    expect(check(b, person(rental.borrowerId, ["BORROWER"]), ok)).toHaveProperty("error");
    const next = reducer(b, { ...ok, by: "Pat" } as BookAction);
    expect(next.deals.find((deal) => deal.id === rental.id)!.leaseReview).toMatchObject({ flags: ["new_lease"], by: "Pat" });
    expect(scopeBook(next, person(rental.borrowerId, ["BORROWER"])).deals.find((deal) => deal.id === rental.id)?.leaseReview).toBeUndefined();
  });

  it("asks the sheriff only for people with no right to be there, once every condition of 82.036 is confirmed", () => {
    expect(sheriffProblem({ state: "tenant", confirmed: all })).toMatch(/only for people with no right/);
    expect(sheriffProblem({ state: "squatter", confirmed: all.slice(1) })).toBe("Confirm every condition first: 1 isn't confirmed.");
    expect(sheriffProblem({ state: "squatter", confirmed: all })).toBeNull();
    const owned: Deal = { ...rental, status: "reo", reo: { since: "2026-09-01", how: "certificate_of_title", owed: { principal: 1, interest: 0, fees: 0, advances: 0 }, ...stamp } };
    const input = (change: Partial<OccupancyInput> = {}): OccupancyInput => ({ checkedOn: "2026-10-20", state: "squatter", note: "", confirmed: all, ...change });
    expect(occupancyProblem(rental, input(), today)).toMatch(/Only a property LendHous owns/);
    expect(occupancyProblem(owned, input(), today)).toBeNull();
    expect(occupancyProblem(owned, input({ confirmed: ["owner"], sheriff: { filedOn: "2026-10-21", county: "Broward" } }), today)).toMatch(/Confirm every condition/);
    expect(occupancyProblem(owned, input({ sheriff: { filedOn: "2026-10-21", county: "Broward", outcome: "removed", outcomeOn: "2026-10-20" } }), today)).toMatch(/after the filing/);
    const book = { ...b, deals: b.deals.map((deal) => (deal.id === rental.id ? owned : deal)) };
    const next = reducer(book, { t: "saveOccupancy", dealId: rental.id, occupancy: input({ sheriff: { filedOn: "2026-10-21", county: "Broward", outcome: "removed", outcomeOn: "2026-10-23" } }), by: "Sam" });
    expect(next.deals.find((deal) => deal.id === rental.id)!.reo!.occupancy).toMatchObject({ state: "squatter", sheriff: { outcome: "removed" }, by: "Sam" });
    expect(check(book, person("u-svc", ["SERVICER"]), { t: "saveOccupancy", dealId: rental.id, occupancy: input(), by: "" })).toHaveProperty("action");
    expect(check(book, person("u-proc", ["PROCESSOR"]), { t: "saveOccupancy", dealId: rental.id, occupancy: input(), by: "" })).toHaveProperty("error");
  });
});
