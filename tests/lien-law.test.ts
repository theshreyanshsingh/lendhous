import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { defaultNocExpiry, drawHolds, isFinalDraw, nocProblems, partiesFor, unreleasedHolds, waiverCheckProblem } from "@/lib/lien-law";
import { insuranceChecks, insuranceHold, policiesOf } from "@/lib/insurance";
import { DEMO_PARTNER_ID, type Deal, type LienFile } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const owner = person("owner", ["ADMIN_OWNER"]);
const underwriter = person("uw", ["UNDERWRITER"]);
const processor = person("proc", ["PROCESSOR"]);
const system = person("system", []);
const TODAY = "2026-10-31";
const deal = (b: Book, id = "d2") => b.deals.find((d) => d.id === id)!;
const drawOf = (b: Book, id = "draw-1") => b.draws.find((d) => d.id === id)!;
/** The demo's fix and flip with its first draw approved for $10,000, waiting to be released. */
const approved = (): Book => { const b = demoBook(); return { ...b, draws: b.draws.map((d) => (d.id === "draw-1" ? { ...d, status: "approved" as const, approved: 10_000, approvers: ["Cam"] } : d)) }; };
const withLien = (lien: Partial<LienFile>, extra: Partial<Deal> = {}): Deal => ({ ...deal(demoBook()), ...extra, lienFile: { notices: [], ...deal(demoBook()).lienFile, ...lien } });
const received = (partyKey = "contractor", kind: "progress" | "final" = "progress"): BookAction => ({ t: "lienWaiverReceived", drawId: "draw-1", partyKey, kind, fileName: "waiver.pdf", documentId: "doc1", by: "Alex" });
const checked = (b: Book, partyKey = "contractor"): BookAction => ({ t: "checkLienWaiver", drawId: "draw-1", waiverId: drawOf(b).waivers!.filter((item) => item.partyKey === partyKey).at(-1)!.id, amount: 10_000, throughOn: "2026-10-28", conditional: true, by: "x" });

