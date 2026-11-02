import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { demoBook, reducer, type Book } from "@/lib/book";
import { countedDeals, creditFlags, DECLARATIONS, emptyDeclarations, needsList, qualifyingFico, sponsorProblem, withSponsor } from "@/lib/credit";
import { evaluate } from "@/lib/engine";
import { nextStage } from "@/lib/loan-stages";
import type { Sponsor, TrackDeal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const allowedFor = (viewer: Viewer) => (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer });
const NOW = new Date("2026-11-02T12:00:00Z");
const deal = (id: string, completed: string, kind: TrackDeal["kind"] = "flip", verified = false): TrackDeal => ({ id, address: `${id} Main St`, kind, completed, purchasePrice: 200_000, salePrice: 300_000, verified });
const sponsor = (changes: Partial<Sponsor> = {}): Sponsor => ({
  entityState: "FL",
  guarantors: [{ name: "Dana Doe", ownershipPct: 60, fico: 740, citizenship: "us" }, { name: "Sam Roe", ownershipPct: 40, fico: 690, citizenship: "us" }],
  trackRecord: [deal("a", "2026-03", "flip", true), deal("b", "2025-08", "build", true), deal("c", "2024-12"), deal("d", "2022-01", "flip", true)],
  declarations: emptyDeclarations(),
  ...changes,
});
const app = demoBook().deals.find((item) => item.id === "d1")!.app;

describe("credit inputs come from the people and deals listed", () => {
  it("prices on the lowest guarantor's score", () => {
    expect(qualifyingFico(sponsor().guarantors)).toBe(690);
    expect(withSponsor({ ...app, fico: 800 }, sponsor(), NOW).fico).toBe(690);
  });
  it("counts only what was finished in the last 36 months, and only checked deals once asked", () => {
    expect(countedDeals(sponsor().trackRecord, NOW)).toEqual({ deals: 3, builds: 1 });
    expect(countedDeals(sponsor().trackRecord, NOW, true)).toEqual({ deals: 2, builds: 1 });
    expect(countedDeals([deal("future", "2027-01")], NOW).deals).toBe(0);
  });
  it("experience typed into the form can't outrank the deals listed", () => {
    const priced = withSponsor({ ...app, verifiedDeals: 40, groundUpBuilds: 9 }, sponsor(), NOW);
    expect(priced).toMatchObject({ verifiedDeals: 3, groundUpBuilds: 1 });
  });
  it("a foreign national guarantor makes it a foreign national loan", () => {
    const foreign = sponsor({ guarantors: [{ name: "Ana", ownershipPct: 100, fico: 720, citizenship: "foreign" }] });
    expect(withSponsor(app, foreign, NOW).foreignNational).toBe(true);
  });
});

describe("what a profile needs before it can go in", () => {
  it("a named guarantor with a real score", () => {
    expect(sponsorProblem(sponsor())).toBeNull();
    expect(sponsorProblem(sponsor({ guarantors: [] }))).toMatch(/at least one guarantor/);
    expect(sponsorProblem(sponsor({ guarantors: [{ name: " ", ownershipPct: 100, fico: 700, citizenship: "us" }] }))).toMatch(/guarantor/);
    expect(sponsorProblem(sponsor({ guarantors: [{ name: "A", ownershipPct: 100, fico: 950, citizenship: "us" }] }))).toMatch(/300 and 850/);
  });
  it("ownership that adds up", () => {
    expect(sponsorProblem(sponsor({ guarantors: [{ name: "A", ownershipPct: 70, fico: 700, citizenship: "us" }, { name: "B", ownershipPct: 40, fico: 700, citizenship: "us" }] }))).toMatch(/more than 100%/);
  });
  it("each past deal complete, and an explanation for any yes", () => {
    expect(sponsorProblem(sponsor({ trackRecord: [{ ...deal("x", "2026-01"), address: "" }] }))).toMatch(/past deal/);
    expect(sponsorProblem(sponsor({ trackRecord: [deal("x", "January")] }))).toMatch(/past deal/);
    expect(sponsorProblem(sponsor({ declarations: { ...emptyDeclarations(), felony: true } }))).toMatch(/Explain/);
    expect(sponsorProblem(sponsor({ declarations: { ...emptyDeclarations(), felony: true, explanation: "Expunged in 2010." } }))).toBeNull();
  });
});

