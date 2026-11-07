import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { approvalError } from "@/lib/draws";
import { evaluate } from "@/lib/engine";
import { floodAt } from "@/lib/fema";
import { FLOOD_CONDITION, FLOOD_PREMIUM_ESTIMATE, floodDisagrees, floodLayerId, floodMapWords, floodQuery, isSfhaZone, parseFloodAnswer } from "@/lib/flood-zones";
import { firstKml } from "@/lib/kmz";
import { drawHolds } from "@/lib/lien-law";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { requestSteps, STORM_STEP } from "@/lib/photo-requests";
import { activeWatches, DEMO_STORM, exposure, exposureLines, freshInspectionNeeded, insideCone, loansInCone, parseActiveStorms, parseCone } from "@/lib/storms";

const fixture = (path: string) => readFileSync(`tests/fixtures/${path}`);
const json = (path: string) => JSON.parse(fixture(path).toString("utf8"));
const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const system = person("system", []);
const owner = person("owner", ["ADMIN_OWNER"]);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const cone = (file: string) => parseCone(firstKml(fixture(`nhc/${file}`))!);

describe("NHC's active storms", () => {
  it("reads the recorded file, leaving out storms that can't reach Florida", () => {
    // The file as NHC served it on 2026-11-07: one central Pacific storm, nowhere near Florida.
    expect(parseActiveStorms(json("nhc/CurrentStorms-2026-11-07.json"))).toEqual([]);
    const [storm] = parseActiveStorms(json("nhc/TEST_ATLANTIC_STORM.json"));
    expect(storm).toMatchObject({ id: "al992026", name: "Testcase", label: "Hurricane Testcase", advisory: "012", coneUrl: "https://www.nhc.noaa.gov/storm_graphics/api/AL992026_012adv_CONE.kmz" });
    // A cone link anywhere but NHC isn't followed.
    const odd = json("nhc/TEST_ATLANTIC_STORM.json");
    odd.activeStorms[0].trackCone.kmzFile = "https://example.org/cone.kmz";
    expect(parseActiveStorms(odd)[0].coneUrl).toBeUndefined();
    expect(parseActiveStorms(null)).toEqual([]);
  });
  it("reads a cone out of NHC's KMZ and tests points against it", () => {
    // Irma's cone at advisory 20 (NHC's GIS example) runs from the Leeward Islands to the Florida Straits.
    const irma = cone("AL112017_020adv_CONE.kmz");
    expect(irma).toHaveLength(1);
    expect(irma[0].outer.length).toBeGreaterThan(1000);
    expect(insideCone({ lat: 21.8, lng: -71.8 }, irma)).toBe(true);
    expect(insideCone({ lat: 26.12, lng: -80.14 }, irma)).toBe(false);
    // Pena, recorded live, is in the central Pacific.
    const pena = cone("CP042026_004adv_CONE.kmz");
    expect(insideCone({ lat: 12, lng: -165 }, pena)).toBe(true);
    expect(insideCone({ lat: 25.77, lng: -80.19 }, pena)).toBe(false);
    expect(firstKml(Buffer.from("not a zip"))).toBeNull();
    // A hole in a polygon is outside it.
    const holed = parseCone("<Polygon><outerBoundaryIs><LinearRing><coordinates>0,0,0 10,0,0 10,10,0 0,10,0 0,0,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>4,4,0 6,4,0 6,6,0 4,6,0 4,4,0</coordinates></LinearRing></innerBoundaryIs></Polygon>");
    expect([insideCone({ lat: 2, lng: 2 }, holed), insideCone({ lat: 5, lng: 5 }, holed)]).toEqual([true, false]);
  });
  it("finds the funded loans inside a cone", () => {
    const b = demoBook();
    expect(loansInCone(b.deals, cone("TEST_SOUTH_FLORIDA_CONE.kmz")).sort()).toEqual(["d11", "d13", "d17", "d2", "d9"]);
    expect(loansInCone(b.deals, DEMO_STORM.cone).sort()).toEqual(["d11", "d13", "d17", "d2", "d9"]);
    // Delray Beach and Coral Springs are north of it, and an application in the cone isn't funded yet.
    expect(loansInCone(b.deals, DEMO_STORM.cone)).not.toContain("d12");
    expect(loansInCone(b.deals, DEMO_STORM.cone)).not.toContain("d1");
  });
});

