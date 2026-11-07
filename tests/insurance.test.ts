import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { coverageShort, coverNeeds, insuranceChecks, insuranceGaps, insuranceHold, policiesOf, renewalProblem } from "@/lib/insurance";
import { drawHolds } from "@/lib/lien-law";
import { nextStage } from "@/lib/loan-stages";
import { BORROWER_ID, DEMO_PARTNER_ID, type Deal, type InsurancePolicy } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const owner = person("owner", ["ADMIN_OWNER"]);
const processor = person("proc", ["PROCESSOR"]);
const servicer = person("svc", ["SERVICER"]);
const borrower = person(BORROWER_ID, ["BORROWER"]);
const partner = person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID);
const system = person("system", []);
const TODAY = "2026-10-31";
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const withDeal = (b: Book, id: string, change: (d: Deal) => Deal): Book => ({ ...b, deals: b.deals.map((d) => (d.id === id ? change(d) : d)) });
const policy = (changes: Partial<InsurancePolicy> = {}): InsurancePolicy => ({ kind: "hazard", carrier: "Test Mutual", policy: "TM-1", expiresOn: "2027-06-30", windIncluded: true, mortgagee: true, by: "x", at: "y", ...changes });
const save = (dealId: string, changes: Partial<Extract<BookAction, { t: "saveInsurance" }>> = {}): BookAction => ({ t: "saveInsurance", dealId, kind: "hazard", carrier: "Gulf Mutual", policy: "GM-9", expiresOn: "2027-08-01", coverage: 600_000, windIncluded: true, mortgagee: true, by: "browser says", ...changes });
const renewal = (dealId: string, changes: Partial<Extract<BookAction, { t: "insuranceRenewal" }>> = {}): BookAction => ({ t: "insuranceRenewal", dealId, kind: "hazard", carrier: "Sample Mutual (FAKE)", policy: "SM-NEW", expiresOn: "2027-11-20", fileName: "declarations.pdf", documentId: "doc-ren", by: "Alex Sample (FAKE)", ...changes });

describe("what each loan has to have covered", () => {
  it("asks for the building, wind and the flood zone, and flood cover only in a special flood hazard area", () => {
    const bare = { ...deal(demoBook(), "d3"), insurance: undefined };
    expect(coverNeeds(bare).map((need) => [need.key, need.met])).toEqual([["property", false], ["wind", false], ["flood", false]]);
    expect(insuranceGaps(bare, TODAY)).toEqual(["No hazard or builder's risk policy on file (Closing tab)", "No windstorm policy on file (Closing tab)", "The flood zone isn't recorded (Closing tab)"]);
    const outside = { ...bare, insurance: { policies: [policy()], flood: { sfha: false, zone: "X", by: "x", at: "y" } } };
    expect(insuranceGaps(outside, TODAY)).toEqual([]);
    const inZone = { ...outside, insurance: { ...outside.insurance, flood: { sfha: true, zone: "AE", by: "x", at: "y" } } };
    expect(insuranceGaps(inZone, TODAY)).toEqual(["No flood policy on file (Closing tab)"]);
    expect(coverNeeds(inZone).find((need) => need.key === "flood")!.note).toMatch(/Zone AE is a special flood hazard area/);
    // A separate wind policy does instead of wind in the property policy.
    const separate = { ...inZone, insurance: { ...inZone.insurance, policies: [policy({ windIncluded: false }), policy({ kind: "windstorm", windIncluded: undefined }), policy({ kind: "flood", windIncluded: undefined })] } };
    expect(insuranceGaps(separate, TODAY)).toEqual([]);
  });

  it("needs LendHous named as mortgagee and nothing lapsed, and flags coverage under the loan without holding it", () => {
    const d = deal(demoBook(), "d15");
    expect(insuranceGaps(d, TODAY)).toEqual([]);
    const unnamed = { ...d, insurance: { ...d.insurance!, policies: [policy({ mortgagee: undefined })] } };
    expect(insuranceGaps(unnamed, TODAY)).toEqual(["The hazard (property) policy isn't confirmed to name LendHous as mortgagee"]);
    const lapsed = { ...d, insurance: { ...d.insurance!, policies: [policy({ expiresOn: "2026-10-30" })] } };
    expect(insuranceGaps(lapsed, TODAY)).toEqual(["The hazard (property) policy lapsed on October 30, 2026"]);
    const thin = { ...d, insurance: { ...d.insurance!, policies: [policy({ coverage: 1_000 })] } };
    expect(coverageShort(thin)).toEqual([expect.stringMatching(/covers \$1,000, less than the \$[\d,]+ loan/)]);
    expect(insuranceGaps(thin, TODAY)).toEqual([]);
    // Builder's risk only counts on a rehab or a build.
    const bridgeOnBuildersRisk = { ...d, insurance: { ...d.insurance!, policies: [policy({ kind: "builders_risk" })] } };
    expect(coverNeeds(bridgeOnBuildersRisk)[0].met).toBe(false);
  });

  it("holds funding until it's in place", () => {
    const b = demoBook();
    const e = evaluate(deal(b, "d15").app);
    expect(nextStage(deal(b, "d15"), e, TODAY)!.blockers.filter((item) => /policy|flood/.test(item))).toEqual([]);
    const uninsured = withDeal(b, "d15", (d) => ({ ...d, insurance: undefined }));
    expect(nextStage(deal(uninsured, "d15"), e, TODAY)!.blockers).toEqual(expect.arrayContaining(["No hazard (property) policy on file (Closing tab)", "The flood zone isn't recorded (Closing tab)"]));
  });

  it("holds draws on any lapsed policy, wind or flood included", () => {
    const b = demoBook();
    const d = deal(b, "d2");
    expect(insuranceHold(d, TODAY)).toBeNull();
    const windGone = { ...d, insurance: { ...d.insurance!, policies: [policy({ windIncluded: false }), policy({ kind: "windstorm", expiresOn: "2026-10-20" })] } };
    expect(insuranceHold(windGone, TODAY)).toBe("The windstorm policy lapsed on October 20, 2026.");
    expect(drawHolds(windGone, b.draws.find((item) => item.id === "draw-1")!, TODAY)).toEqual(expect.arrayContaining(["The windstorm policy lapsed on October 20, 2026."]));
  });
});

