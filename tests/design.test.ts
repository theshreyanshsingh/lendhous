import { afterEach, describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { demoBook, reducer, type Book } from "@/lib/book";
import { loanTimeline } from "@/lib/loan-timeline";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { itemsOwed, nextStepFor } from "@/lib/next-step";
import { can, type Permission } from "@/lib/permissions";
import { lastMonths, maturityLadder, monthLabel, paidByMonth } from "@/lib/portfolio-charts";
import { holdingsOf } from "@/lib/investor-statements";
import { showcaseOf, showcasePhoto } from "@/lib/showcase";
import { hasImagery, imageUrl, metadataUrl, streetViewImage, streetViewLocation } from "@/lib/street-view";
import { interestBasis, PLAIN_RATIO, statusWords } from "@/lib/status-words";

const deal = (id: string, change: Partial<Deal> = {}): Deal => ({ ...demoBook().deals.find((item) => item.id === id)!, ...change });

describe("status words", () => {
  it("are one sentence-case word set for every status", () => {
    expect(statusWords("term_sheet_issued")).toBe("Term sheet sent");
    expect(statusWords("servicing_current")).toBe("Current");
    expect(statusWords("rejected")).toBe("Sent back");
    expect(statusWords("not_started")).toBe("Not started");
    // anything new reads as a sentence, never Title Case
    expect(statusWords("waiting_on_title")).toBe("Waiting on title");
  });
  it("say what a ratio and an interest basis mean without jargon", () => {
    expect(PLAIN_RATIO.ltarv).toBe("Loan to after-repair value");
    expect(interestBasis("fix_flip", "full_boat")).toBe("on the full loan amount");
    expect(interestBasis("fix_flip", "dutch")).toBe("on money drawn so far");
    expect(interestBasis("dscr")).toBe("30-year schedule");
    for (const words of [interestBasis("fix_flip"), interestBasis("bridge", "dutch")]) expect(words).not.toMatch(/full-boat|dutch/i);
  });
});

describe("the borrower's one next step", () => {
  it("is nothing for an application that ended, and done for a paid-off loan", () => {
    expect(nextStepFor(deal("d1", { status: "withdrawn" }))).toBeNull();
    expect(nextStepFor(deal("d1", { status: "paid_off" }))?.kind).toBe("done");
  });
  it("asks for the term sheet first while one is waiting", () => {
    const sheet = { version: 1, issuedAt: "2026-10-29T12:00:00Z", issuedOn: "2026-10-29", issuedBy: "Uma", expiresOn: "2026-11-05", status: "sent" as const, pricingVersion: "v", terms: {} as never, matrix: { rate: [11, 12] as [number, number], points: [2, 3] as [number, number] }, conditions: [] as never };
    const step = nextStepFor(deal("d1", { status: "term_sheet_issued", termSheets: [sheet] }));
    expect(step).toMatchObject({ kind: "sign", href: "#term-sheet" });
    expect(step?.detail).toContain("Nov 5, 2026");
  });
  it("then the unfinished application, then what's owed, counting documents and their own conditions", () => {
    expect(nextStepFor(deal("d1", { sponsor: undefined, status: "underwriting" }))?.kind).toBe("finish");
    const owing = deal("d1", { conditions: [{ id: "c1", title: "Proof of funds", owner: "borrower", status: "open" } as never, { id: "c2", title: "Title", owner: "title", status: "open" } as never] });
    const withSponsor: Deal = { ...owing, sponsor: { entityState: "FL", guarantors: [], trackRecord: [], declarations: {} as never } };
    expect(itemsOwed(withSponsor)).toBe(withSponsor.docs.filter((doc) => doc.status === "requested" || doc.status === "rejected").length + 1);
    expect(nextStepFor(withSponsor)).toMatchObject({ kind: "send", href: "#needs-from-you" });
  });
  it("is the next payment on a funded loan with nothing owed, and never shows an ISO date", () => {
    const step = nextStepFor(deal("d2"));
    expect(step?.kind).toBe("pay");
    expect(step?.title).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("is a call on a loan in default", () => {
    expect(nextStepFor(deal("d2", { status: "default" }))?.kind).toBe("default");
  });
});

describe("the loan timeline", () => {
  const draws: DrawRequest[] = [{ id: "w1", dealId: "d2", requestedAt: "2026-09-20T12:00:00Z", by: "Alex", note: "", contact: "", photos: [], lines: [{ scopeId: "s1", requested: 30_000 }], status: "funded", approved: 25_000, approvers: [], fundedAt: "2026-09-25T15:00:00Z" }];
  it("dates each step from the stage history, counts the days, and adds draws and maturity after funding", () => {
    const timeline = loanTimeline(deal("d2"), draws, "2026-10-31")!;
    expect(timeline.points.map((point) => point.label)).toEqual(["Applied", "Underwriting", "Term sheet", "Conditions", "Clear to close", "Funded", "Matures"]);
    expect(timeline.points.slice(0, 5).every((point) => point.state === "done" && point.on && point.days !== undefined)).toBe(true);
    expect(timeline.points[5]).toMatchObject({ state: "now", on: deal("d2").closingDate });
    expect(timeline.points[6].state).toBe("next");
    expect(timeline.draws).toEqual([{ on: "2026-09-25", amount: 25_000 }]);
  });
  it("shows the target closing on a loan in the pipeline, and how long it's been in the current step", () => {
    const d1 = deal("d1");
    const timeline = loanTimeline(d1, [], "2026-10-31")!;
    const now = timeline.points.find((point) => point.state === "now")!;
    expect(now.label).toBe("Underwriting");
    // the step began at initial review, the first of its two stages
    const began = d1.stages!.find((stage) => stage.status === "initial_review")!.at.slice(0, 10);
    expect(now.on).toBe(began);
    expect(now.days).toBe(Math.round((Date.parse("2026-10-31") - Date.parse(began)) / 86_400_000));
    expect(timeline.points.at(-1)).toMatchObject({ label: "Funded", on: d1.closingDate, target: true, state: "next" });
    // before the browser knows today, there's no running count
    expect(loanTimeline(d1, [], "")!.points.find((point) => point.state === "now")!.days).toBeUndefined();
  });
  it("has nothing for a declined application", () => {
    expect(loanTimeline(deal("d1", { status: "declined" }), [], "2026-10-31")).toBeNull();
  });
});

describe("portfolio charts", () => {
  it("lists the last months oldest first, across a year end", () => {
    expect(lastMonths("2026-02-14", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthLabel("2027-01", "short")).toBe("Jan ’27");
  });
  it("adds up what reached the partner each month, matching the payments split, and when their money comes back", () => {
    const book = demoBook();
    const holdings = holdingsOf(book, { type: "partner", id: book.partnerId });
    expect(holdings.length).toBeGreaterThan(0);
    const months = lastMonths("2026-10-31", 12);
    const paid = paidByMonth(holdings, months);
    expect(paid).toHaveLength(12);
    expect(paid.reduce((sum, item) => sum + item.value, 0)).toBeGreaterThan(0);
    const ladder = maturityLadder(holdings);
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((item, i) => i === 0 || item.month > ladder[i - 1].month)).toBe(true);
    expect(maturityLadder(holdings.map((holding) => ({ ...holding, deal: { ...holding.deal, status: "paid_off" as const } })))).toEqual([]);
  });
});

describe("recently funded on the website", () => {
  const photo = { id: "photo-1", name: "front.jpg", at: "2026-09-01T00:00:00Z", by: "Alex" };
  it("lists only funded loans whose borrower turned it on, with no name or address", () => {
    const deals = [deal("d2", { showcase: { on: true, by: "Alex", at: "2026-10-01T00:00:00Z" }, propertyPhotos: [photo] }), deal("d1", { showcase: { on: true, by: "Alex", at: "2026-10-01T00:00:00Z" } }), deal("d2", { id: "d2b", showcase: { on: false, by: "Alex", at: "2026-10-01T00:00:00Z" } })];
    const items = showcaseOf(deals);
    expect(items.map((item) => item.dealId)).toEqual(["d2"]);
    expect(items[0]).toMatchObject({ city: "Fort Lauderdale", photoId: "photo-1" });
    expect(items[0].amount % 1000).toBe(0);
    const text = JSON.stringify(items);
    for (const secret of ["Alex", "Sample Flips", "456 Placeholder"]) expect(text).not.toContain(secret);
  });
  it("serves a photo only while the borrower agrees, and never a sample one", () => {
    expect(showcasePhoto(deal("d2", { showcase: { on: true, by: "Alex", at: "x" }, propertyPhotos: [photo] }))).toBe("photo-1");
    expect(showcasePhoto(deal("d2", { showcase: { on: false, by: "Alex", at: "x" }, propertyPhotos: [photo] }))).toBeNull();
    expect(showcasePhoto(deal("d2", { showcase: { on: true, by: "Alex", at: "x" }, propertyPhotos: [{ ...photo, id: "demo-1" }] }))).toBeNull();
    expect(showcasePhoto(deal("d2", { status: "default", showcase: { on: true, by: "Alex", at: "x" }, propertyPhotos: [photo] }))).toBeNull();
  });

  const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
  const allowedFor = (viewer: Viewer) => (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer });
  const live = (): Book => { const base = demoBook(); return { ...base, deals: base.deals.map((item) => ({ ...item, borrowerId: item.borrowerId === "b-alex" ? "borrower-1" : item.borrowerId })) }; };
  const check = (viewer: Viewer, on: boolean, dealId = "d2") => authorize(live(), viewer, { t: "setShowcase", dealId, on, by: "anyone" }, allowedFor(viewer), false);
  it("is the borrower's choice: they turn it on for a funded loan, the team can only take it down", () => {
    const borrower = person("borrower-1", ["BORROWER"]);
    const allowed = (result: ReturnType<typeof check>) => "action" in result;
    expect(check(borrower, true)).toMatchObject({ action: { by: "borrower-1 name" } });
    expect(allowed(check(borrower, true, "d1"))).toBe(false);
    expect(allowed(check(person("borrower-2", ["BORROWER"]), true))).toBe(false);
    expect(allowed(check(person("owner", ["ADMIN_OWNER"]), true))).toBe(false);
    expect(allowed(check(person("owner", ["ADMIN_OWNER"]), false))).toBe(true);
    expect(allowed(check(person("uw", ["UNDERWRITER"]), false))).toBe(false);
    expect(parseAction({ t: "setShowcase", dealId: "d2", on: true, by: "x" })).toBeTruthy();
    const after = reducer(live(), { t: "setShowcase", dealId: "d2", on: true, by: "Alex" });
    expect(after.deals.find((item) => item.id === "d2")!.showcase).toMatchObject({ on: true, by: "Alex" });
    expect(after.audit[0].text).toContain("shown on the website");
  });
});

describe("Street View", () => {
  afterEach(() => { delete process.env.GOOGLE_MAPS_API_KEY; });
  const reply = (body: unknown, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": type } });
  it("builds the address and URLs, encoded", () => {
    const location = streetViewLocation({ address: "12 Palm & Pine Ave", city: "Miami", zip: "33101", app: { state: "FL" } });
    expect(location).toBe("12 Palm & Pine Ave, Miami, FL 33101");
    expect(metadataUrl(location, "k")).toContain("location=12%20Palm%20%26%20Pine%20Ave");
    expect(imageUrl(location, "k")).toContain("return_error_code=true");
    expect(hasImagery({ status: "OK" })).toBe(true);
    expect(hasImagery({ status: "ZERO_RESULTS" })).toBe(false);
  });
  it("asks the free metadata call first, and fetches the picture only when there is one", async () => {
    const calls: string[] = [];
    expect(await streetViewImage("x", async () => reply({}))).toBeNull();
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const none = await streetViewImage("12 Palm Ave, Miami, FL", async (url) => { calls.push(String(url)); return reply({ status: "ZERO_RESULTS" }); });
    expect(none).toBeNull();
    expect(calls).toHaveLength(1);
    const found = await streetViewImage("12 Palm Ave, Miami, FL", async (url) => (String(url).includes("/metadata") ? reply({ status: "OK" }) : reply("JPEGDATA", "image/jpeg")));
    expect(found?.type).toBe("image/jpeg");
    expect(new TextDecoder().decode(found!.bytes)).toBe("JPEGDATA");
    expect(await streetViewImage("12 Palm Ave", async () => { throw new Error("offline"); })).toBeNull();
  });
});
