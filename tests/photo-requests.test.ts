import { describe, expect, it } from "vitest";
import { authorize, canAskForPhotos, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book } from "@/lib/book";
import type { PhotoRequest } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { guideSteps, looksOld, missingShots, photoRequestState, PROPERTY_STEP, requestLines } from "@/lib/photo-requests";
import { fileHeaders, photoProblem } from "@/lib/uploads";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const allowedFor = (viewer: Viewer) => (permission: Permission) => can(viewer.roleCodes, permission, { member: viewer });
const DAY = 86_400_000;

// d2 belongs to the demo borrower. Give the book real ids, the way a live book looks.
const book = (): Book => {
  const base = demoBook();
  return { ...base, photoRequests: [], deals: base.deals.map((deal) => (deal.borrowerId === "b-alex" ? { ...deal, borrowerId: "borrower-1" } : deal)) };
};
const ask = (overrides: Partial<Extract<Parameters<typeof reducer>[1], { t: "askForPhotos" }>> = {}) => ({ t: "askForPhotos" as const, requestId: "req-1", dealId: "d2", drawId: "draw-1", to: "Carl Contractor", who: "contractor" as const, scopeIds: ["kitchen", "flooring"], by: "Owen at LendHous", expiresAt: new Date(Date.now() + 14 * DAY).toISOString(), ...overrides });
const withRequest = () => reducer(book(), ask());
const requestIn = (state: Book) => state.photoRequests[0];
const photo = (id: string, scopeId = "kitchen", shot = "room") => ({ id, scopeId, shot, name: `${id}.jpg`, at: new Date().toISOString() });

describe("the photo guide", () => {
  it("starts at the property, then goes through each budget line asked about", () => {
    const steps = guideSteps([{ id: "kitchen", division: "Kitchen" }, { id: "plumbing", division: "Plumbing" }]);
    expect(steps.map((step) => step.id)).toEqual(["property", "kitchen", "plumbing"]);
    expect(steps[0]).toBe(PROPERTY_STEP);
    expect(steps[1].shots.map((shot) => shot.id)).toEqual(["room", "cabinets", "appliances"]);
    for (const step of steps) for (const shot of step.shots) expect(shot.tip.length).toBeGreaterThan(10);
  });
  it("has a sensible guide for every budget line a loan can start with, and for one it has never seen", () => {
    const lines = demoBook().deals.flatMap((deal) => deal.scope ?? []);
    for (const step of guideSteps(lines)) expect(step.shots.length).toBeGreaterThan(0);
    expect(guideSteps([{ id: "pool", division: "Pool" }])[1]).toMatchObject({ title: "Pool", shots: [{ id: "wide" }, { id: "close" }] });
  });
  it("names the shots still missing", () => {
    const steps = guideSteps([{ id: "kitchen", division: "Kitchen" }]);
    expect(missingShots(steps, [{ scopeId: "property", shot: "front" }, { scopeId: "kitchen", shot: "room" }])).toEqual([{ step: "Kitchen", shot: "Cabinets and counters" }, { step: "Kitchen", shot: "Appliances" }]);
  });
  it("covers only the lines asked for, as they stand on the loan", () => {
    const state = withRequest();
    const deal = state.deals.find((item) => item.id === "d2")!;
    expect(requestLines(requestIn(state), deal).map((line) => line.id)).toEqual(["kitchen", "flooring"]);
    expect(requestLines({ scopeIds: ["gone"] }, deal)).toEqual([]);
  });
  it("flags a photo whose file is much older than the request", () => {
    const sentAt = "2026-10-20T00:00:00Z";
    expect(looksOld("2026-10-01T00:00:00Z", sentAt)).toBe(true);
    expect(looksOld("2026-10-19T00:00:00Z", sentAt)).toBe(false);
    expect(looksOld(undefined, sentAt)).toBe(false);
  });
});

