import { afterEach, describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { geocode } from "@/lib/geocode";
import { holdingsOf, setInvestorFees, splitOf } from "@/lib/investor-statements";
import { DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { metersBetween, photoCheck, photosSummary, PHOTO_LIMITS } from "@/lib/photo-checks";
import { addressKey, concentration, concentrationWarnings, CONCENTRATION_LIMITS, duplicateMatches, priceJump } from "@/lib/risk";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};
const processor = person("pat", ["PROCESSOR"]);
const system = person("system", []);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;

describe("duplicates", () => {
  it("match the same property, company or person, however it's written", () => {
    expect(addressKey("123 Main St.", "33020")).toBe(addressKey("123 MAIN STREET", "33020-1234"));
    const b = demoBook();
    const copy: Deal = { ...deal(b, "d16"), id: "dup", loanNumber: "LH-DUP", borrowerId: "someone-new", borrowerName: "Somebody Else", address: deal(b, "d16").address.toUpperCase(), entityName: "Other Holdings LLC" };
    const matches = duplicateMatches([...b.deals, copy], deal(b, "d16"));
    expect(matches).toMatchObject([{ dealId: "dup", why: ["the same property"] }]);
    // The same guarantor on another account is a flag; the same borrower's other property isn't.
    const alias: Deal = { ...copy, address: "1 Other Way", zip: "33000", borrowerName: deal(b, "d16").borrowerName };
    expect(duplicateMatches([...b.deals, alias], deal(b, "d16"))[0].why[0]).toMatch(/the same person under another account/);
    expect(duplicateMatches(b.deals, deal(b, "d1"))).toEqual([]);
  });
});

describe("a price jump", () => {
  it("flags a purchase well above a recent sale", () => {
    const b = demoBook();
    expect(priceJump(deal(b, "d16"), "2026-10-31")).toMatchObject({ flagged: true });
    expect(priceJump({ ...deal(b, "d16"), lastSale: { ...deal(b, "d16").lastSale!, on: "2024-01-01" } }, "2026-10-31")?.flagged).toBe(false);
    expect(priceJump(deal(b, "d1"), "2026-10-31")).toBeNull();
    expect(check(b, person("alex", ["BORROWER"]), { t: "saveLastSale", dealId: "d1", price: 1, on: "2026-01-01", by: "x" })).toHaveProperty("error");
    expect(deal(run(b, processor, { t: "saveLastSale", dealId: "d1", price: 250_000, on: "2026-05-01", by: "x" }), "d1").lastSale).toMatchObject({ price: 250_000, by: "pat name" });
    expect(deal(scopeBook(b, person("b-harper", ["BORROWER"])), "d16").lastSale).toBeUndefined();
  });
});

describe("concentration", () => {
  it("adds up the funded book by borrower, county, loan type and flood zone", () => {
    const b = demoBook();
    const county = concentration(b.deals, "county");
    expect(county.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 6);
    expect(county[0].amount).toBeGreaterThanOrEqual(county[county.length - 1].amount);
    expect(concentration(b.deals, "floodZone").some((row) => row.name === "Special flood hazard area")).toBe(true);
  });
  it("warns before a term sheet that would take one past its limit", () => {
    const b = demoBook();
    const big: Deal = { ...deal(b, "d1"), app: { ...deal(b, "d1").app, purchasePrice: 9_000_000, rehab: 0, arv: 9_000_000, requestedAmount: 3_000_000 } };
    const warnings = concentrationWarnings(b.deals, big);
    expect(warnings.some((item) => item.startsWith("Borrower"))).toBe(true);
    expect(CONCENTRATION_LIMITS.borrower).toBe(0.15);
    expect(concentrationWarnings([deal(b, "d2")], deal(b, "d1"))).toEqual([]);
  });
});

describe("photos checked against the property", () => {
  it("measures the distance and the age, and flags without blocking", () => {
    expect(metersBetween({ lat: 26.1224, lng: -80.1374 }, { lat: 26.1224, lng: -80.1374 })).toBe(0);
    expect(metersBetween({ lat: 26.1224, lng: -80.1374 }, { lat: 26.1314, lng: -80.1374 })).toBeCloseTo(1000, -1);
    const geo = { lat: 26.1224, lng: -80.1374, at: "x" };
    expect(photoCheck({ lat: 26.12251, lng: -80.13742, at: "2026-10-20T22:31:00Z" }, geo)).toMatchObject({ far: false, old: false, located: true });
    expect(photoCheck({ lat: 26.14102, lng: -80.15311, at: "2026-10-20T22:35:00Z", takenAt: "2026-10-16T16:00:00Z" }, geo)).toMatchObject({ far: true, old: true });
    expect(photoCheck({ at: "x" }, geo)).toMatchObject({ located: false, far: false });
    const b = demoBook();
    const summary = photosSummary(b.photoRequests.find((item) => item.id === "photos-1")!.photos, deal(b, "d2").geo);
    expect(summary).toMatchObject({ flagged: true });
    expect(summary!.text).toMatch(/2 taken at the property · 1 taken 2\.\d km or so away · 1 taken more than 48 hours before it was sent · 1 without the phone's location/);
    expect(photosSummary(b.photoRequests.find((item) => item.id === "photos-1")!.photos, undefined)!.text).toMatch(/isn't on the map yet/);
    expect(PHOTO_LIMITS).toEqual({ meters: 200, hours: 48 });
  });
  it("places the property with the Census geocoder, and gives up quietly", async () => {
    const reply = { ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: { x: -80.137412, y: 26.122398 } }] } }) };
    expect(await geocode({ address: "456 Placeholder Ave", city: "Fort Lauderdale", zip: "33311" }, (async () => reply) as unknown as typeof fetch)).toEqual({ lat: 26.122398, lng: -80.137412 });
    expect(await geocode({ address: "x", city: "y", zip: "1" }, (async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) })) as unknown as typeof fetch)).toBeNull();
    expect(await geocode({ address: "x", city: "y", zip: "1" }, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(check(demoBook(), processor, { t: "placeProperty", dealId: "d2", lat: 1, lng: 1 })).toHaveProperty("error");
  });
});