describe("the needs list follows the application", () => {
  const ids = (docs: { id: string }[]) => docs.map((item) => item.id);
  it("has the core items for everyone", () => {
    for (const id of ["id", "entity", "ein", "good-standing", "bank", "insurance"]) expect(ids(needsList(app, undefined))).toContain(id);
  });
  it("asks for a contract on a purchase, a payoff on a refinance", () => {
    expect(ids(needsList({ ...app, purpose: "purchase" }, undefined))).toContain("contract");
    expect(ids(needsList({ ...app, purpose: "refi_rt" }, undefined))).toEqual(expect.arrayContaining(["payoff", "hud-original"]));
    expect(ids(needsList({ ...app, purpose: "refi_rt" }, undefined))).not.toContain("contract");
  });
  it("adds the scope and contractor for rehab, plans for a build, leases for a rental", () => {
    expect(ids(needsList({ ...app, rehab: 50_000 }, undefined))).toEqual(expect.arrayContaining(["sow", "contractor"]));
    expect(ids(needsList({ ...app, product: "bridge", rehab: 0 }, undefined))).not.toContain("sow");
    expect(ids(needsList({ ...app, product: "ground_up" }, undefined))).toContain("plans");
    expect(needsList({ ...app, product: "dscr", rehab: 0, occupancy: "tenant" }, undefined).find((item) => item.id === "lease")?.name).toBe("Current leases");
  });
  it("asks to prove the experience listed, the foreign national papers, and an explanation for a yes", () => {
    expect(ids(needsList(app, sponsor()))).toContain("track");
    expect(ids(needsList(app, sponsor({ trackRecord: [] })))).not.toContain("track");
    expect(ids(needsList(app, sponsor({ guarantors: [{ name: "Ana", ownershipPct: 100, fico: 720, citizenship: "foreign" }] })))).toContain("foreign");
    expect(ids(needsList(app, sponsor({ declarations: { ...emptyDeclarations(), lawsuit: true, explanation: "x" } })))).toContain("explanation");
  });
  it("says why each item is needed", () => {
    for (const item of needsList({ ...app, rehab: 1 }, sponsor())) expect(item.note?.length).toBeGreaterThan(10);
  });
});

describe("what the credit officer is shown", () => {
  const e = evaluate(app);
  it("each yes, low ownership, foreign nationals and unverified deals", () => {
    const flags = creditFlags(sponsor({ declarations: { ...emptyDeclarations(), foreclosure: true, explanation: "x" }, guarantors: [{ name: "Ana", ownershipPct: 30, fico: 720, citizenship: "foreign" }] }), e, NOW);
    expect(flags.join("\n")).toMatch(/foreclosure/);
    expect(flags.join("\n")).toMatch(/own only 30%/);
    expect(flags.join("\n")).toMatch(/foreign national/);
    expect(flags.join("\n")).toMatch(/1 of 3 past deals not verified/);
  });
  it("says so when there's no profile at all", () => {
    expect(creditFlags(undefined, e, NOW)[0]).toMatch(/No borrower profile/);
  });
  it("asks every question on its own", () => {
    expect(DECLARATIONS).toHaveLength(7);
    expect(new Set(DECLARATIONS.map((item) => item.key)).size).toBe(7);
  });
});