describe("the team's insurance file", () => {
  it("lets the team save a policy, one per kind, and record the flood zone; borrowers and partners can't", () => {
    const b = demoBook();
    expect(check(b, borrower, save("d1"))).toHaveProperty("error");
    expect(check(b, partner, save("d3"))).toHaveProperty("error");
    expect(check(b, processor, save("d1"))).toMatchObject({ error: expect.stringMatching(/accepted term sheet/) });
    expect(check(b, processor, save("d15", { kind: "builders_risk" }))).toMatchObject({ error: "Choose which policy it is." });
    expect(parseAction({ ...save("d15"), kind: "earthquake" })).toBeNull();
    const { after } = run(b, servicer, save("d15"));
    expect(policiesOf(deal(after, "d15"))).toEqual([expect.objectContaining({ kind: "hazard", carrier: "Gulf Mutual", coverage: 600_000, windIncluded: true, mortgagee: true, by: "svc name" })]);
    const flood = run(after, processor, { t: "setFloodZone", dealId: "d15", sfha: true, zone: "ae", by: "x" }).after;
    expect(deal(flood, "d15").insurance!.flood).toMatchObject({ sfha: true, zone: "AE", by: "proc name" });
    expect(insuranceGaps(deal(flood, "d15"), TODAY)).toEqual(["No flood policy on file (Closing tab)"]);
  });

  it("moves a lien file's old policy into the loan's insurance file on the next save", () => {
    const legacy = withDeal(demoBook(), "d2", (d) => ({ ...d, insurance: undefined, lienFile: { ...d.lienFile!, insurance: { kind: "hazard", carrier: "Old Mutual", policy: "OM-1", expiresOn: "2027-01-31", by: "Pat", at: "2026-09-04T16:00:00Z" } } }));
    expect(policiesOf(deal(legacy, "d2"))).toEqual([expect.objectContaining({ carrier: "Old Mutual" })]);
    const { after } = run(legacy, processor, save("d2", { kind: "windstorm", windIncluded: undefined, carrier: "Coastal Wind" }));
    expect(policiesOf(deal(after, "d2")).map((item) => [item.kind, item.carrier])).toEqual([["hazard", "Old Mutual"], ["windstorm", "Coastal Wind"]]);
    expect(deal(after, "d2").lienFile!.insurance).toBeUndefined();
    expect(deal(after, "d2").lienFile!.noc).toBeDefined();
  });
});

