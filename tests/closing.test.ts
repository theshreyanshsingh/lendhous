import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { activeWire, routingValid, wireVerified } from "@/lib/closing";
import { evaluate } from "@/lib/engine";
import { nextStage } from "@/lib/loan-stages";
import type { Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (book: Book, viewer: Viewer, action: BookAction) => authorize(book, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }));
const run = (book: Book, viewer: Viewer, action: BookAction) => {
  const result = check(book, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(book, result.action), action: result.action };
};
const processor = person("proc", ["PROCESSOR"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const underwriter = person("uw", ["UNDERWRITER"]);
// d15 is at closing with committed capital; this copy has no wire yet.
const closing = (changes: Partial<Deal> = {}): Book => {
  const deal = demoBook().deals.find((item) => item.id === "d15")!;
  return { ...emptyBook(), deals: [{ ...deal, wires: undefined, fundingApprovers: undefined, ...changes }] };
};
const enter = (changes: Partial<Extract<BookAction, { t: "enterWire" }>> = {}): BookAction => ({ t: "enterWire", dealId: "d15", wireId: "w1", bankName: "First Bank", routing: "123456780", account: "987654321", beneficiary: "Sample Title Trust", reference: "ST-1015", source: "Title company's secure portal", by: "x", ...changes });
const verify = (changes: Partial<Extract<BookAction, { t: "verifyWire" }>> = {}): BookAction => ({ t: "verifyWire", dealId: "d15", wireId: "w1", phone: "(954) 555-0100", phoneSource: "Title company's website", spokeWith: "Dana Escrow", by: "x", ...changes });

describe("wire instructions", () => {
  it("checks the routing number's check digit and the account number before saving", () => {
    expect(routingValid("123456780")).toBe(true);
    expect(routingValid("123456789")).toBe(false);
    expect(check(closing(), processor, enter({ routing: "123456789" }))).toMatchObject({ error: expect.stringMatching(/routing number isn't valid/) });
    expect(check(closing(), processor, enter({ account: "12" }))).toMatchObject({ error: expect.stringMatching(/4 to 17 digits/) });
    expect(check(closing(), processor, enter({ source: "Email from the title company" }))).toMatchObject({ error: expect.stringMatching(/how the instructions arrived/) });
    expect(check(closing(), processor, enter({ routing: "1234 5678 0" }))).toMatchObject({ action: { routing: "123456780", by: "proc name" } });
  });
  it("can only go in between an accepted term sheet and funding, by staff who handle closings", () => {
    expect(check(closing({ status: "underwriting" }), processor, enter())).toMatchObject({ error: expect.stringMatching(/term sheet is accepted/) });
    expect(check(closing(), person("servicer", ["SERVICER"]), enter())).toHaveProperty("error");
    expect(check(closing(), person("borrower-1", ["BORROWER"]), enter())).toHaveProperty("error");
  });
  it("needs a call-back by someone other than whoever entered them", () => {
    const entered = run(closing(), processor, enter()).after;
    expect(wireVerified(entered.deals[0])).toBe(false);
    expect(check(entered, processor, verify())).toMatchObject({ error: expect.stringMatching(/Someone other than/) });
    expect(check(entered, owner, verify({ phoneSource: "The instructions themselves" }))).toMatchObject({ error: expect.stringMatching(/can't be from the instructions/) });
    expect(check(entered, owner, verify({ phone: "555-0100" }))).toMatchObject({ error: expect.stringMatching(/full number/) });
    const verified = run(entered, owner, verify()).after;
    expect(activeWire(verified.deals[0])?.verification).toMatchObject({ by: "owner name", spokeWith: "Dana Escrow", phoneSource: "Title company's website" });
    expect(check(verified, underwriter, verify())).toMatchObject({ error: expect.stringMatching(/already verified/) });
  });
  it("won't fund, or take an approval, until they're verified", () => {
    const entered = run(closing(), processor, enter()).after;
    expect(check(entered, owner, { t: "approveFunding", dealId: "d15", by: "x" })).toMatchObject({ error: expect.stringMatching(/Verify the wire/) });
    expect(nextStage(entered.deals[0], evaluate(entered.deals[0].app))?.blockers).toContain("The wire instructions haven't been verified by a call-back (Closing tab)");
    const verified = run(entered, owner, verify()).after;
    const once = run(verified, owner, { t: "approveFunding", dealId: "d15", by: "x" }).after;
    const twice = run(once, underwriter, { t: "approveFunding", dealId: "d15", by: "x" }).after;
    expect(twice.deals[0]).toMatchObject({ fundingApprovers: ["owner name", "uw name"], fundingWireId: "w1" });
    expect(nextStage(twice.deals[0], evaluate(twice.deals[0].app))?.blockers).toEqual([]);
  });
  it("treats changed instructions as a new wire: approvals are cleared, it needs a new call, and the team is told", () => {
    const entered = run(closing(), processor, enter()).after;
    const approved = run(run(run(entered, owner, verify()).after, owner, { t: "approveFunding", dealId: "d15", by: "x" }).after, underwriter, { t: "approveFunding", dealId: "d15", by: "x" }).after;
    const changed = run(approved, processor, enter({ wireId: "w2", account: "111122223333" }));
    const deal = changed.after.deals[0];
    expect(deal).toMatchObject({ fundingApprovers: undefined, fundingWireId: undefined });
    expect(activeWire(deal)?.id).toBe("w2");
    expect(activeWire(deal)?.verification).toBeUndefined();
    expect(deal.wires![0].replaced).toMatchObject({ by: "proc name" });
    expect(nextStage(deal, evaluate(deal.app))?.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/haven't been verified/), "Needs two people to approve funding (0 of 2)"]));
    expect(alertsFor(approved, changed.after, changed.action)).toMatchObject([{ to: "team", event: "wire.changed" }]);
  });
  it("never sends wire instructions to the borrower, broker or a partner", () => {
    const verified = run(run(closing({ borrowerId: "borrower-1" }), processor, enter()).after, owner, verify()).after;
    const seen = scopeBook(verified, person("borrower-1", ["BORROWER"])).deals[0];
    expect(seen.wires).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain("987654321");
    expect(seen.closing?.company).toBe("Sample Title & Escrow (FAKE)");
  });
  it("accepts only what the form sends", () => {
    expect(parseAction({ ...enter(), extra: "dropped" })).not.toHaveProperty("extra");
    expect(parseAction({ t: "verifyWire", dealId: "d15", wireId: "w1" })).toBeNull();
  });
});

describe("the closing checklist", () => {
  it("is added when conditions start, and can be added to a loan that predates it", () => {
    const accepted = demoBook().deals.find((item) => item.id === "d8")!;
    const book = { ...emptyBook(), deals: [accepted] };
    const after = reducer(book, { t: "advanceLoan", dealId: "d8" });
    expect(after.deals[0].status).toBe("conditions");
    expect(after.deals[0].docs.filter((doc) => doc.category === "Closing" && doc.id.startsWith("closing-")).map((doc) => doc.id)).toEqual(["closing-title", "closing-cpl", "closing-settlement"]);
    const older = { ...emptyBook(), deals: [{ ...accepted, status: "conditions" as const }] };
    expect(run(older, processor, { t: "addClosingChecklist", dealId: "d8" }).after.deals[0].docs.some((doc) => doc.id === "closing-cpl")).toBe(true);
  });
});