describe("a photo request's life", () => {
  it("is created with no photos and logged", () => {
    const state = withRequest();
    expect(requestIn(state)).toMatchObject({ id: "req-1", to: "Carl Contractor", status: "open", photos: [], scopeIds: ["kitchen", "flooring"] });
    expect(state.audit[0].text).toContain("photos requested from Carl Contractor");
  });
  it("takes photos, gives them back, and finishes", () => {
    let state = reducer(withRequest(), { t: "addRequestPhoto", requestId: "req-1", photo: photo("a") });
    state = reducer(state, { t: "addRequestPhoto", requestId: "req-1", photo: photo("b") });
    state = reducer(state, { t: "removeRequestPhoto", requestId: "req-1", photoId: "a" });
    expect(requestIn(state).photos.map((item) => item.id)).toEqual(["b"]);
    state = reducer(state, { t: "finishPhotoRequest", requestId: "req-1", by: "Carl", note: "Appliances next week." });
    expect(requestIn(state)).toMatchObject({ status: "received", finishedBy: "Carl", note: "Appliances next week." });
    expect(requestIn(state).finishedAt).toBeTruthy();
  });
  it("turns off and comes back with a new date", () => {
    const later = new Date(Date.now() + 30 * DAY).toISOString();
    let state = reducer(withRequest(), { t: "turnOffPhotoRequest", requestId: "req-1" });
    expect(requestIn(state).status).toBe("off");
    state = reducer(state, { t: "renewPhotoRequest", requestId: "req-1", expiresAt: later });
    expect(requestIn(state)).toMatchObject({ status: "open", expiresAt: later });
  });
  it("keeps a finished request finished when it gets a new link", () => {
    let state = reducer(withRequest(), { t: "addRequestPhoto", requestId: "req-1", photo: photo("a") });
    state = reducer(state, { t: "finishPhotoRequest", requestId: "req-1", by: "Carl", note: "" });
    expect(requestIn(reducer(state, { t: "renewPhotoRequest", requestId: "req-1", expiresAt: new Date().toISOString() })).status).toBe("received");
  });
});

describe("when a link stops working", () => {
  const state = withRequest();
  const deal = state.deals.find((item) => item.id === "d2")!;
  const draw = state.draws.find((item) => item.id === "draw-1")!;
  const request: PhotoRequest = requestIn(state);
  it("works until its date", () => {
    expect(photoRequestState(request, deal, draw)).toBe("open");
    expect(photoRequestState(request, deal, draw, Date.now() + 15 * DAY)).toBe("expired");
  });
  it("stops when turned off, even before its date", () => {
    expect(photoRequestState({ ...request, status: "off" }, deal, draw)).toBe("off");
  });
  it("closes with its draw or its loan, because nothing is left to review", () => {
    expect(photoRequestState(request, deal, { ...draw, status: "funded" })).toBe("closed");
    expect(photoRequestState(request, deal, { ...draw, status: "rejected" })).toBe("closed");
    expect(photoRequestState(request, { ...deal, status: "paid_off" }, undefined)).toBe("closed");
    expect(photoRequestState(request, undefined, undefined)).toBe("closed");
  });
  it("stays open after the first batch, so a contractor can add what was missed", () => {
    expect(photoRequestState({ ...request, status: "received" }, deal, draw)).toBe("open");
  });
});

describe("who can do what with photo links", () => {
  const owner = person("owner", ["ADMIN_OWNER"]);
  const borrower = person("borrower-1", ["BORROWER"]);
  const stranger = person("borrower-2", ["BORROWER"]);
  const broker = person("broker-user", ["BROKER"], "broker-firm");
  const partner = person("partner-user", ["PARTNER_LENDER"], "p-a");
  const buyer = person("buyer-user", ["LOAN_BUYER"], "buy-a");
  const drawAdmin = person("draws", ["DRAW_ADMIN"]);
  const servicer = person("servicer", ["SERVICER"]);
  const capital = person("capital", ["CAPITAL_MANAGER"]);
  const may = (viewer: Viewer) => canAskForPhotos(book(), viewer, "d2", allowedFor(viewer));

  it("staff who handle draws, documents or servicing can ask, and the borrower can on their own loan", () => {
    for (const viewer of [owner, drawAdmin, servicer, borrower]) expect(may(viewer)).toBe(true);
  });
  it("nobody else can", () => {
    for (const viewer of [stranger, broker, partner, buyer, capital]) expect(may(viewer)).toBe(false);
    expect(canAskForPhotos(book(), owner, "no-such-loan", allowedFor(owner))).toBe(false);
  });
  it("no browser can send these actions, only the server's own steps", () => {
    for (const action of [ask(), { t: "addRequestPhoto", requestId: "req-1", photo: photo("a") }, { t: "finishPhotoRequest", requestId: "req-1", by: "x", note: "" }, { t: "turnOffPhotoRequest", requestId: "req-1" }]) expect(parseAction(action)).toBeNull();
    const refused = authorize(book(), owner, ask(), allowedFor(owner));
    expect(refused).toHaveProperty("error");
    expect(authorize(book(), owner, ask(), allowedFor(owner), true)).toHaveProperty("action");
  });
  it("only the team and the borrower receive a loan's requests", () => {
    const state = withRequest();
    expect(scopeBook(state, owner).photoRequests.map((item) => item.id)).toEqual(["req-1"]);
    expect(scopeBook(state, borrower).photoRequests.map((item) => item.id)).toEqual(["req-1"]);
    for (const viewer of [stranger, broker, partner, buyer]) expect(scopeBook(state, viewer).photoRequests).toEqual([]);
  });
});

