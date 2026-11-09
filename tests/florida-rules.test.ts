import { afterEach, describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { deskProblem, DESK, setDrawFees, toSend } from "@/lib/draw-review";
import { evaluate } from "@/lib/engine";
import { citizensFlood, citizensFloodMin, coverageWithInsurance, insuranceWarnings, nfipBanner, nfipPolicyProblem, nfipStatus, setNfipThrough } from "@/lib/florida-insurance";
import { closingCostLines, closingTaxes, deedStamps, increaseTaxes, intangibleTax, mortgageStamps } from "@/lib/florida-taxes";
import { coverNeeds, insuranceGaps, policyProblem } from "@/lib/insurance";
import { monthJournal } from "@/lib/journal";
import type { Deal, DrawPhoto, InsurancePolicy } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { bitsApart, heldPhotos, reusedPhotos, samePicture } from "@/lib/photo-checks";
import { cashToCloseParts, indicativeTerms, type QuoteDeal } from "@/lib/quote";
import { sheetContent } from "@/lib/term-sheets";
import { currentPricing } from "@/lib/pricing-versions";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const policy = (change: Partial<InsurancePolicy>): InsurancePolicy => ({ kind: "hazard", carrier: "Citizens Property Insurance Corporation", policy: "C-1", expiresOn: "2027-03-01", coverage: 450_000, windIncluded: true, mortgagee: true, by: "x", at: "2026-03-01T12:00:00Z", ...change });
const withPolicies = (d: Deal, policies: InsurancePolicy[], flood = { sfha: false, zone: "X", by: "x", at: "2026-03-01T12:00:00Z" }): Deal => ({ ...d, insurance: { policies, flood } });

afterEach(() => { setNfipThrough("2026-12-11"); setDrawFees({ inspector: 0, desk: 0 }); });

describe("Citizens' flood requirement (Fla. Stat. 627.351(6)(aa))", () => {
  const rental = deal(demoBook(), "d12");
  it("phases in by the dwelling's coverage, to every policy from January 1, 2027", () => {
    expect([citizensFloodMin("2023-12-31"), citizensFloodMin("2024-06-01"), citizensFloodMin("2025-06-01"), citizensFloodMin("2026-06-01"), citizensFloodMin("2027-01-01")]).toEqual([null, 600_000, 500_000, 400_000, 0]);
  });
  it("holds a zone X loan with a big Citizens policy, and warns about a smaller one before it renews", () => {
    const big = withPolicies(rental, [policy({})]);
    expect(citizensFlood(big, big.insurance!.policies)).toMatchObject({ now: true, atRenewal: true });
    expect(coverNeeds(big).find((need) => need.key === "flood")).toMatchObject({ met: false, note: expect.stringMatching(/Citizens requires flood insurance/) });
    expect(insuranceGaps(big, "2026-11-09")).toContain("No flood policy on file (Closing tab)");
    const small = withPolicies(rental, [policy({ coverage: 300_000 })]);
    expect(citizensFlood(small, small.insurance!.policies)).toMatchObject({ now: false, atRenewal: true });
    expect(coverNeeds(small).find((need) => need.key === "flood")!.met).toBe(true);
    expect(insuranceWarnings(small, small.insurance!.policies, "2026-11-09", 1).find((warning) => warning.key === "citizens-renewal")!.text).toMatch(/when this policy renews on March 1, 2027/);
    // A flood policy on file meets it.
    const covered = withPolicies(rental, [policy({}), policy({ kind: "flood", carrier: "Sample Flood", windIncluded: undefined, program: "private" })]);
    expect(coverNeeds(covered).find((need) => need.key === "flood")!.met).toBe(true);
  });
  it("doesn't reach a policy without wind, another carrier, or a condo unit's own policy", () => {
    for (const exempt of [withPolicies(rental, [policy({ windIncluded: false })]), withPolicies(rental, [policy({ carrier: "Sample Mutual" })]), withPolicies({ ...rental, app: { ...rental.app, propertyType: "condo" } }, [policy({})])]) {
      expect(citizensFlood(exempt, exempt.insurance!.policies)).toBeNull();
    }
    // A Citizens wind-only policy carries wind, so it does.
    const wind = withPolicies(rental, [policy({ carrier: "Sample Mutual", windIncluded: false }), policy({ kind: "windstorm", windIncluded: undefined })]);
    expect(citizensFlood(wind, wind.insurance!.policies)?.now).toBe(true);
  });
  it("shows a rental's coverage if Citizens raises a non-primary premium the most it may", () => {
    const loan = withPolicies(deal(demoBook(), "d10"), [policy({})]);
    const warning = insuranceWarnings(loan, loan.insurance!.policies, "2026-11-09", 1).find((item) => item.key === "citizens-rise")!;
    const now = coverageWithInsurance(loan, loan.app.insuranceAnnual!);
    const stressed = coverageWithInsurance(loan, loan.app.insuranceAnnual! * 1.5);
    expect(now).toBeCloseTo(evaluate(loan.app).dscr!, 4);
    expect(stressed).toBeLessThan(now);
    expect(warning.text).toContain(`from ${now.toFixed(2)} to ${stressed.toFixed(2)}`);
  });
  it("flags a condo association insured by Citizens, which can be moved to surplus lines from 2027", () => {
    const b = demoBook();
    const condo = { ...deal(b, "d12"), app: { ...deal(b, "d12").app, propertyType: "condo" as const } };
    expect(insuranceWarnings(condo, [], "2026-11-09", 1).map((item) => item.key)).toContain("association");
    const recorded = { ...condo, insurance: { policies: [], association: { carrier: "Citizens", citizens: true, by: "x", at: "x" } } };
    expect(insuranceWarnings(recorded, [], "2026-11-09", 1).find((item) => item.key === "surplus-lines")!.text).toMatch(/ch. 2026-150/);
    const owner = person("own", ["ADMIN_OWNER"]);
    expect(check(b, owner, { t: "saveAssociationPolicy", dealId: "d12", carrier: "Citizens", citizens: true, by: "x" })).toEqual({ error: "Only a condo has an association's policy to record." });
  });
});

describe("the NFIP's authorization", () => {
  const loan = deal(demoBook(), "d12");
  const nfip = (expiresOn: string, program?: "nfip" | "private") => policy({ kind: "flood", carrier: "Sample Flood", expiresOn, windIncluded: undefined, ...(program ? { program } : {}) });
  it("warns from 30 days before it ends, and after it holds a closing on an NFIP policy that can't have been written", () => {
    setNfipThrough("2026-12-11");
    expect(nfipStatus("2026-11-09")).toMatchObject({ lapsed: false, soon: false });
    expect(nfipStatus("2026-11-20")).toMatchObject({ lapsed: false, soon: true });
    expect(nfipStatus("2026-12-12")).toMatchObject({ lapsed: true });
    const zoned = withPolicies(loan, [policy({ carrier: "Sample Mutual" })], { sfha: true, zone: "AE", by: "x", at: "x" });
    expect(insuranceWarnings(zoned, zoned.insurance!.policies, "2026-11-20", 1).map((item) => item.key)).toContain("nfip-soon");
    const started = [nfip("2027-12-20", "nfip")];
    expect(nfipPolicyProblem(started, "2026-11-20")).toBeNull();
    expect(nfipPolicyProblem(started, "2026-12-21")).toMatch(/FEMA can't have issued or renewed a flood policy starting December 20, 2026/);
    expect(nfipPolicyProblem([nfip("2027-12-20", "private")], "2026-12-21")).toBeNull();
    const held = withPolicies(loan, [policy({ carrier: "Sample Mutual" }), ...started], { sfha: true, zone: "AE", by: "x", at: "x" });
    expect(insuranceGaps(held, "2026-12-21").some((gap) => gap.includes("private flood policy"))).toBe(true);
    // Congress extends it: an owner moves the date in Settings, and the hold lifts.
    setNfipThrough("2027-09-30");
    expect(insuranceGaps(held, "2026-12-21").some((gap) => gap.includes("private flood policy"))).toBe(false);
  });
  it("asks which program a flood policy is from, and tells the team how many loans rely on it", () => {
    expect(policyProblem(loan, { kind: "flood", carrier: "Sample Flood", policy: "F", expiresOn: "2027-06-01" })).toBe("Say whether the flood policy is from the NFIP or a private insurer.");
    expect(policyProblem(loan, { kind: "flood", carrier: "Sample Flood", policy: "F", expiresOn: "2027-06-01", program: "private" })).toBeNull();
    const b = demoBook();
    expect(nfipBanner(b.deals, "2026-11-09")).toBeNull();
    expect(nfipBanner(b.deals, "2026-11-20")).toMatch(/authorized only through December 11, 2026, 21 days away/);
    expect(nfipBanner(b.deals, "2026-12-12")).toMatch(/^The NFIP's authorization ended December 11, 2026: FEMA can't sell or renew flood policies until Congress acts. 1 loan carry an NFIP policy/);
  });
});

describe("Florida's taxes at closing", () => {
  it("are doc stamps of $0.35 per $100 or part of it and 0.2% intangible tax on the mortgage, and the deed's stamps", () => {
    expect([mortgageStamps(300_000), mortgageStamps(300_001), intangibleTax(300_000), intangibleTax(300_000, 0.5)]).toEqual([1_050, 1_050.35, 600, 300]);
    expect([deedStamps(400_000, "Broward", "sfr"), deedStamps(400_000, "Miami-Dade", "sfr"), deedStamps(400_000, "Miami-Dade", "2_4")]).toEqual([2_800, 2_400, 4_200]);
    const app = { state: "FL", county: "Broward", purpose: "purchase" as const, propertyType: "sfr" as const, purchasePrice: 400_000 };
    expect(closingTaxes(app, 300_000)).toEqual({ stamps: 1_050, intangible: 600, total: 1_650, deed: 2_800 });
    expect(closingTaxes({ ...app, purpose: "refi_rt" }, 300_000)).toEqual({ stamps: 1_050, intangible: 600, total: 1_650 });
    expect(closingTaxes({ ...app, state: "GA" }, 300_000)).toBeNull();
    expect(increaseTaxes(5_000)).toEqual({ stamps: 17.5, intangible: 10 });
  });
  it("are split out of the estimate's closing costs without changing its total", () => {
    const app = { state: "FL", county: "Broward", purpose: "purchase" as const, propertyType: "sfr" as const, purchasePrice: 400_000 };
    const lines = closingCostLines(app, 300_000, 8_000, 0.02);
    expect(lines.map((line) => line.amount)).toEqual([1_050, 600, 6_350]);
    expect(lines[2].label).toBe("Title, recording and settlement (the rest of about 2%)");
    expect(closingCostLines({ ...app, state: "GA" }, 300_000, 8_000, 0.02)).toEqual([{ label: "Closing costs, about 2% (title, recording, taxes)", amount: 8_000 }]);
  });
  it("show on a Florida quote and term sheet", () => {
    const quote: QuoteDeal = { loanType: "fix_flip", purpose: "purchase", propertyType: "sfr", address: { street: "1 Sample St", city: "Fort Lauderdale", state: "FL", zip: "33311", county: "Broward" }, purchasePrice: 300_000, rehab: 60_000, arv: 480_000, experience: "3_5", creditBand: "720_759", citizenship: "us", exit: "sell", fundingDate: "2026-12-01", comps: [] } as unknown as QuoteDeal;
    const terms = indicativeTerms(quote, currentPricing());
    if (!terms) throw new Error("no terms");
    const parts = cashToCloseParts(quote, terms, currentPricing());
    expect(parts.some((part) => part.label.startsWith("Florida doc stamps"))).toBe(true);
    expect(parts.reduce((sum, part) => sum + part.amount, 0)).toBeCloseTo(terms.cashToClose, 2);
    const b = demoBook();
    const sheet = deal(b, "d4").termSheets!.at(-1)!;
    const rows = sheetContent(deal(b, "d4"), sheet).terms;
    expect(rows.find(([label]) => label === "Florida taxes on the mortgage")![1]).toMatch(/^Doc stamps \$[\d,.]+ and intangible tax \$[\d,.]+, paid when it's recorded/);
  });
});

describe("photos sent before", () => {
  const near = (hash: string, flips: number) => hash.slice(0, 16 - flips) + hash.slice(16 - flips).split("").map((c) => (parseInt(c, 16) ^ 1).toString(16)).join("");
  const hash = "8f3a5c7e9b1d2f40";
  it("match by the same file or nearly the same picture, but not a plain wall", () => {
    expect(bitsApart(hash, near(hash, 3))).toBe(3);
    expect(samePicture({ sha256: "a".repeat(64) }, { sha256: "a".repeat(64) })).toBe(true);
    expect(samePicture({ dhash: hash }, { dhash: near(hash, 6) })).toBe(true);
    expect(samePicture({ dhash: hash }, { dhash: near(hash, 8) })).toBe(false);
    expect(samePicture({ dhash: "0000000000000001" }, { dhash: "0000000000000000" })).toBe(false);
  });
  it("are found across draws, loans and photo links, and twice in one draw", () => {
    const b = demoBook();
    const draws = [{ ...b.draws[0], id: "old-draw", dealId: "d9", requestedAt: "2026-10-03T12:00:00Z", linePhotos: [{ id: "p-old", scopeId: "plumbing", name: "pipes.jpg", at: "2026-10-03T12:00:00Z", dhash: hash } as DrawPhoto] }];
    const book = { ...b, draws: [...b.draws, ...draws] };
    expect(heldPhotos(book).map((photo) => photo.id)).toContain("p-old");
    const reused = reusedPhotos(book, [{ id: "new-1", dhash: near(hash, 2) }, { id: "new-2", sha256: "b".repeat(64) }, { id: "new-3", sha256: "b".repeat(64) }]);
    expect(reused.map((item) => [item.photoId, item.earlier.map((photo) => `${photo.loanNumber} ${photo.on}`), item.twice])).toEqual([["new-1", ["LH-DEMO-1009 2026-10-03"], false], ["new-2", [], true], ["new-3", [], true]]);
  });
});

describe("a photo review instead of an inspector's visit", () => {
  const borrower = (b: Book) => person(deal(b, "d17").borrowerId, ["BORROWER"]);
  const staff = person("uma", ["UNDERWRITER"]);
  const photos = (b: Book, count = 2, change: Partial<DrawPhoto> = {}) => ["plumbing", "exterior"].flatMap((scopeId) => Array.from({ length: count }, (_, n) => ({ scopeId, name: `${scopeId}-${n}.jpg`, takenAt: new Date(Date.now() - 3_600_000).toISOString(), lat: deal(b, "d17").geo!.lat, lng: deal(b, "d17").geo!.lng, dhash: ["9c3a5e1f7b2d4086", "35ac91e07f4b2d68", "c8e1374fa95b2d06", "71f04ec9b2a85d3e"][(scopeId === "plumbing" ? 0 : 2) + n], ...change })));
  const ask = (b: Book, change: Partial<Extract<BookAction, { t: "requestDraw" }>> = {}): BookAction => ({ t: "requestDraw", dealId: "d17", by: "x", note: "Plumbing and siding done", contact: "Logan 954-555-0100", photos: [], lines: [{ scopeId: "plumbing", requested: 3_000, claimedPct: 0.5 }, { scopeId: "exterior", requested: 4_000, claimedPct: 0.5 }], linePhotos: photos(b), path: "desk", ...change });

  it("is offered for a modest draw of a single home with located, recent photos of each line not sent before", () => {
    const b = demoBook();
    const d17 = deal(b, "d17");
    const lines = [{ scopeId: "plumbing", requested: 3_000 }, { scopeId: "exterior", requested: 4_000 }];
    const at = new Date().toISOString();
    expect(deskProblem(b, d17, lines, photos(b), at)).toBeNull();
    expect(deskProblem(b, d17, [{ scopeId: "plumbing", requested: DESK.maxDraw + 1 }], photos(b), at)).toMatch(/up to \$35,000/);
    expect(deskProblem(b, d17, lines, photos(b, 1), at)).toMatch(/at least 2 photos of each line/);
    expect(deskProblem(b, d17, lines, photos(b, 2, { lat: undefined, lng: undefined }), at)).toMatch(/phone's location/);
    expect(deskProblem(b, d17, lines, photos(b, 2, { lat: 26.9 }), at)).toMatch(/weren't taken at the property/);
    expect(deskProblem(b, { ...d17, app: { ...d17.app, propertyType: "2_4" } }, lines, photos(b), at)).toMatch(/2 to 4 units/);
    expect(deskProblem(b, { ...d17, status: "servicing_delinquent" }, lines, photos(b), at)).toMatch(/behind/);
    expect(deskProblem(b, d17, [{ scopeId: "plumbing", requested: 65_000 }], photos(b), at)).toMatch(/up to|last draw/);
    const sent = run(b, borrower(b), ask(b)).after;
    expect(deskProblem(sent, d17, lines, photos(b), at)).toMatch(/match photos already sent/);
  });
  it("carries its own fee, kept from the money released, and the team reads the photos instead of an inspector", () => {
    setDrawFees({ inspector: 250, desk: 100 });
    const b = demoBook();
    expect(check(b, borrower(b), ask(b, { linePhotos: photos(b, 1) }))).toMatchObject({ error: expect.stringMatching(/at least 2 photos/) });
    const asked = run(b, borrower(b), ask(b));
    let after = asked.after;
    const draw = after.draws.find((item) => item.dealId === "d17")!;
    expect(draw).toMatchObject({ path: "desk", fee: 100, status: "submitted" });
    expect(alertsFor(b, after, asked.action).find((alert) => alert.to === "team")!.body).toMatch(/It's for a photo review/);
    expect(check(after, staff, { t: "deskReview", drawId: draw.id, observed: { plumbing: 0.5 }, note: "", by: "x" })).toEqual({ error: "Enter how far along each line is, from the photos." });
    after = run(after, staff, { t: "deskReview", drawId: draw.id, observed: { plumbing: 0.5, exterior: 0.5 }, note: "Matches the photos", by: "x" }).after;
    const reviewed = after.draws.find((item) => item.id === draw.id)!;
    expect(reviewed).toMatchObject({ status: "inspected", inspection: { method: "desk", by: "uma name" } });
    after = run(after, staff, { t: "approveDrawRequest", drawId: draw.id, by: "x" }).after;
    const approved = after.draws.find((item) => item.id === draw.id)!;
    expect(toSend(approved)).toBeCloseTo((approved.approved ?? 0) - 100, 2);
    // Released past the lien-law waiver this sample contractor hasn't sent, as an owner can with a reason.
    const owner = person("own", ["ADMIN_OWNER"]);
    after = run(after, owner, { t: "overrideDrawHolds", drawId: draw.id, reason: "Test release", by: "x" }).after;
    const release: BookAction = { t: "releaseDraw", drawId: draw.id };
    const released = run(after, owner, release).after;
    expect(alertsFor(after, released, release).find((alert) => alert.to === "borrower")!.body).toMatch(/is on its way to you after the \$100\.00 photo review fee/);
    const rows = monthJournal(released, released.draws.find((item) => item.id === draw.id)!.fundedAt!.slice(0, 7));
    expect(rows.find((row) => row["Account Name"] === "Draw inspection fee income")).toMatchObject({ Credits: 100 });
  });
  it("goes on to an inspector when the team says why, at the inspector's fee, and the borrower hears", () => {
    setDrawFees({ inspector: 250, desk: 100 });
    const b = demoBook();
    const { after } = run(b, borrower(b), ask(b));
    const draw = after.draws.find((item) => item.dealId === "d17")!;
    expect(check(after, staff, { t: "sendInspector", drawId: draw.id })).toEqual({ error: "Say why it needs an inspector's visit: the borrower is told." });
    const send: BookAction = { t: "sendInspector", drawId: draw.id, reason: "The photos don't show the new water heater." };
    const sent = run(after, staff, send);
    expect(sent.after.draws.find((item) => item.id === draw.id)).toMatchObject({ status: "inspecting", path: "inspector", fee: 250, escalated: { by: "uma name", reason: "The photos don't show the new water heater." } });
    expect(alertsFor(after, sent.after, sent.action).find((alert) => alert.to === "borrower")).toMatchObject({ event: "draw.escalated", body: expect.stringMatching(/The inspection fee of \$250\.00 comes out of the draw/) });
  });
  it("isn't chosen for a draw that doesn't qualify: that goes to an inspector, as before", () => {
    const b = demoBook();
    const { after } = run(b, borrower(b), ask(b, { path: undefined }));
    expect(after.draws.find((item) => item.dealId === "d17")).toMatchObject({ path: "inspector" });
    expect(after.draws.find((item) => item.dealId === "d17")!.fee).toBeUndefined();
  });
});