describe("renewals the borrower sends", () => {
  it("come only from the upload route, on a funded loan, ending after today", () => {
    const b = demoBook();
    expect(check(b, borrower, renewal("d2"))).toMatchObject({ error: expect.stringMatching(/Upload the policy/) });
    expect(renewalProblem(deal(b, "d1"), { kind: "hazard", carrier: "x", expiresOn: "2027-01-01" }, TODAY)).toMatch(/conditions/);
    expect(renewalProblem(deal(b, "d2"), { kind: "hazard", carrier: "x", expiresOn: TODAY }, TODAY)).toMatch(/after today/);
    expect(reducer(b, renewal("d1"))).toBe(b);
  });

  it("go to the team, which accepts one onto the file or sends it back with why", () => {
    const b = demoBook();
    const sent = run(b, system, renewal("d9"), true);
    const open = deal(sent.after, "d9").insurance!.renewals!;
    expect(open).toEqual([expect.objectContaining({ status: "submitted", carrier: "Sample Mutual (FAKE)", documentId: "doc-ren" })]);
    expect(alertsFor(b, sent.after, sent.action)).toMatchObject([{ to: "team", event: "insurance.renewal_sent" }]);
    expect(workQueue(sent.after, { id: "" }, new Date("2026-10-31T16:00:00Z")).team.find((item) => item.key === "renewal:d9")).toMatchObject({ label: "Check an insurance renewal", href: "/admin/deals/d9?tab=Servicing" });
    expect(attentionItems(sent.after, 0).find((item) => item.key === "renewals")).toMatchObject({ count: 1 });
    const id = open[0].id;
    const back = (note: string): BookAction => ({ t: "decideRenewal", dealId: "d9", renewalId: id, accept: false, mortgagee: false, note, by: "x" });
    expect(check(sent.after, processor, back(" "))).toMatchObject({ error: expect.stringMatching(/what's wrong/) });
    expect(check(sent.after, borrower, back("Not named"))).toHaveProperty("error");
    const returned = run(sent.after, processor, back("LendHous isn't named as mortgagee"));
    expect(deal(returned.after, "d9").insurance!.renewals![0]).toMatchObject({ status: "returned", decided: { by: "proc name", note: "LendHous isn't named as mortgagee" } });
    expect(alertsFor(sent.after, returned.after, returned.action)).toMatchObject([{ to: "borrower", event: "insurance.renewal_returned", body: expect.stringMatching(/isn't named as mortgagee\. Please send/) }]);
    // A corrected one, accepted: it replaces the policy, and the reminder starts again for the new end date.
    const again = run(returned.after, system, renewal("d9", { policy: "SM-FIXED" }), true).after;
    const second = deal(again, "d9").insurance!.renewals!.find((item) => item.status === "submitted")!;
    const accepted = run(again, processor, { t: "decideRenewal", dealId: "d9", renewalId: second.id, accept: true, mortgagee: true, windIncluded: true, note: "", by: "x" });
    expect(policiesOf(deal(accepted.after, "d9"))).toEqual([expect.objectContaining({ kind: "hazard", policy: "SM-FIXED", expiresOn: "2027-11-20", mortgagee: true, windIncluded: true, documentId: "doc-ren" })]);
    expect(policiesOf(deal(accepted.after, "d9"))[0].remindedOn).toBeUndefined();
    expect(alertsFor(again, accepted.after, accepted.action)).toMatchObject([{ to: "borrower", event: "insurance.renewal_accepted" }]);
    expect(check(accepted.after, processor, { t: "decideRenewal", dealId: "d9", renewalId: second.id, accept: true, mortgagee: true, note: "", by: "x" })).toHaveProperty("error");
  });

  it("show the borrower their file without the team's names, and never reach a partner's blind teaser", () => {
    const b = run(demoBook(), system, renewal("d2"), true).after;
    const mine = scopeBook(b, borrower).deals.find((d) => d.id === "d2")!;
    expect(mine.insurance!.policies.every((item) => item.by === "")).toBe(true);
    expect(mine.insurance!.flood!.by).toBe("");
    const teaser = { ...b, deals: b.deals.map((d) => (d.id === "d3" ? { ...d, insurance: { policies: [policy()] } } : d)) };
    expect(scopeBook(teaser, partner).deals.find((d) => d.id === "d3")!.insurance).toBeUndefined();
  });
});

describe("the nightly check on every funded loan", () => {
  it("warns about each policy on its own, wind and flood included, and puts a lapse in the queue", () => {
    const b = withDeal(demoBook(), "d10", (d) => ({ ...d, insurance: { ...d.insurance!, policies: d.insurance!.policies.map((item) => (item.kind === "flood" ? { ...item, expiresOn: "2026-11-15" } : item)) } }));
    expect(insuranceChecks(b.deals, TODAY)).toEqual({ remind: [{ dealId: "d9", kind: "hazard" }, { dealId: "d10", kind: "flood" }], lapsed: [{ dealId: "d13", kind: "hazard" }] });
    const { after, action } = run(b, system, { t: "checkInsurance", asOf: TODAY }, true);
    const flood = policiesOf(deal(after, "d10")).find((item) => item.kind === "flood")!;
    expect(flood.remindedOn).toBe(TODAY);
    expect(policiesOf(deal(after, "d10")).find((item) => item.kind === "windstorm")!.remindedOn).toBeUndefined();
    expect(alertsFor(b, after, action).filter((alert) => alert.dealId === "d10" || alert.subject.includes("1010")).map((alert) => alert.body)).toEqual([expect.stringMatching(/The flood policy on .* ends on November 15, 2026/), expect.stringMatching(/flood policy/)]);
    expect(workQueue(after, { id: "" }, new Date("2026-10-31T16:00:00Z")).team.find((item) => item.key === "insurance:d13")).toMatchObject({ label: "Insurance lapsed: get the renewal" });
    expect(attentionItems(after, 0).find((item) => item.key === "insurance")).toMatchObject({ count: 1, href: "/admin/deals/d13" });
  });
});
