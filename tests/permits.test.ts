import { afterEach, describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { drawHolds } from "@/lib/lien-law";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { lineState, permitHolds, permitsFor, setPermitHolds } from "@/lib/permits";
import { rulesFrom } from "@/lib/settings-rules";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const b = demoBook();
const today = serviceDay(b);
const flip = b.deals.find((deal) => deal.id === "d2")!;
const draw = (lines: [string, number][]): Pick<DrawRequest, "lines"> => ({ lines: lines.map(([scopeId, requested]) => ({ scopeId, requested })) });
const permit = (change: Partial<NonNullable<Deal["permits"]>[number]> = {}): NonNullable<Deal["permits"]>[number] => ({ id: "p1", number: "BLD-1 (FAKE)", jurisdiction: "City of Sample", scopeIds: ["exterior"], status: "issued", issuedOn: "2026-08-01", by: "x", at: "x", ...change });

afterEach(() => setPermitHolds(false));

describe("permits by budget line (rank 18)", () => {
  it("flags the lines that usually take a permit", () => {
    const names = (division: string) => permitsFor({ id: "x", division });
    expect(names("Roof and exterior")).toEqual(["a roofing permit"]);
    expect(names("Mechanical, electrical and plumbing")).toEqual(["an electrical permit", "a plumbing permit", "a mechanical (HVAC) permit"]);
    expect(names("Structural and framing")).toEqual(["a building permit"]);
    expect(names("Impact windows and doors")).toEqual(["a window and door permit"]);
    expect(names("Kitchen")).toEqual([]);
    expect(names("Flooring and paint")).toEqual([]);
  });

  it("holds a line's draw until its permit is issued, and the last draw until every permit is finaled", () => {
    setPermitHolds(true);
    const roof = draw([["exterior", 10_000], ["kitchen", 5_000]]);
    expect(permitHolds(flip, roof, false, today)).toEqual(["Roof and exterior needs a roofing permit before its draw, and none is on file."]);
    expect(permitHolds(flip, draw([["kitchen", 5_000]]), false, today)).toEqual([]);
    expect(permitHolds({ ...flip, permits: [permit({ status: "applied", issuedOn: undefined })] }, roof, false, today)).toEqual(["Roof and exterior needs a roofing permit before its draw, and it's only applied for."]);
    expect(permitHolds({ ...flip, permits: [permit()] }, roof, false, today)).toEqual([]);
    expect(permitHolds({ ...flip, permits: [permit({ expiresOn: "2026-10-01" })] }, roof, false, today)).toEqual(["The permit for Roof and exterior has lapsed; it's renewed before its draw."]);
    expect(permitHolds({ ...flip, permits: [permit()] }, draw([["kitchen", 5_000]]), true, today)).toEqual(["Permit BLD-1 (FAKE) isn't finaled yet: the building department closes it before the last draw."]);
    expect(permitHolds({ ...flip, permits: [permit({ status: "finaled", finaledOn: "2026-10-20" })] }, roof, true, today)).toEqual([]);
    expect(permitHolds({ ...flip, permitWaivers: [{ scopeId: "exterior", reason: "Gutters only", by: "x", at: "x" }] }, roof, false, today)).toEqual([]);
    expect(lineState({ ...flip, permitWaivers: [{ scopeId: "exterior", reason: "Gutters only", by: "x", at: "x" }] }, "exterior", today)).toBe("not_needed");
    setPermitHolds(false);
    expect(permitHolds(flip, roof, false, today)).toEqual([]);
  });

  it("puts the permit hold with the draw's other holds, and an owner's setting turns it off", () => {
    setPermitHolds(true);
    const d9 = b.deals.find((deal) => deal.id === "d9")!;
    const asked = b.draws.find((item) => item.dealId === "d9")!;
    expect(drawHolds(d9, asked, today).some((hold) => hold.includes("permit"))).toBe(false);
    expect(drawHolds({ ...d9, permits: [] }, asked, today)).toEqual(expect.arrayContaining([expect.stringMatching(/^Plumbing needs a plumbing permit/), expect.stringMatching(/^Electrical needs an electrical permit/)]));
    const base = { nfipAuthorizedThrough: "2026-12-11", drawFeeInspectionCents: 0, drawFeeDeskCents: 0 };
    expect(rulesFrom({ ...base, permitHoldDraws: null }).permits).toBe(true);
    expect(rulesFrom({ ...base, permitHoldDraws: false }).permits).toBe(false);
  });

  it("lets the team record a permit or mark a line as needing none", () => {
    const staff = person("u-proc", ["PROCESSOR"]);
    const save: BookAction = { t: "savePermit", dealId: flip.id, permit: { number: "BLD-9 (FAKE)", jurisdiction: "City of Sample", scopeIds: ["exterior", "structural"], status: "issued", issuedOn: "2026-09-01" }, by: "" };
    expect(check(b, staff, save)).toHaveProperty("action");
    expect(check(b, staff, { ...save, permit: { ...save.permit, scopeIds: ["pool"] } } as BookAction)).toEqual({ error: "That budget line isn't on this loan." });
    expect(check(b, staff, { ...save, permit: { ...save.permit, status: "finaled" } } as BookAction)).toEqual({ error: "Add the day the final inspection passed." });
    expect(check(b, person(flip.borrowerId, ["BORROWER"]), save)).toHaveProperty("error");
    let next = reducer(b, { ...save, by: "Pat" });
    const saved = next.deals.find((deal) => deal.id === flip.id)!.permits![0];
    expect(saved).toMatchObject({ number: "BLD-9 (FAKE)", scopeIds: ["exterior", "structural"], by: "Pat" });
    next = reducer(next, { t: "savePermit", dealId: flip.id, permit: { id: saved.id, number: "BLD-9 (FAKE)", jurisdiction: "City of Sample", scopeIds: ["exterior"], status: "finaled", issuedOn: "2026-09-01", finaledOn: "2026-10-30" }, by: "Pat" });
    expect(next.deals.find((deal) => deal.id === flip.id)!.permits).toEqual([expect.objectContaining({ id: saved.id, status: "finaled" })]);
    next = reducer(next, { t: "permitNotNeeded", dealId: flip.id, scopeId: "demolition", reason: "Interior strip-out only", by: "Pat" });
    expect(next.deals.find((deal) => deal.id === flip.id)!.permitWaivers).toEqual([expect.objectContaining({ scopeId: "demolition", reason: "Interior strip-out only" })]);
    next = reducer(next, { t: "permitNotNeeded", dealId: flip.id, scopeId: "demolition", reason: "", by: "Pat" });
    expect(next.deals.find((deal) => deal.id === flip.id)!.permitWaivers).toEqual([]);
  });
});