describe("who hears about finished photos", () => {
  const finished = (who: PhotoRequest["who"]) => {
    const before = reducer(reducer(book(), ask({ who })), { t: "addRequestPhoto", requestId: "req-1", photo: photo("a") });
    const action = { t: "finishPhotoRequest" as const, requestId: "req-1", by: "Carl", note: "" };
    return alertsFor(before, reducer(before, action), action);
  };
  it("the team and the borrower, when a contractor sends them", () => {
    expect(finished("contractor").map((alert) => alert.to)).toEqual(["team", "borrower"]);
    expect(finished("contractor")[0].subject).toContain("LH-DEMO");
    expect(finished("contractor")[0].body).toBe("Carl sent 1 photo of the work.");
  });
  it("only the team, when the borrower sends them", () => {
    expect(finished("borrower").map((alert) => alert.to)).toEqual(["team"]);
  });
});

describe("what the link accepts", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10]);
  const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
  const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(8)]);
  const check = (name: string, bytes: Buffer) => photoProblem(name, bytes.length, bytes);
  it("real photos in the usual formats", () => {
    for (const [name, bytes] of [["a.jpg", JPEG], ["a.jpeg", JPEG], ["a.PNG", PNG], ["a.webp", WEBP], ["a.heic", HEIC], ["a.heif", HEIC]] as const) expect(check(name, bytes)).toBeNull();
  });
  it("no other kind of file, whatever its name says", () => {
    expect(check("a.pdf", Buffer.from("%PDF-1.4"))).toMatch(/Only photos/);
    expect(check("a.svg", Buffer.from("<svg onload=alert(1)>"))).toMatch(/Only photos/);
    expect(check("a.html", Buffer.from("<script>"))).toMatch(/Only photos/);
    expect(check("a.jpg", Buffer.from("<script>alert(1)</script>"))).toMatch(/do not match/);
    expect(check("a.webp", JPEG)).toMatch(/do not match/);
    expect(check("a.heic", JPEG)).toMatch(/do not match/);
  });
  it("nothing over the size limit or empty", () => {
    expect(photoProblem("a.jpg", 16 * 1024 * 1024, JPEG)).toMatch(/size limit/);
    expect(check("a.jpg", Buffer.alloc(0))).toMatch(/Choose a file/);
  });
  it("shows plain pictures in the browser and downloads everything else", () => {
    expect(fileHeaders("image/jpeg", "a.jpg", true)["Content-Disposition"]).toBe('inline; filename="a.jpg"');
    for (const mime of ["image/heic", "application/pdf", "text/html", "image/svg+xml"]) expect(fileHeaders(mime, "a", true)["Content-Disposition"]).toBe('attachment; filename="a"');
    expect(fileHeaders("image/jpeg", "a.jpg")["Content-Disposition"]).toBe('attachment; filename="a.jpg"');
    expect(fileHeaders("image/jpeg", "a.jpg", true)["X-Content-Type-Options"]).toBe("nosniff");
    expect(fileHeaders("image/jpeg", "a.jpg", true)["Content-Security-Policy"]).toContain("sandbox");
  });
});