describe("the Notice of Commencement (Fla. Stat. 713.13)", () => {
  it("must be on file, name the lender, and come after the mortgage", () => {
    const noc = deal(demoBook()).lienFile!.noc!;
    expect(nocProblems(deal(demoBook()), TODAY)).toEqual([]);
    expect(nocProblems(withLien({ noc: undefined }), TODAY)).toEqual([expect.stringMatching(/before construction money goes out \(Fla\. Stat\. 713\.13\(7\)\)/)]);
    expect(nocProblems(withLien({ noc: { ...noc, lenderNamed: false } }), TODAY)).toEqual([expect.stringMatching(/name LendHous/)]);
    expect(nocProblems(withLien({ mortgageRecordedOn: "2026-09-10" }), TODAY)).toEqual([expect.stringMatching(/before the mortgage .* \(713\.07\)/)]);
    expect(nocProblems(withLien({ mortgageRecordedOn: noc.recordedOn }), TODAY)).toEqual([expect.stringMatching(/same day/)]);
    expect(nocProblems(withLien({ mortgageRecordedOn: noc.recordedOn, noc: { ...noc, mortgageFirst: true } }), TODAY)).toEqual([]);
    expect(nocProblems(withLien({ mortgageRecordedOn: undefined }), TODAY)).toEqual([expect.stringMatching(/recording date isn't on file/)]);
  });
  it("is void if work doesn't start within 90 days, and runs out after its end date", () => {
    const noc = deal(demoBook()).lienFile!.noc!;
    // Recorded September 5: work can start through December 4, the 90th day.
    expect(nocProblems(withLien({ noc: { ...noc, commencedOn: undefined } }), "2026-12-05")).toEqual([expect.stringMatching(/within 90 days .* void \(713\.13\(2\)\)/)]);
    expect(nocProblems(withLien({ noc: { ...noc, commencedOn: undefined } }), "2026-12-04")).toEqual([]);
    expect(nocProblems(withLien({ noc: { ...noc, commencedOn: "2026-12-10" } }), "2026-12-10")).toEqual([expect.stringMatching(/void/)]);
    expect(nocProblems(withLien({ noc: { ...noc, commencedOn: "2026-09-01" } }), TODAY)).toEqual([expect.stringMatching(/started before the notice was recorded/)]);
    expect(nocProblems(withLien({ noc: { ...noc, expiresOn: "2026-10-30" } }), TODAY)).toEqual([expect.stringMatching(/expired on October 30, 2026\..*\(713\.13\(6\)\)/)]);
    expect(defaultNocExpiry("2026-09-05")).toBe("2027-09-05");
    expect(defaultNocExpiry("2028-02-29")).toBe("2029-03-01");
  });
});

describe("insurance", () => {
  it("holds draws once a policy lapses, and warns 30 days ahead and on lapse, once each", () => {
    const b = demoBook();
    expect(insuranceHold(deal(b), TODAY)).toBeNull();
    expect(insuranceHold(deal(b, "d13"), TODAY)).toMatch(/hazard \(property\) policy lapsed on October 15, 2026/);
    expect(insuranceHold({ ...deal(b), insurance: { policies: [] } }, TODAY)).toMatch(/No builder's risk or hazard policy/);
    expect(insuranceChecks(b.deals, TODAY)).toEqual({ remind: [{ dealId: "d9", kind: "hazard" }], lapsed: [{ dealId: "d13", kind: "hazard" }] });
    const nightly: BookAction = { t: "checkInsurance", asOf: TODAY };
    expect(check(b, owner, nightly)).toHaveProperty("error");
    const { after, action } = run(b, system, nightly, true);
    expect(policiesOf(deal(after, "d9"))[0]).toMatchObject({ remindedOn: TODAY });
    expect(policiesOf(deal(after, "d13"))[0]).toMatchObject({ lapseNoticeOn: TODAY });
    expect(alertsFor(b, after, action).map((alert) => [alert.to, alert.event])).toEqual([["borrower", "insurance.expiring"], ["team", "insurance.expiring"], ["borrower", "insurance.lapsed"], ["team", "insurance.lapsed"]]);
    expect(reducer(after, nightly)).toBe(after);
  });
});

describe("releasing a draw", () => {
  it("waits for the contractor's progress waiver, checked against the statutory form", () => {
    const b = approved();
    expect(drawHolds(deal(b), drawOf(b), TODAY)).toEqual([expect.stringMatching(/Construction \(FAKE\)'s progress lien waiver \(Fla\. Stat\. 713\.20\)/)]);
    expect(check(b, owner, { t: "releaseDraw", drawId: "draw-1" })).toMatchObject({ error: expect.stringMatching(/progress lien waiver/) });
    expect(reducer(b, { t: "releaseDraw", drawId: "draw-1" })).toBe(b);
    expect(check(b, owner, received())).toHaveProperty("error");
    expect(parseAction(received())).toBeNull();
    const sent = run(b, system, received(), true);
    expect(alertsFor(b, sent.after, sent.action)).toMatchObject([{ to: "team", event: "lien.waiver_received", body: expect.stringMatching(/progress lien waiver from .*Construction/) }]);
    expect(drawHolds(deal(sent.after), drawOf(sent.after), TODAY)).toHaveLength(1);
    expect(check(sent.after, processor, checked(sent.after))).toHaveProperty("error");
    expect(check(sent.after, owner, { ...checked(sent.after), throughOn: "2026-11-05" } as BookAction)).toMatchObject({ error: expect.stringMatching(/after today \(Fla\. Stat\. 713\.20\(2\)\)/) });
    const ok = run(sent.after, owner, checked(sent.after)).after;
    expect(drawOf(ok).waivers![0].checked).toMatchObject({ amount: 10_000, throughOn: "2026-10-28", conditional: true, by: "owner name" });
    expect(drawHolds(deal(ok), drawOf(ok), TODAY)).toEqual([]);
    const released = run(ok, owner, { t: "releaseDraw", drawId: "draw-1" }).after;
    expect(drawOf(released).status).toBe("funded");
  });
  it("needs a waiver from every lienor who served a notice to owner, who the borrower hears about", () => {
    const b = approved();
    const noticed = run(b, owner, { t: "addNoticeToOwner", dealId: "d2", lienor: "Bay Plumbing (FAKE)", role: "subcontractor", servedOn: "2026-10-20", by: "x" });
    expect(alertsFor(b, noticed.after, noticed.action)).toMatchObject([{ to: "borrower", event: "lien.notice_to_owner", body: expect.stringMatching(/Bay Plumbing/) }]);
    const notice = deal(noticed.after).lienFile!.notices[0];
    expect(partiesFor(deal(noticed.after).lienFile, TODAY).map((party) => party.name)).toEqual([expect.stringMatching(/Construction/), "Bay Plumbing (FAKE)"]);
    expect(partiesFor(deal(noticed.after).lienFile, "2026-10-19")).toHaveLength(1);
    let after = run(noticed.after, system, received(), true).after;
    after = run(after, owner, checked(after)).after;
    expect(drawHolds(deal(after), drawOf(after), TODAY)).toEqual([expect.stringMatching(/Bay Plumbing \(FAKE\)'s progress lien waiver/)]);
    after = run(after, system, received(notice.id), true).after;
    const reject: BookAction = { t: "rejectLienWaiver", drawId: "draw-1", waiverId: drawOf(after).waivers!.at(-1)!.id, reason: "It isn't on the statutory form.", by: "x" };
    const rejected = run(after, owner, reject);
    expect(alertsFor(after, rejected.after, rejected.action)).toMatchObject([{ to: "borrower", event: "lien.waiver_rejected", body: expect.stringMatching(/Bay Plumbing .* statutory form/) }]);
    expect(drawHolds(deal(rejected.after), drawOf(rejected.after), TODAY)).toHaveLength(1);
    after = run(rejected.after, system, received(notice.id), true).after;
    after = run(after, owner, checked(after, notice.id)).after;
    expect(unreleasedHolds(deal(after), drawOf(after), TODAY)).toEqual([]);
  });
  it("on the last draw needs final waivers and the contractor's final payment affidavit, with everyone paid", () => {
    const b = run(approved(), owner, { t: "setFinalDraw", drawId: "draw-1", final: true }).after;
    expect(isFinalDraw(deal(b), drawOf(b))).toBe(true);
    let after = run(b, system, received("contractor", "final"), true).after;
    after = run(after, owner, { t: "checkLienWaiver", drawId: "draw-1", waiverId: drawOf(after).waivers![0].id, amount: 10_000, conditional: true, by: "x" }).after;
    expect(drawHolds(deal(after), drawOf(after), TODAY)).toEqual([expect.stringMatching(/final payment affidavit \(713\.06\(3\)\(d\)\)/)]);
    after = run(after, system, { t: "affidavitReceived", drawId: "draw-1", fileName: "affidavit.pdf", by: "Alex" }, true).after;
    const unpaid = run(after, owner, { t: "checkAffidavit", drawId: "draw-1", unpaidLienors: true, by: "x" }).after;
    expect(drawHolds(deal(unpaid), drawOf(unpaid), TODAY)).toEqual([expect.stringMatching(/lienors who haven't been paid in full/)]);
    const paid = run(after, owner, { t: "checkAffidavit", drawId: "draw-1", unpaidLienors: false, by: "x" }).after;
    expect(drawHolds(deal(paid), drawOf(paid), TODAY)).toEqual([]);
    // A draw that uses up the holdback is the last one whether marked or not.
    const whole = { ...approved(), draws: approved().draws.map((d) => (d.id === "draw-1" ? { ...d, approved: (deal(approved()).scope ?? []).reduce((sum, line) => sum + line.budget - line.released, 0) } : d)) };
    expect(isFinalDraw(deal(whole), drawOf(whole))).toBe(true);
  });
  it("can go out past the holds only on an owner's say, with a reason, and only past the holds standing then", () => {
    const b = approved();
    const override = (reason: string): BookAction => ({ t: "overrideDrawHolds", drawId: "draw-1", reason, by: "x" });
    expect(check(b, underwriter, override("Contractor is the borrower's own company"))).toHaveProperty("error");
    expect(check(b, owner, override(" "))).toMatchObject({ error: expect.stringMatching(/why/) });
    const { after, action } = run(b, owner, override("Contractor's waiver is signed and on its way; attorney agreed (test)"));
    expect(drawOf(after).override).toMatchObject({ by: "owner name", holds: [expect.stringMatching(/progress lien waiver/)] });
    expect(alertsFor(b, after, action)).toMatchObject([{ to: "team", event: "lien.override" }]);
    expect(unreleasedHolds(deal(after), drawOf(after), TODAY)).toEqual([]);
    // A hold that appears afterwards isn't covered.
    const lapsed = { ...after, deals: after.deals.map((d) => (d.id === "d2" ? { ...d, insurance: { ...d.insurance!, policies: d.insurance!.policies.map((policy) => ({ ...policy, expiresOn: "2026-10-01" })) } } : d)) };
    expect(unreleasedHolds(deal(lapsed), drawOf(lapsed), TODAY)).toEqual([expect.stringMatching(/lapsed/)]);
    expect(check(lapsed, owner, { t: "releaseDraw", drawId: "draw-1" })).toHaveProperty("error");
    expect(run(after, owner, { t: "releaseDraw", drawId: "draw-1" }).after.draws.find((d) => d.id === "draw-1")!.status).toBe("funded");
  });
});

describe("the lien file", () => {
  it("is kept by the team, checked as it's saved, and shown to the borrower without an owner's override", () => {
    const b = demoBook();
    const save = (changes: Partial<Extract<BookAction, { t: "saveLienFile" }>> = {}): BookAction => ({ t: "saveLienFile", dealId: "d2", contractor: "Sample Builders", noc: { recordedOn: "2026-09-05", reference: "OR 1/2", expiresOn: "2027-09-05", lenderNamed: true }, by: "x", ...changes });
    expect(check(b, processor, save())).toHaveProperty("action");
    expect(check(b, person("b", ["BORROWER"]), save())).toHaveProperty("error");
    expect(check(b, processor, save({ contractor: " " }))).toMatchObject({ error: expect.stringMatching(/contractor/) });
    expect(check(b, processor, save({ noc: { recordedOn: "2026-11-05", reference: "", expiresOn: "2027-11-05", lenderNamed: true } }))).toMatchObject({ error: expect.stringMatching(/today or earlier/) });
    expect(check(b, processor, { ...save(), dealId: "d1" } as BookAction)).toMatchObject({ error: expect.stringMatching(/accepted term sheet/) });
    expect(deal(run(b, processor, save()).after).lienFile).toMatchObject({ contractor: "Sample Builders", noc: { recordedOn: "2026-09-05", by: "proc name" } });
    const overridden = run(approved(), owner, { t: "overrideDrawHolds", drawId: "draw-1", reason: "test", by: "x" }).after;
    const mine = scopeBook(overridden, person(deal(overridden).borrowerId, ["BORROWER"]));
    expect(mine.deals.find((d) => d.id === "d2")!.lienFile!.contractor).toMatch(/Construction/);
    expect(mine.draws.find((d) => d.id === "draw-1")!.override).toBeUndefined();
    expect(scopeBook(b, person(DEMO_PARTNER_ID, ["PARTNER_LENDER"])).deals.every((d) => !d.lienFile)).toBe(true);
  });
  it("won't take a waiver for work not done yet, or for nothing", () => {
    const b = run(approved(), system, received(), true).after;
    const waiver = drawOf(b).waivers![0];
    expect(waiverCheckProblem(waiver, 0, "2026-10-28", TODAY)).toMatch(/amount/);
    expect(waiverCheckProblem(waiver, 100, undefined, TODAY)).toMatch(/work through/);
    expect(waiverCheckProblem(waiver, 100, "2026-10-28", TODAY)).toBeNull();
  });
});