describe("applying with a profile", () => {
  const book = (): Book => ({ ...demoBook(), deals: demoBook().deals.map((item) => (item.borrowerId === "b-alex" ? { ...item, borrowerId: "borrower-1" } : item)) });
  const borrower = person("borrower-1", ["BORROWER"]);
  const broker = person("broker-user", ["BROKER"], "broker-firm");
  const owner = person("owner", ["ADMIN_OWNER"]);
  const processor = person("proc", ["PROCESSOR"]);
  const underwriter = person("uw", ["UNDERWRITER"]);
  const partner = person("partner-user", ["PARTNER_LENDER"], "p-a");
  const submit = (changes: object = {}) => ({ t: "submitApp" as const, app, address: "1 Real St", city: "Miami", zip: "33101", entityName: "Real LLC", exitStrategy: "Sell", sponsor: sponsor(), ...changes });
  const check = (viewer: Viewer, action: Parameters<typeof reducer>[1], state = book()) => authorize(state, viewer, action, allowedFor(viewer));

  it("a borrower or broker must send the profile; staff may leave it for later", () => {
    expect(check(borrower, submit({ sponsor: undefined }))).toEqual({ error: expect.stringMatching(/guarantors/) });
    expect(check(broker, submit({ sponsor: undefined, client: { name: "Client" } }))).toEqual({ error: expect.stringMatching(/guarantors/) });
    expect(check(owner, submit({ sponsor: undefined, client: { name: "Client" } }))).toHaveProperty("action");
    expect(check(borrower, submit())).toHaveProperty("action");
    expect(check(borrower, submit({ sponsor: sponsor({ guarantors: [] }) }))).toHaveProperty("error");
  });
  it("a browser can't mark its own past deals verified", () => {
    const parsed = parseAction(submit({ sponsor: sponsor({ trackRecord: [deal("a", "2026-03", "flip", true)] }) }));
    expect(parsed && parsed.t === "submitApp" && parsed.sponsor?.trackRecord[0]).not.toHaveProperty("verified");
    const state = reducer(book(), submit({ sponsor: sponsor({ trackRecord: [deal("a", "2026-03", "flip", true)] }) }));
    expect(state.deals[0].sponsor?.trackRecord[0].verified).toBeUndefined();
  });
  it("a new loan is priced on the profile and asks for the documents it needs", () => {
    const state = reducer(book(), submit({ app: { ...app, fico: 850, verifiedDeals: 50 } }));
    expect(state.deals[0].app).toMatchObject({ fico: 690, verifiedDeals: 3 });
    expect(state.deals[0].docs.map((item) => item.id)).toContain("track");
  });
  it("a term sheet waits for the credit sign-off", () => {
    const state = reducer(book(), submit());
    const fresh = { ...state.deals[0], status: "underwriting" as const };
    expect(nextStage(fresh, evaluate(fresh.app))?.blockers).toContain("Credit review isn't signed off (Credit review tab)");
    expect(nextStage({ ...fresh, creditReview: { by: "Uma", at: "", note: "", verifiedDeals: 0 } }, evaluate(fresh.app))?.blockers.join(" ")).not.toMatch(/Credit review/);
  });
  it("signing off prices the loan on the verified deals only", () => {
    let state = reducer(book(), submit());
    const id = state.deals[0].id;
    state = { ...state, deals: state.deals.map((item) => (item.id === id ? { ...item, status: "underwriting" as const } : item)) };
    state = reducer(state, { t: "verifyTrackDeal", dealId: id, trackId: "a", verified: true });
    state = reducer(state, { t: "signOffCredit", dealId: id, by: "Uma", note: "Checked the HUD." });
    const signed = state.deals.find((item) => item.id === id)!;
    expect(signed.creditReview).toMatchObject({ by: "Uma", note: "Checked the HUD.", verifiedDeals: 1 });
    expect(signed.app.verifiedDeals).toBe(1);
  });
  it("processors verify deals, only term sheet authority signs off, and the sign-off locks the profile", () => {
    let state = reducer(book(), submit({ client: { name: "Bonnie", borrowerId: "borrower-1" } }));
    const id = state.deals[0].id;
    expect(check(processor, { t: "verifyTrackDeal", dealId: id, trackId: "a", verified: true }, state)).toHaveProperty("action");
    expect(check(processor, { t: "signOffCredit", dealId: id, by: "x", note: "" }, state)).toHaveProperty("error");
    expect(check(underwriter, { t: "signOffCredit", dealId: id, by: "forged", note: "" }, state)).toMatchObject({ action: { by: "uw name" } });
    expect(check(borrower, { t: "verifyTrackDeal", dealId: id, trackId: "a", verified: true }, state)).toHaveProperty("error");
    state = reducer(state, { t: "signOffCredit", dealId: id, by: "Uma", note: "" });
    expect(check(underwriter, { t: "signOffCredit", dealId: id, by: "x", note: "" }, state)).toEqual({ error: expect.stringMatching(/already/) });
    expect(check(processor, { t: "verifyTrackDeal", dealId: id, trackId: "a", verified: false }, state)).toHaveProperty("error");
    expect(check(borrower, { t: "saveSponsor", dealId: id, sponsor: sponsor() }, state)).toEqual({ error: expect.stringMatching(/signed off/) });
    expect(check(underwriter, { t: "reopenCreditReview", dealId: id }, state)).toHaveProperty("action");
  });
  it("the borrower can add the profile to a loan staff started, which adds what it now needs", () => {
    let state = reducer(book(), { ...submit({ sponsor: undefined }), client: { name: "Bonnie", borrowerId: "borrower-1" } });
    const id = state.deals[0].id;
    expect(state.deals[0].docs.map((item) => item.id)).not.toContain("track");
    expect(check(borrower, { t: "saveSponsor", dealId: id, sponsor: sponsor() }, state)).toHaveProperty("action");
    state = reducer(state, { t: "saveSponsor", dealId: id, sponsor: sponsor() });
    expect(state.deals[0].docs.map((item) => item.id)).toContain("track");
    expect(state.deals[0].app.fico).toBe(690);
    expect(check(person("borrower-2", ["BORROWER"]), { t: "saveSponsor", dealId: id, sponsor: sponsor() }, state)).toHaveProperty("error");
  });
  it("guarantors and declarations never reach a partner who hasn't won the loan", () => {
    const state = { ...book(), deals: book().deals.map((item) => (item.id === "d3" ? { ...item, sponsor: sponsor(), creditReview: { by: "Uma", at: "", note: "internal note", verifiedDeals: 2 } } : item)) };
    const seen = JSON.stringify(scopeBook(state, partner));
    expect(seen).not.toContain("Dana Doe");
    expect(seen).not.toContain("internal note");
  });
  it("the borrower sees their profile but not the credit officer's notes", () => {
    const state = { ...book(), deals: book().deals.map((item) => (item.borrowerId === "borrower-1" ? { ...item, sponsor: sponsor(), creditReview: { by: "Uma", at: "", note: "internal note", verifiedDeals: 2 } } : item)) };
    const seen = JSON.stringify(scopeBook(state, borrower));
    expect(seen).toContain("Dana Doe");
    expect(seen).not.toContain("internal note");
  });
});
