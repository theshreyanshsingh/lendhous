import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { blockingConditions, DEFAULT_LIBRARY, fileProblem, libraryOf, templatesFor } from "@/lib/conditions";
import { evaluate } from "@/lib/engine";
import { nextStage } from "@/lib/loan-stages";
import { DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { conditionsOf } from "@/lib/term-sheets";

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
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
/** d3 is clearing conditions; here its documents are in and its capital committed, so only conditions stand in the way. */
const ready = (): Book => {
  const b = demoBook();
  return { ...b, deals: b.deals.map((d) => (d.id === "d3" ? { ...d, docs: d.docs.map((doc) => ({ ...doc, status: "accepted" as const })), capitalStatus: "committed" as const, allocations: [{ sourceId: "gt-main", amount: evaluate(d.app).noteAmount }] } : d)) };
};
const stageOf = (b: Book, id = "d3") => nextStage(deal(b, id), evaluate(deal(b, id).app), "2026-10-31")!;
const change = (t: "clearCondition" | "returnCondition" | "waiveCondition", conditionId: string, text = ""): BookAction => (t === "clearCondition" ? { t, dealId: "d3", conditionId, note: text, by: "x" } : { t, dealId: "d3", conditionId, reason: text, by: "x" });

describe("the conditions library", () => {
  it("starts with standard conditions and gives each loan type its own", () => {
    expect(libraryOf(emptyBook())).toBe(DEFAULT_LIBRARY);
    const titles = (product: Deal["app"]["product"]) => templatesFor(DEFAULT_LIBRARY, { product }).map((item) => item.id);
    expect(titles("dscr")).toContain("std-lease");
    expect(titles("dscr")).not.toContain("std-budget");
    expect(titles("ground_up")).toEqual(expect.arrayContaining(["std-budget", "std-builders-risk"]));
    expect(titles("bridge")).not.toContain("std-builders-risk");
  });
  it("is edited by whoever manages settings, each change a new version, and a retired one is no longer added", () => {
    const b = emptyBook();
    const add: BookAction = { t: "saveConditionTemplate", template: { title: "Flood certificate", detail: "A flood zone determination.", category: "prior_to_docs", owner: "processor", needsUpload: false, products: [], dueDays: 5, active: true }, by: "x" };
    expect(check(b, underwriter, add)).toHaveProperty("error");
    const template = (add as Extract<BookAction, { t: "saveConditionTemplate" }>).template;
    expect(check(b, owner, { t: "saveConditionTemplate", template: { ...template, title: " " }, by: "x" })).toMatchObject({ error: expect.stringMatching(/title/) });
    const { after } = run(b, owner, add);
    // Saving the first change keeps the starting library alongside it.
    expect(after.conditionLibrary).toHaveLength(DEFAULT_LIBRARY.length + 1);
    const added = after.conditionLibrary.at(-1)!;
    expect(added).toMatchObject({ title: "Flood certificate", version: 1, updatedBy: "owner name" });
    const retired = run(after, owner, { t: "saveConditionTemplate", template: { ...added, active: false }, by: "x" }).after;
    expect(retired.conditionLibrary.find((item) => item.id === added.id)).toMatchObject({ active: false, version: 2 });
    expect(templatesFor(libraryOf(retired), { product: "fix_flip" }).some((item) => item.id === added.id)).toBe(false);
    expect(retired.audit[0].text).toMatch(/retired "Flood certificate" \(version 2\)/);
  });
});

describe("conditions on a loan", () => {
  it("come from the library when the loan starts clearing conditions, and the borrower hears what's theirs", () => {
    const b = demoBook();
    const accepted = deal(b, "d8");
    const { after, action } = run(b, owner, { t: "advanceLoan", dealId: "d8" });
    const added = deal(after, "d8").conditions!;
    expect(added.map((item) => item.templateId)).toEqual(templatesFor(DEFAULT_LIBRARY, accepted.app).map((item) => item.id));
    expect(added.every((item) => item.status === "open" && item.dueOn)).toBe(true);
    const told = alertsFor(b, after, action);
    expect(told.map((alert) => alert.to)).toEqual(["borrower", "broker"]);
    expect(told[0].body).toMatch(/Company documents/);
  });
  it("hold up clear to close until each one before closing is cleared or waived", () => {
    let b = ready();
    expect(stageOf(b).blockers).toEqual([expect.stringMatching(/conditions to clear before closing/)]);
    const before = blockingConditions(deal(b, "d3"));
    for (const condition of before) b = run(b, underwriter, condition.status === "submitted" ? change("clearCondition", condition.id) : change("waiveCondition", condition.id, "Covered by the title commitment (test)")).after;
    expect(stageOf(b).blockers).toEqual([]);
    // After closing ones don't hold anything up.
    expect(deal(b, "d3").conditions!.some((item) => item.category === "post_closing" && item.status === "open")).toBe(true);
  });
  it("take the right authority: anyone who manages conditions clears them, waiving needs its own permission and a reason", () => {
    const b = ready();
    const open = deal(b, "d3").conditions!.find((item) => item.status === "open")!;
    const sent = deal(b, "d3").conditions!.find((item) => item.status === "submitted")!;
    expect(check(b, processor, change("clearCondition", open.id))).toHaveProperty("action");
    expect(check(b, processor, change("waiveCondition", open.id, "Not needed"))).toHaveProperty("error");
    expect(check(b, underwriter, change("waiveCondition", open.id))).toMatchObject({ error: expect.stringMatching(/why it's waived/) });
    expect(check(b, underwriter, change("returnCondition", open.id, "Blurry"))).toMatchObject({ error: expect.stringMatching(/Only something sent in/) });
    expect(check(b, person("b-x", ["BORROWER"]), change("clearCondition", open.id))).toHaveProperty("error");
    const returned = run(b, processor, change("returnCondition", sent.id, "The binder doesn't name LendHous as mortgagee."));
    expect(deal(returned.after, "d3").conditions!.find((item) => item.id === sent.id)).toMatchObject({ status: "open", returned: { reason: "The binder doesn't name LendHous as mortgagee.", by: "proc name" } });
    expect(alertsFor(b, returned.after, returned.action)).toMatchObject([{ to: "borrower", event: "condition.returned", body: expect.stringMatching(/doesn't name LendHous/) }, { to: "broker" }]);
    const cleared = run(b, processor, change("clearCondition", sent.id, "Binder checked")).after;
    expect(check(cleared, processor, change("clearCondition", sent.id))).toMatchObject({ error: expect.stringMatching(/already cleared/) });
  });
  it("can be added from the library or written for one loan, with sensible limits", () => {
    const b = ready();
    const custom: BookAction = { t: "addCondition", dealId: "d3", condition: { title: "HOA estoppel letter", detail: "From the condo association, showing dues paid.", category: "prior_to_funding", owner: "borrower", needsUpload: true, dueOn: "2026-11-10" }, by: "x" };
    const { after, action } = run(b, processor, custom);
    expect(deal(after, "d3").conditions!.at(-1)).toMatchObject({ title: "HOA estoppel letter", status: "open", dueOn: "2026-11-10", addedBy: "proc name" });
    expect(alertsFor(b, after, action)).toMatchObject([{ to: "borrower", event: "condition.added", body: expect.stringMatching(/HOA estoppel letter.*by November 10, 2026/) }, { to: "broker" }]);
    expect(check(b, processor, { ...custom, condition: { ...(custom as Extract<BookAction, { t: "addCondition" }>).condition, dueOn: "2026-10-01" } } as BookAction)).toMatchObject({ error: expect.stringMatching(/past/) });
    expect(check(b, processor, { t: "addCondition", dealId: "d3", condition: { templateId: "std-entity", title: "", detail: "", category: "prior_to_docs", owner: "borrower", needsUpload: true }, by: "x" })).toMatchObject({ error: expect.stringMatching(/already has/) });
    expect(check(b, processor, { t: "addCondition", dealId: "d3", condition: { templateId: "nope", title: "x", detail: "", category: "prior_to_docs", owner: "borrower", needsUpload: true }, by: "x" })).toMatchObject({ error: expect.stringMatching(/isn't in the library/) });
    const funded = demoBook();
    expect(check(funded, processor, { ...custom, dealId: "d2" } as BookAction)).toMatchObject({ error: expect.stringMatching(/only take conditions for after closing/) });
    expect(check(funded, processor, { ...custom, dealId: "d2", condition: { ...(custom as Extract<BookAction, { t: "addCondition" }>).condition, category: "post_closing" } } as BookAction)).toHaveProperty("action");
  });
  it("take files only from the server, and the borrower only sends their own", () => {
    const b = ready();
    const theirs = deal(b, "d3").conditions!.find((item) => item.owner === "borrower" && item.status === "open")!;
    const internal = deal(b, "d3").conditions!.find((item) => item.owner !== "borrower")!;
    const file: BookAction = { t: "conditionFile", dealId: "d3", conditionId: theirs.id, fileName: "articles.pdf", documentId: "doc1", by: "Jordan" };
    expect(check(b, owner, file)).toHaveProperty("error");
    expect(parseAction(file)).toBeNull();
    const { after, action } = run(b, owner, file, true);
    expect(deal(after, "d3").conditions!.find((item) => item.id === theirs.id)).toMatchObject({ status: "submitted", files: [{ fileName: "articles.pdf", documentId: "doc1", by: "Jordan" }] });
    expect(alertsFor(b, after, action)).toMatchObject([{ to: "team", event: "condition.submitted" }]);
    expect(attentionItems(after, 0).find((item) => item.key === "conditions")).toMatchObject({ count: 2, href: "/admin/deals/d3" });
    expect(fileProblem(internal, true)).toMatch(/LendHous team/);
    expect(fileProblem(internal, false)).toBeNull();
  });
  it("show the borrower only theirs, without the team's notes, and nobody outside the deal sees them", () => {
    const b = ready();
    const cleared = run(b, processor, change("clearCondition", deal(b, "d3").conditions!.find((item) => item.status === "submitted")!.id, "Agent confirmed by phone")).after;
    const mine = scopeBook(cleared, person("b-jordan", ["BORROWER"])).deals.find((d) => d.id === "d3")!.conditions!;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((item) => item.owner === "borrower" && !item.addedBy)).toBe(true);
    expect(mine.find((item) => item.cleared)!.cleared).toMatchObject({ by: "", note: "" });
    expect(scopeBook(cleared, person(DEMO_PARTNER_ID, ["PARTNER_LENDER"])).deals.every((d) => !d.conditions)).toBe(true);
  });
  it("set before a term sheet show on it as still needed", () => {
    const b = demoBook();
    const added = run(b, owner, { t: "addCondition", dealId: "d1", condition: { title: "Survey", detail: "", category: "prior_to_docs", owner: "processor", needsUpload: false }, by: "x" }).after;
    expect(conditionsOf(deal(added, "d1"))).toContain("Survey");
  });
});