describe("storm mode", () => {
  type Check = Extract<BookAction, { t: "recordStormCheck" }>;
  const sample = (dealIds: string[], advisory = "12"): Check => ({ t: "recordStormCheck", at: "2026-10-30T12:00:00Z", storms: [{ id: "al992026", name: "Testcase", label: "Hurricane Testcase", advisory, dealIds }] });
  it("is something only the server records", () => {
    const b = demoBook();
    expect(check(b, owner, sample(["d2"]))).toHaveProperty("error");
    expect(check(b, system, sample(["d2"]), true)).not.toHaveProperty("error");
    expect(check(b, system, sample(["gone"]), true)).toHaveProperty("error");
    expect(scopeBook(reducer(b, sample(["d2"])), person("b-alex", ["BORROWER"])).storms).toEqual([]);
  });
  it("tells the owners which loans the cone covers, with what's at stake", () => {
    const b = demoBook();
    const action = sample(["d2", "d9"]);
    const after = reducer(b, action);
    expect(activeWatches(after.storms)).toMatchObject([{ id: "al992026", nowIn: ["d2", "d9"], status: "active" }]);
    const [alert] = alertsFor(b, after, action);
    expect(alert).toMatchObject({ to: "team", event: "storm.watch", subject: "Storm watch: Hurricane Testcase's cone covers 2 LendHous loans" });
    expect(alert.body).toMatch(/LH-DEMO-1002, Fort Lauderdale: \$[\d,]+ out, \$[\d,]+ left to draw, insurance to .+, wind (covered|NOT covered)\./);
    // The next advisory adds a loan: only that one is news.
    const next = sample(["d2", "d9", "d11"], "13");
    const later = reducer(after, next);
    expect(alertsFor(after, later, next)).toMatchObject([{ subject: "Storm watch: Hurricane Testcase now covers 1 LendHous loan more" }]);
    // A check where the cone moved off keeps the storm, and the loans it covered, but takes the banner down.
    const off = sample([], "14");
    const moved = reducer(later, off);
    expect(activeWatches(moved.storms)).toEqual([]);
    expect(moved.storms[0].dealIds).toEqual(["d2", "d9", "d11"]);
  });
  it("once a storm has passed, asks for photos and holds draws for a fresh inspection", () => {
    const b = reducer(demoBook(), sample(["d2"]));
    const gone: BookAction = { t: "recordStormCheck", at: "2026-10-31T12:00:00Z", storms: [] };
    const passed = reducer(b, gone);
    expect(passed.storms[0]).toMatchObject({ status: "passed", passedAt: "2026-10-31T12:00:00Z" });
    expect(deal(passed, "d2").stormHold).toEqual({ stormId: "al992026", name: "Hurricane Testcase", passedAt: "2026-10-31T12:00:00Z" });
    expect(alertsFor(b, passed, gone)).toMatchObject([{ event: "storm.passed", subject: "Hurricane Testcase has passed" }]);
    // The borrower's photo link walks them round the property, not through budget lines.
    const asked = reducer(passed, { t: "askForPhotos", requestId: "storm-1", dealId: "d2", stormId: "al992026", to: "Alex Sample", who: "borrower", scopeIds: [], by: "LendHous servicing", byTeam: true, expiresAt: "2030-01-01T00:00:00Z" });
    expect(asked.storms[0].followedUp).toEqual(["d2"]);
    expect(requestSteps(asked.photoRequests[0], deal(asked, "d2")).map((step) => step.id)).toEqual(["property", STORM_STEP.id]);
    // A draw inspected before the storm needs another inspection before it's approved or released.
    const before: DrawRequest = { ...passed.draws.find((item) => item.id === "draw-1")!, status: "inspected", lines: [{ scopeId: "kitchen", requested: 12_000, observedPct: 1 }], inspection: { by: "Ina", at: "2026-10-29T15:00:00Z", notes: "" } };
    const held = { ...asked, draws: asked.draws.map((item) => (item.id === "draw-1" ? before : item)) };
    expect(freshInspectionNeeded(deal(held, "d2"), before)).toMatch(/Hurricane Testcase passed on Oct 31, 2026, after this draw's inspection/);
    expect(approvalError(deal(held, "d2"), before, "Someone")).toMatch(/Order a fresh inspection/);
    expect(drawHolds(deal(held, "d2"), { ...before, status: "approved" }, "2026-10-31")).toContain(freshInspectionNeeded(deal(held, "d2"), before));
    const again = reducer(held, { t: "sendInspector", drawId: "draw-1" });
    expect(again.draws.find((item) => item.id === "draw-1")).toMatchObject({ status: "inspecting", approvers: [] });
    // The new inspection is after the storm, so it clears the hold.
    const done = reducer(again, { t: "recordInspection", drawId: "draw-1", observed: { kitchen: 1 } });
    expect(freshInspectionNeeded(deal(done, "d2"), done.draws.find((item) => item.id === "draw-1")!)).toBeNull();
    // Another loan's draws are untouched, and a draw not yet inspected will be inspected after the storm anyway.
    expect(freshInspectionNeeded(deal(passed, "d9"), { status: "inspected", inspection: { by: "x", at: "2026-01-01T00:00:00Z", notes: "" } })).toBeNull();
    expect(freshInspectionNeeded(deal(passed, "d2"), { status: "submitted" })).toBeNull();
  });
  it("adds up what's out, what's left to draw, and whether wind is covered", () => {
    const b = demoBook();
    const d2 = exposure(deal(b, "d2"), "2026-10-31");
    expect(d2.balance).toBeGreaterThan(0);
    expect(d2.undrawn).toBeGreaterThan(0);
    // The Miami rental has its own windstorm policy.
    expect(exposure(deal(b, "d10"), "2026-10-31").wind).toBe(true);
    // A lapsed policy is named.
    expect(exposure(deal(b, "d13"), "2026-10-31").lapsed.length).toBeGreaterThan(0);
    expect(exposureLines(b.deals, ["d13"], "2026-10-31")[0]).toMatch(/lapsed/);
  });
});

describe("FEMA's flood map", () => {
  it("reads the zone, a special flood hazard area, and not mapped", () => {
    expect(parseFloodAnswer(json("fema/zone-ae.json"))).toEqual({ mapped: true, zone: "AE", sfha: true });
    expect(parseFloodAnswer(json("fema/zone-x-shaded.json"))).toEqual({ mapped: true, zone: "X", sfha: false, subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" });
    // A point on a boundary counts as the riskier zone.
    expect(parseFloodAnswer(json("fema/boundary-x-ve.json"))).toMatchObject({ zone: "VE", sfha: true });
    // Nothing back means FEMA has no digital map there, which is not the same as no risk.
    expect(parseFloodAnswer(json("fema/not-mapped.json"))).toEqual({ mapped: false });
    expect(parseFloodAnswer(json("fema/area-not-included.json"))).toEqual({ mapped: false });
    expect(parseFloodAnswer(json("fema/error.json"))).toEqual({ error: "FEMA's map refused the lookup: Unable to complete operation." });
    expect(floodMapWords({ mapped: false, zone: "", sfha: false, at: "x" })).toMatch(/isn't mapped, not that there's no risk/);
    expect(floodMapWords({ mapped: true, zone: "X", sfha: false, subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", at: "x" })).toMatch(/moderate risk/);
    expect(floodMapWords({ mapped: true, zone: "D", sfha: false, at: "x" })).toMatch(/undetermined/);
    expect(["A", "AE", "AO", "AH", "VE", "V", "A99"].every(isSfhaZone)).toBe(true);
    expect(["X", "B", "C", "D"].some(isSfhaZone)).toBe(false);
  });
  it("finds the flood zones layer in FEMA's directory and asks for one point", async () => {
    expect(floodLayerId(json("fema/directory.json"))).toBe(28);
    expect(floodLayerId({ layers: [{ id: 3, name: "FIRM Panels" }] })).toBeNull();
    const url = new URL(floodQuery(28, { lat: 26.1224, lng: -80.1374 }));
    expect(url.pathname).toBe("/arcgis/rest/services/public/NFHL/MapServer/28/query");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ geometry: "-80.1374,26.1224", geometryType: "esriGeometryPoint", inSR: "4326", outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF", returnGeometry: "false", f: "json" });
    const asked: string[] = [];
    const fetcher = (async (input: string) => { asked.push(input); return { ok: true, json: async () => json(input.includes("/query") ? "fema/zone-ae.json" : "fema/directory.json") }; }) as unknown as typeof fetch;
    expect(await floodAt({ lat: 26.1224, lng: -80.1374 }, fetcher)).toEqual({ mapped: true, zone: "AE", sfha: true });
    expect(asked[asked.length - 1]).toContain("/MapServer/28/query");
    expect(await floodAt({ lat: 1, lng: 1 }, (async () => { throw new Error("reset"); }) as unknown as typeof fetch)).toEqual({ error: "FEMA's flood map didn't answer. Try again later." });
  });
  it("adds a flood insurance condition in zones A and V, and a flood premium to a rental loan's DSCR", () => {
    const b = demoBook();
    expect(check(b, owner, { t: "recordFloodMap", dealId: "d1", map: { mapped: true, zone: "AE", sfha: true, at: "x" } })).toHaveProperty("error");
    const action: BookAction = { t: "recordFloodMap", dealId: "d1", map: { mapped: true, zone: "AE", sfha: true, at: "2026-10-31T15:00:00Z" } };
    const after = reducer(b, action);
    expect(deal(after, "d1").insurance?.flood).toMatchObject({ zone: "AE", sfha: true, source: "fema", by: "FEMA flood map" });
    expect(deal(after, "d1").conditions?.find((item) => item.templateId === FLOOD_CONDITION)).toMatchObject({ category: "prior_to_funding", owner: "borrower", status: "open" });
    expect(alertsFor(b, after, action).map((alert) => [alert.to, alert.event])).toEqual([["borrower", "flood.required"], ["broker", "flood.required"], ["team", "flood.required"]]);
    // Looking again doesn't add a second one.
    expect(reducer(after, action).deals.find((d) => d.id === "d1")!.conditions!.filter((item) => item.templateId === FLOOD_CONDITION)).toHaveLength(1);
    // A rental loan before its term sheet counts a flood premium, which lowers its DSCR.
    const early: Book = { ...b, deals: b.deals.map((d) => (d.id === "d4" ? { ...d, status: "underwriting" as const } : d)) };
    const rental = deal(reducer(early, { ...action, dealId: "d4" } as BookAction), "d4");
    expect(rental.app.floodAnnual).toBe(FLOOD_PREMIUM_ESTIMATE);
    expect(evaluate(rental.app).dscr!).toBeLessThan(evaluate(deal(early, "d4").app).dscr!);
    // A funded loan gets no new condition.
    expect(deal(reducer(b, { ...action, dealId: "d2" } as BookAction), "d2").conditions?.some((item) => item.templateId === FLOOD_CONDITION)).toBeFalsy();
  });
  it("keeps a zone someone recorded from a determination, and says when FEMA disagrees", () => {
    const b = demoBook();
    // The Miami rental's zone AE came from its flood determination; FEMA's map now says X.
    const after = reducer(b, { t: "recordFloodMap", dealId: "d10", map: { mapped: true, zone: "X", sfha: false, at: "2026-10-31T15:00:00Z" } });
    expect(deal(after, "d10").insurance?.flood).toMatchObject({ zone: "AE", sfha: true });
    expect(floodDisagrees(deal(after, "d10"))).toBe(true);
    // Not mapped records the answer and changes nothing else.
    const unmapped: BookAction = { t: "recordFloodMap", dealId: "d1", map: { mapped: false, zone: "", sfha: false, at: "2026-10-31T15:00:00Z" } };
    const none = reducer(b, unmapped);
    expect(deal(none, "d1")).toMatchObject({ floodMap: { mapped: false } });
    expect(deal(none, "d1").insurance).toEqual(deal(b, "d1").insurance);
    expect(alertsFor(b, none, unmapped)).toMatchObject([{ to: "team", event: "flood.not_mapped" }]);
    // A zone A recorded by hand gets the condition too.
    const typed = reducer(b, { t: "setFloodZone", dealId: "d1", sfha: true, zone: "ae", by: "Pat" });
    expect(deal(typed, "d1").conditions?.some((item) => item.templateId === FLOOD_CONDITION)).toBe(true);
    expect(deal(b, "d16").floodMap).toMatchObject({ mapped: false });
  });
});

describe("partners' teasers", () => {
  it("never carry a storm hold or where the property is", () => {
    const b = reducer(reducer(demoBook(), { t: "recordStormCheck", at: "2026-10-30T12:00:00Z", storms: [{ id: "al1", name: "X", label: "Hurricane X", advisory: "1", dealIds: ["d2"] }] }), { t: "recordStormCheck", at: "2026-10-31T12:00:00Z", storms: [] });
    const teaser: Deal = scopeBook({ ...b, deals: b.deals.map((d) => (d.id === "d2" ? { ...d, teaserSentTo: ["p-a"] } : d)) }, { id: "pa", name: "P", roleCodes: ["PARTNER_LENDER"], organizationId: "p-a" }).deals.find((d) => d.id === "d2")!;
    if (teaser) expect([teaser.stormHold, teaser.geo]).toEqual([undefined, undefined]);
  });
});
