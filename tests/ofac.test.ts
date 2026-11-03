import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { nextStage } from "@/lib/loan-stages";
import type { Deal, Screening } from "@/lib/mockData";
import { csvLine, jaroWinkler, nameScore, nameTokens, ofacBlocker, parseAliases, parseSdn, prepareList, screeningOf, screeningSubjects, screenName, unscreenedNames } from "@/lib/ofac";
import { can, type Permission } from "@/lib/permissions";

// Lines in Treasury's own format (SDN.CSV and ALT.CSV); the people are made up.
const SDN = [
  '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '9001,"DOE, Jonathan Michael","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 12 Mar 1961; nationality Testland."',
  '9002,"PENA HOLDINGS, S.A.",-0- ,"SDNTK",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '9003,"CIMEX",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
].join("\r\n");
const ALT = ['9001,501,"aka","DOE, Johnny",-0- ', '36,502,"aka","AERO-CARIBBEAN",-0- '].join("\r\n");
const primaries = parseSdn(SDN);
const list = prepareList([...primaries, ...parseAliases(ALT, primaries)]);

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (book: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(book, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const screen = (deal: Deal, at = "2026-11-03T06:00:00Z") => screeningOf(screeningSubjects(deal), list, { id: `s-${at}`, at, by: "Nightly", fetchedAt: "2026-11-03T05:00:00Z" });
const loan = (changes: Partial<Deal> = {}): Deal => ({ ...demoBook().deals.find((deal) => deal.id === "d5")!, screenings: undefined, ...changes });

describe("reading Treasury's list", () => {
  it("reads quoted fields and Treasury's -0- blanks", () => {
    expect(csvLine('9001,"DOE, Jonathan Michael","individual","SDGT",-0- ')).toEqual(["9001", "DOE, Jonathan Michael", "individual", "SDGT", ""]);
    expect(primaries.map((entry) => entry[2])).toEqual(["entity", "individual", "entity", "entity"]);
  });
  it("gives each alias its entry's number, type and programs", () => {
    expect(parseAliases(ALT, primaries)).toEqual([[9001, "DOE, Johnny", "individual", "SDGT"], [36, "AERO-CARIBBEAN", "entity", "CUBA"]]);
  });
});

describe("comparing names", () => {
  it("ignores order, accents, punctuation and company-type words", () => {
    expect(nameTokens("Peña Holdings, S.A.")).toEqual(["PENA", "HOLDINGS"]);
    expect(nameTokens("Sample Flips L.L.C. (FAKE)")).toEqual(["SAMPLE", "FLIPS"]);
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 2);
  });
  it("flags a full name or a close spelling, and not one shared word", () => {
    expect(nameScore(nameTokens("Jonathan M. Doe"), nameTokens("DOE, Jonathan Michael"))).toBeGreaterThan(0.95);
    expect(nameScore(nameTokens("Jonathon Doe"), nameTokens("DOE, Jonathan Michael"))).toBeGreaterThan(0.9);
    expect(nameScore(nameTokens("Doe"), nameTokens("DOE, Jonathan Michael"))).toBe(0);
    expect(nameScore(nameTokens("Jane Doe"), nameTokens("DOE, Jonathan Michael"))).toBe(0);
    expect(nameScore(nameTokens("Pena Holdings LLC"), nameTokens("PENA HOLDINGS, S.A."))).toBe(1);
    expect(nameScore(nameTokens("Pena Flips LLC"), nameTokens("PENA HOLDINGS, S.A."))).toBe(0);
  });
  it("finds a listed party by its alias, once, with its programs", () => {
    expect(screenName("Johnny Doe", list)).toMatchObject([{ uid: 9001, name: "DOE, Johnny", type: "individual", program: "SDGT" }]);
    expect(screenName("Cimex", list)).toMatchObject([{ uid: 9003 }]);
    expect(screenName("Alex Sample", list)).toEqual([]);
  });
});

describe("screening a loan", () => {
  it("checks the company, the borrower and each guarantor, each once", () => {
    const deal = loan();
    expect(screeningSubjects(deal).map((subject) => subject.role)).toEqual(["entity", "borrower", "guarantor"]);
    expect(screen(deal).status).toBe("clear");
  });
  it("holds the loan on a possible match until someone with authority reviews it", () => {
    const deal = loan({ sponsor: { ...loan().sponsor!, guarantors: [...loan().sponsor!.guarantors, { name: "Jonathan Doe", ownershipPct: 20, fico: 700, citizenship: "us" }] } });
    const screening = screen(deal);
    expect(screening.status).toBe("review");
    const book: Book = { ...emptyBook(), deals: [deal] };
    expect(check(book, person("owner", ["ADMIN_OWNER"]), { t: "recordScreening", dealId: deal.id, screening })).toHaveProperty("error");
    expect(parseAction({ t: "recordScreening", dealId: deal.id, screening })).toBeNull();
    const recorded = reducer(book, (check(book, person("system", []), { t: "recordScreening", dealId: deal.id, screening }, true) as { action: BookAction }).action);
    expect(alertsFor(book, recorded, { t: "recordScreening", dealId: deal.id, screening })).toMatchObject([{ to: "team", event: "ofac.review" }]);
    const held = recorded.deals[0];
    expect(ofacBlocker(held)).toMatch(/possible OFAC/);
    expect(nextStage({ ...held, status: "initial_review" }, evaluate(held.app))?.blockers).toContain("A possible OFAC sanctions match needs review");
    // Reviewing it takes clear_ofac and a real reason.
    const clear = (reason: string): BookAction => ({ t: "decideScreening", dealId: deal.id, screeningId: screening.id, decision: "cleared", reason, by: "x" });
    expect(check(recorded, person("proc", ["PROCESSOR"]), clear("Different date of birth"))).toHaveProperty("error");
    expect(check(recorded, person("uw", ["UNDERWRITER"]), clear("no"))).toMatchObject({ error: expect.stringMatching(/enough detail/) });
    const cleared = reducer(recorded, (check(recorded, person("uw", ["UNDERWRITER"]), clear("Listed DOB 1961; ours born 1990, passport checked")) as { action: BookAction }).action);
    expect(cleared.deals[0].screenings!.at(-1)).toMatchObject({ status: "cleared", decided: { by: "uw name" } });
    expect(ofacBlocker(cleared.deals[0])).toBeNull();
    // The next night finds the same hit: it's the same result, so the review still stands.
    const again = reducer(cleared, { t: "recordScreening", dealId: deal.id, screening: screen(deal, "2026-11-04T06:00:00Z") });
    expect(again.deals[0].screenings).toHaveLength(1);
    expect(again.deals[0].screenings![0]).toMatchObject({ status: "cleared", checkedAt: "2026-11-04T06:00:00Z" });
  });
  it("stops everything on a confirmed match and tells the team to report it", () => {
    const deal = loan({ borrowerName: "Johnny Doe" });
    const screening = screen(deal);
    const book = reducer({ ...emptyBook(), deals: [deal] }, { t: "recordScreening", dealId: deal.id, screening });
    const action: BookAction = { t: "decideScreening", dealId: deal.id, screeningId: screening.id, decision: "match", reason: "Same DOB and passport number as the listed person", by: "Owen" };
    const after = reducer(book, action);
    expect(ofacBlocker(after.deals[0])).toMatch(/Confirmed OFAC/);
    expect(alertsFor(book, after, action)).toMatchObject([{ to: "team", event: "ofac.match", body: expect.stringMatching(/10 business days/) }]);
  });
  it("asks for a new check when a guarantor is added, and a recent one before money goes out", () => {
    const screened = { ...loan(), screenings: [screen(loan())] };
    expect(ofacBlocker(screened, "2026-11-05")).toBeNull();
    expect(ofacBlocker(screened, "2026-11-07")).toMatch(/more than 3 days old/);
    const added = { ...screened, sponsor: { ...screened.sponsor!, guarantors: [...screened.sponsor!.guarantors, { name: "Pat New", ownershipPct: 10, fico: 700, citizenship: "us" as const }] } };
    expect(unscreenedNames(added)).toEqual(["Pat New"]);
    expect(ofacBlocker(added)).toMatch(/Pat New not screened/);
  });
  it("won't release a draw on a stale screening, and keeps screenings from the borrower", () => {
    const seeded = demoBook();
    const draw = { ...seeded.draws.find((item) => seeded.deals.some((deal) => deal.id === item.dealId && deal.status === "servicing_current"))!, status: "approved" as const, approved: 1000 };
    const demo = { ...seeded, draws: [draw] };
    const stale = { ...demo, deals: demo.deals.map((deal) => (deal.id === draw.dealId ? { ...deal, screenings: deal.screenings!.map((item): Screening => ({ ...item, checkedAt: "2026-01-01T00:00:00Z" })) } : deal)) };
    expect(check(stale, person("owner", ["ADMIN_OWNER"]), { t: "releaseDraw", drawId: draw.id })).toMatchObject({ error: expect.stringMatching(/more than 3 days old/) });
    const deal = demo.deals.find((item) => item.id === draw.dealId)!;
    expect(scopeBook(demo, person(deal.borrowerId, ["BORROWER"])).deals.every((item) => item.screenings === undefined)).toBe(true);
  });
});