describe("an inspector's link", () => {
  const ordered = () => {
    const b = demoBook();
    const draws = b.draws.map((draw) => (draw.id === "draw-1" ? { ...draw, status: "inspecting" as const } : draw));
    return { ...b, draws };
  };
  it("is only for a draw with an inspection ordered, sent by the team", () => {
    const b = demoBook();
    const ask: BookAction = { t: "askForPhotos", requestId: "insp-1", dealId: "d2", drawId: "draw-1", to: "Ina Inspector", who: "inspector", scopeIds: ["kitchen"], by: "x", byTeam: true, expiresAt: "2030-01-01T00:00:00Z" };
    expect(check(b, system, ask, true)).toEqual({ error: "An inspector's link is for a draw with an inspection ordered." });
    expect(check(ordered(), system, { ...ask, byTeam: false }, true)).toHaveProperty("error");
    expect(check(ordered(), system, ask, true)).not.toHaveProperty("error");
  });
  it("records the inspection with the inspector's percentages", () => {
    const b = run(ordered(), system, { t: "askForPhotos", requestId: "insp-1", dealId: "d2", drawId: "draw-1", to: "Ina Inspector", who: "inspector", scopeIds: ["kitchen", "flooring"], by: "x", byTeam: true, expiresAt: "2030-01-01T00:00:00Z" }, true);
    const withPhoto = run(b, system, { t: "addRequestPhoto", requestId: "insp-1", photo: { id: "p1", scopeId: "kitchen", shot: "room", name: "k.jpg", at: "2026-10-31T15:00:00Z" } }, true);
    const done = run(withPhoto, system, { t: "finishPhotoRequest", requestId: "insp-1", by: "Ina Inspector", note: "Cabinets set, counters next week", observed: { kitchen: 0.6, flooring: 0.9 } }, true);
    const draw = done.draws.find((item) => item.id === "draw-1")!;
    expect(draw.status).toBe("inspected");
    expect(draw.lines.find((line) => line.scopeId === "kitchen")?.observedPct).toBe(0.6);
    expect(draw.inspection).toMatchObject({ by: "Ina Inspector", requestId: "insp-1", notes: "Cabinets set, counters next week" });
    // A contractor's link can't record one.
    const contractor = run(ordered(), system, { t: "finishPhotoRequest", requestId: "photos-1", by: "Mo", note: "", observed: { kitchen: 1 } }, true);
    expect(contractor.draws.find((item) => item.id === "draw-1")!.status).toBe("inspecting");
  });
});

describe("the late-fee split", () => {
  afterEach(() => setInvestorFees({ lateFees: false }));
  it("keeps late fees with LendHous unless Settings passes them to investors", () => {
    const b = demoBook();
    const holding = holdingsOf(b, { type: "partner", id: DEMO_PARTNER_ID })[0];
    // A late fee paid on the partner's loan.
    const late = { ...holding, deal: { ...holding.deal, payments: [...(holding.deal.payments ?? []), { id: "fee", amount: 300, receivedOn: "2026-10-20", method: "ach" as const, reference: "late fee", by: "x", at: "y" }] } };
    const kept = splitOf(late, () => true);
    setInvestorFees({ lateFees: true });
    const passed = splitOf(late, () => true);
    expect(passed.net - kept.net).toBeCloseTo(passed.lateFees, 2);
  });
});
