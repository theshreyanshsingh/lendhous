import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { demoBook, reducer, type Book } from "@/lib/book";
import { agentProblem, agentsMissing, docBadge, ownDocProblem, shouldAskAgents, splitDocs, uploadLabel } from "@/lib/borrower-docs";
import type { Doc } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";

const doc = (id: string, status: Doc["status"], extra: Partial<Doc> = {}): Doc => ({ id, name: id, category: "Other", status, ...extra });
const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const allowedFor = (viewer: Viewer) => (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer });
const live = (): Book => { const base = demoBook(); return { ...base, deals: base.deals.map((item) => ({ ...item, borrowerId: item.borrowerId === "b-alex" ? "borrower-1" : item.borrowerId })) }; };
const check = (viewer: Viewer, action: Record<string, unknown>) => authorize(live(), viewer, action as never, allowedFor(viewer), false);
const borrower = person("borrower-1", ["BORROWER"]);

describe("the borrower's documents", () => {
  it("are split into what's still to send, sent-back first, and what's in", () => {
    const { toDo, submitted } = splitDocs([doc("a", "requested", { optional: true }), doc("b", "accepted"), doc("c", "rejected"), doc("d", "requested"), doc("e", "uploaded")]);
    expect(toDo.map((item) => item.id)).toEqual(["c", "d", "a"]);
    expect(submitted.map((item) => item.id)).toEqual(["b", "e"]);
  });
  it("say in plain words where each stands and what the button does", () => {
    expect(docBadge(doc("x", "rejected"))).toEqual({ label: "Action needed", tone: "rose" });
    expect(docBadge(doc("x", "requested")).label).toBe("Needed");
    expect(docBadge(doc("x", "requested", { optional: true })).label).toBe("If it applies");
    expect(docBadge(doc("x", "accepted")).label).toBe("Accepted ✓");
    expect(uploadLabel(doc("x", "rejected"))).toBe("Upload a corrected version");
    expect(uploadLabel(doc("x", "requested"))).toBe("Upload");
  });
  it("keep what the team still needs when it sends one back, and drop it once accepted", () => {
    const sent = reducer(live(), { t: "docStatus", dealId: "d1", docId: "bank", status: "rejected", note: "  All pages, please " });
    expect(sent.deals.find((deal) => deal.id === "d1")!.docs.find((item) => item.id === "bank")!.teamNote).toBe("All pages, please");
    const accepted = reducer(sent, { t: "docStatus", dealId: "d1", docId: "bank", status: "accepted" });
    expect(accepted.deals.find((deal) => deal.id === "d1")!.docs.find((item) => item.id === "bank")!.teamNote).toBeUndefined();
    expect(parseAction({ t: "docStatus", dealId: "d1", docId: "bank", status: "rejected", note: "x" })).toMatchObject({ note: "x" });
  });
  it("can include one the borrower adds unasked, on their own open loan only", () => {
    const add = { t: "addOwnDoc", dealId: "d1", docId: "own-abc12345", name: "Contractor's license", by: "x" };
    expect(check(borrower, add)).toMatchObject({ action: { by: "borrower-1 name" } });
    expect(check(person("borrower-2", ["BORROWER"]), add)).toHaveProperty("error");
    expect(check(borrower, { ...add, docId: "bank" })).toHaveProperty("error");
    expect(check(borrower, { ...add, name: " " })).toHaveProperty("error");
    expect(ownDocProblem("x".repeat(121))).toMatch(/120/);
    const after = reducer(live(), add as never);
    expect(after.deals.find((deal) => deal.id === "d1")!.docs.at(-1)).toMatchObject({ id: "own-abc12345", name: "Contractor's license", status: "requested", addedBy: "borrower", category: "Other" });
    expect(parseAction(add)).toBeTruthy();
  });
});

describe("the borrower's agents", () => {
  const contact = { name: "Tia Title", company: "Title LLC", email: "tia@example.org", phone: "" };
  it("need someone to talk to and a way to reach them", () => {
    expect(agentProblem(contact)).toBeNull();
    expect(agentProblem({ ...contact, name: "", company: "" })).toMatch(/name or company/);
    expect(agentProblem({ ...contact, email: "", phone: "555" })).toMatch(/email or a phone/);
    expect(agentProblem({ ...contact, email: "not-an-email" })).toMatch(/email/);
  });
  it("are the borrower's to give, or the team's to write down", () => {
    const set = { t: "setAgent", dealId: "d1", role: "title", contact, by: "x" };
    expect(check(borrower, set)).toMatchObject({ action: { by: "borrower-1 name" } });
    expect(check(person("borrower-2", ["BORROWER"]), set)).toHaveProperty("error");
    expect(check(person("proc", ["PROCESSOR"]), set)).toHaveProperty("action");
    expect(check(person("partner", ["PARTNER_LENDER"]), set)).toHaveProperty("error");
    expect(parseAction(set)).toBeTruthy();
    const after = reducer(live(), set as never);
    expect(after.deals.find((deal) => deal.id === "d1")!.agents?.title).toMatchObject({ company: "Title LLC", by: "x" });
  });
  it("are asked for from the accepted term sheet until both are on file", () => {
    const deal = live().deals.find((item) => item.id === "d1")!;
    expect(shouldAskAgents(deal)).toBe(false);
    const accepted = { ...deal, status: "term_sheet_accepted" as const };
    expect(shouldAskAgents(accepted)).toBe(true);
    expect(agentsMissing({ ...accepted, agents: { title: { ...contact, by: "x", at: "y" } } })).toEqual(["insurance"]);
    expect(shouldAskAgents({ ...accepted, agents: { title: { ...contact, by: "x", at: "y" }, insurance: { ...contact, by: "x", at: "y" } } })).toBe(false);
    expect(shouldAskAgents({ ...accepted, status: "funded" })).toBe(false);
  });
});
