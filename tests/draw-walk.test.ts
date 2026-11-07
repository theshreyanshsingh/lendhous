import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { awaitingDecision, CLAIM_GAP, claimedFrom, claimGap, decideBy, decideByText, drawableLines, lastPhotos, lineProblem } from "@/lib/draw-walk";
import { can, type Permission } from "@/lib/permissions";
import { photosSummary } from "@/lib/photo-checks";
import { dueAt, floridaTime, SLA_TARGETS } from "@/lib/sla";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
// The demo borrower, whose funded flip is d2.
const alex = person("b-alex", ["BORROWER"]);

describe("a draw, line by line from the borrower's phone", () => {
  it("walks only the lines with money left, outside contingency", () => {
    const b = demoBook();
    const d2 = b.deals.find((d) => d.id === "d2")!;
    expect(drawableLines(d2).every((line) => line.budget > line.released && line.id !== "contingency")).toBe(true);
    expect(drawableLines({ scope: [{ id: "contingency", division: "Contingency", budget: 5000, released: 0 }, { id: "done", division: "Done", budget: 100, released: 100 }] })).toEqual([]);
  });
  it("needs an amount, how far along it is, and a photo for each line", () => {
    expect(lineProblem({ requested: 0 }, 1)).toMatch(/Enter the amount/);
    expect(lineProblem({ requested: 3000 }, 1)).toMatch(/how far along/);
    expect(lineProblem({ requested: 3000, claimedPct: 1.2 }, 1)).toMatch(/0 to 100/);
    expect(lineProblem({ requested: 3000, claimedPct: 0.6 }, 0)).toMatch(/at least one photo/);
    expect(lineProblem({ requested: 3000, claimedPct: 0.6 }, 2)).toBeNull();
    expect([claimedFrom(""), claimedFrom("60"), claimedFrom("abc"), claimedFrom("100")]).toEqual([undefined, 0.6, undefined, 1]);
  });
  it("shows last draw's photo of the same line beside the new one", () => {
    const b = demoBook();
    expect(lastPhotos(b.draws, "d2", "kitchen")).toMatchObject({ on: "2026-10-20T09:15:00-07:00", photos: [{ name: "kitchen-cabinets.jpg" }] });
    expect(lastPhotos(b.draws, "d2", "plumbing")).toBeNull();
    expect(lastPhotos(b.draws, "d2", "kitchen", "2026-10-01T00:00:00Z")).toBeNull();
  });
  it("keeps each photo's place and time, and what the borrower says, for the team", () => {
    const b = demoBook();
    const action: BookAction = { t: "requestDraw", dealId: "d2", by: "x", note: "Rough plumbing done", contact: "Alex, 555", photos: ["pipes.jpg"], photoIds: ["doc-1"], lines: [{ scopeId: "plumbing", requested: 3000, claimedPct: 0.75 }, { scopeId: "electrical", requested: 0 }], linePhotos: [{ scopeId: "plumbing", name: "pipes.jpg", takenAt: "2026-10-31T14:00:00Z", lat: 26.12241, lng: -80.13741, documentId: "doc-1" }, { scopeId: "electrical", name: "stray.jpg" }] };
    const result = check(b, alex, action);
    expect(result).not.toHaveProperty("error");
    const after = reducer(b, (result as { action: BookAction }).action);
    const draw = after.draws[0];
    expect(draw.lines).toEqual([{ scopeId: "plumbing", requested: 3000, claimedPct: 0.75 }]);
    // Only the photos of lines asked for are kept, each stamped with when it arrived.
    expect(draw.linePhotos).toHaveLength(1);
    expect(draw.linePhotos![0]).toMatchObject({ scopeId: "plumbing", documentId: "doc-1", lat: 26.12241 });
    expect(draw.linePhotos![0].at).toBe(draw.requestedAt);
    expect(photosSummary(draw.linePhotos!, b.deals.find((d) => d.id === "d2")!.geo)?.text).toMatch(/^1 taken at the property/);
    // A photo that wasn't uploaded with the draw can't be pointed at.
    expect(check(b, alex, { ...action, photoIds: [] } as BookAction)).toEqual({ error: "A photo on this draw wasn't uploaded with it. Try again." });
  });
  it("flags a borrower who says the work is well ahead of what the inspector found", () => {
    expect(claimGap({ claimedPct: 0.9, observedPct: 0.6 })).toBe(true);
    expect(claimGap({ claimedPct: 0.6 + CLAIM_GAP, observedPct: 0.6 })).toBe(false);
    expect(claimGap({ observedPct: 0.6 })).toBe(false);
  });
});

describe("when the borrower hears back", () => {
  it("is the draw target from Settings, in plain hours or Florida business hours", () => {
    // 24 plain hours, by default.
    expect(decideBy({ requestedAt: "2026-11-05T15:00:00Z" }, SLA_TARGETS.drawDecision).toISOString()).toBe("2026-11-06T15:00:00.000Z");
    // Eight business hours from Friday 3 p.m. Eastern: two hours on Friday, six on Monday, so 3 p.m. Monday.
    expect(dueAt("2026-11-06T20:00:00Z", { label: "", hours: 8, business: true }).toISOString()).toBe("2026-11-09T20:00:00.000Z");
    // Veterans Day (November 11) is a Florida holiday, so it's skipped.
    expect(dueAt("2026-11-10T21:00:00Z", { label: "", hours: 2, business: true }).toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(floridaTime(new Date("2026-11-09T20:00:00Z"))).toBe("Monday, November 9 at 3:00 PM");
  });
  it("says when, or that someone will be in touch once it's late", () => {
    const draw = { requestedAt: "2026-11-05T15:00:00Z" };
    expect(decideByText(draw, SLA_TARGETS.drawDecision, new Date("2026-11-05T16:00:00Z"))).toBe("We'll decide by Friday, November 6 at 10:00 AM.");
    expect(decideByText(draw, SLA_TARGETS.drawDecision, new Date("2026-11-07T16:00:00Z"))).toMatch(/taking longer than we aim for/);
    expect([awaitingDecision({ status: "submitted" }), awaitingDecision({ status: "inspected" }), awaitingDecision({ status: "funded" })]).toEqual([true, true, false]);
  });
});
