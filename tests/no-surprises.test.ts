import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { nextStage } from "@/lib/loan-stages";
import { evaluate } from "@/lib/engine";
import { DEMO_PARTNER_ID, DEMO_TEAM, type Deal, type LoanMessage } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { agreedTerms, expectedFigures, heldProblem, linesFrom, openTermChange, settlementHold, settlementLines, termLines, termsHeld } from "@/lib/term-changes";
import { alreadyOnFile, askedLine, askNeeds, askProblem, LATE_DAYS, lateReason, pendingAsks } from "@/lib/late-asks";
import { moveLine, moveProblem, slips, waitingOn } from "@/lib/closing-moves";
import { awaitingReply, awayProblem, awayToday, coverEmails, coverOf, replyBy, replyLine } from "@/lib/replies";
import { SLA_TARGETS } from "@/lib/sla";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], email?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, ...(email ? { email } : {}) });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const deal = (b: Book, id: string) => b.deals.find((item) => item.id === id)!;
const underwriter = person("uw", ["UNDERWRITER"]);
const processor = person("proc", ["PROCESSOR"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const owner2 = person("owner2", ["ADMIN_OWNER"]);
const broker: Viewer = { id: "bea", name: "bea name", roleCodes: ["BROKER"], organizationId: "brk-a" };
const book = () => demoBook();
// d8 is a demo fix and flip whose term sheet the borrower accepted; its borrower is Sam.
const sam = (b: Book) => person(deal(b, "d8").borrowerId, ["BORROWER"]);
const cheaper = (b: Book) => ({ purchasePrice: deal(b, "d8").app.purchasePrice - 20_000 });

describe("changes to accepted terms (lib/term-changes.ts)", () => {
  it("holds the loan's numbers from acceptance until it clears to close", () => {
    const b = book();
    expect(termsHeld(deal(b, "d8"))).toBe(true);
    expect(termsHeld(deal(b, "d1"))).toBe(false);
    expect(termLines(deal(b, "d8").app, { fico: 760 })).toEqual([]);
    const lines = termLines(deal(b, "d8").app, cheaper(b));
    expect(lines.map((line) => line.key)).toEqual(expect.arrayContaining(["noteAmount", "cashToClose"]));
    expect(lines.find((line) => line.key === "noteAmount")!.after).toBeLessThan(lines.find((line) => line.key === "noteAmount")!.before);
  });

  it("won't save numbers that move accepted terms, but saves ones that don't", () => {
    const b = book();
    const moving: BookAction = { t: "updateDealNumbers", dealId: "d8", changes: cheaper(b) };
    expect(check(b, underwriter, moving)).toMatchObject({ error: expect.stringContaining("accepted") });
    expect(reducer(b, moving)).toBe(b);
    expect(heldProblem(deal(b, "d8"), cheaper(b))).toMatch(/Send the change to the borrower/);
    expect(check(b, underwriter, { t: "updateDealNumbers", dealId: "d8", changes: { fico: 761 } })).toHaveProperty("action");
    // Before acceptance, nothing is held.
    expect(check(b, underwriter, { t: "updateDealNumbers", dealId: "d5", changes: { purchasePrice: deal(b, "d5").app.purchasePrice + 5_000 } })).toHaveProperty("action");
  });

  it("sends the change with a reason, and only the borrower's yes applies it", () => {
    const b = { ...book(), deals: book().deals.map((item) => (item.id === "d8" ? { ...item, termChanges: undefined } : item)) };
    const propose: BookAction = { t: "proposeTermChange", dealId: "d8", changeId: "tc1", changes: cheaper(b), reason: "Price came down after inspection", by: "" };
    expect(check(b, underwriter, { ...propose, reason: " " } as BookAction)).toMatchObject({ error: expect.stringContaining("Say why") });
    expect(check(b, processor, propose)).toHaveProperty("error");
    const { after, action } = run(b, underwriter, propose);
    const change = openTermChange(deal(after, "d8"))!;
    expect(change).toMatchObject({ status: "proposed", reason: "Price came down after inspection", by: "uw name" });
    expect(deal(after, "d8").app.purchasePrice).toBe(deal(b, "d8").app.purchasePrice);
    const alerts = alertsFor(b, after, action);
    expect(alerts.map((alert) => alert.to)).toEqual(["borrower", "broker"]);
    expect(alerts[0].body).toContain("Nothing changes unless you agree");
    // Clearing to close waits for the answer.
    const ready = { ...after, deals: after.deals.map((item) => (item.id === "d8" ? { ...item, status: "conditions" as const } : item)) };
    expect(nextStage(deal(ready, "d8"), evaluate(deal(ready, "d8").app), serviceDay(ready))?.blockers).toContain("The borrower hasn't answered the change to their terms yet");
    // Only one at a time.
    expect(check(after, underwriter, { ...propose, changeId: "tc2" })).toMatchObject({ error: expect.stringContaining("already waiting") });
    // A broker sees it but can't answer for the client; the borrower must type their name.
    const answer: BookAction = { t: "answerTermChange", dealId: "d8", changeId: "tc1", agree: true, signedName: "Sam Example", note: "", by: "" };
    expect(check(after, broker, answer)).toMatchObject({ error: expect.stringContaining("Only the borrower") });
    expect(check(after, sam(after), { ...answer, signedName: "" } as BookAction)).toMatchObject({ error: "Type your name to agree." });
    const agreed = run(after, sam(after), answer);
    expect(deal(agreed.after, "d8").app.purchasePrice).toBe(deal(b, "d8").app.purchasePrice - 20_000);
    expect(deal(agreed.after, "d8").termChanges![0]).toMatchObject({ status: "agreed", answer: { signedName: "Sam Example" } });
    expect(alertsFor(after, agreed.after, agreed.action).map((alert) => alert.to)).toEqual(["team", "broker"]);
    // The agreed terms follow the change, so the settlement statement is checked against them.
    expect(agreedTerms(deal(agreed.after, "d8")).noteAmount).toBe(evaluate(deal(agreed.after, "d8").app).noteAmount);
  });

  it("keeps the accepted terms when the borrower says no, or the team withdraws it", () => {
    const b = book();
    const declined = run(b, sam(b), { t: "answerTermChange", dealId: "d8", changeId: "tc-demo-8", agree: false, signedName: "", note: "I'd rather keep the bigger loan", by: "" }).after;
    expect(deal(declined, "d8").app).toEqual(deal(b, "d8").app);
    expect(deal(declined, "d8").termChanges![0]).toMatchObject({ status: "declined", answer: { note: "I'd rather keep the bigger loan" } });
    const withdrawn = run(b, underwriter, { t: "withdrawTermChange", dealId: "d8", changeId: "tc-demo-8", by: "" }).after;
    expect(deal(withdrawn, "d8").termChanges![0].status).toBe("withdrawn");
    expect(check(withdrawn, sam(withdrawn), { t: "answerTermChange", dealId: "d8", changeId: "tc-demo-8", agree: true, signedName: "Sam", note: "", by: "" })).toHaveProperty("error");
  });

  it("won't take a yes to numbers that moved since they were sent", () => {
    const b = book();
    const moved = { ...b, deals: b.deals.map((item) => (item.id === "d8" ? { ...item, app: { ...item.app, rehab: item.app.rehab + 25_000 } } : item)) };
    expect(check(moved, sam(moved), { t: "answerTermChange", dealId: "d8", changeId: "tc-demo-8", agree: true, signedName: "Sam", note: "", by: "" })).toMatchObject({ error: expect.stringContaining("moved since") });
  });

  it("parses the requests a browser sends", () => {
    expect(parseAction({ t: "proposeTermChange", dealId: "d8", changeId: "x", changes: { purchasePrice: 1 }, reason: "why", by: "" })).toBeTruthy();
    expect(parseAction({ t: "proposeTermChange", dealId: "d8", changeId: "x", changes: {}, reason: "", by: "" })).toBeNull();
    expect(parseAction({ t: "addCondition", dealId: "d8", by: "", condition: { title: "x", detail: "", category: "prior_to_docs", owner: "borrower", needsUpload: true }, reason: "why", approved: true })).not.toHaveProperty("approved");
  });
});

describe("the settlement statement check", () => {
  const atClosing = () => { const b = book(); return { b, d: deal(b, "d15") }; };
  it("expects the agreed terms and Florida's taxes on the loan amount", () => {
    const { d } = atClosing();
    const expected = expectedFigures(d);
    expect(expected.loanAmount).toBe(agreedTerms(d).noteAmount);
    expect(expected.docStamps).toBeGreaterThan(0);
    expect(expected.intangibleTax).toBeCloseTo(expected.loanAmount * 0.002, 0);
  });

  it("holds funding when a line differs, until it's fixed or someone who approves funding explains it", () => {
    const { b, d } = atClosing();
    const right = expectedFigures(d);
    const save = (figures: Record<string, number>): BookAction => ({ t: "saveSettlement", dealId: "d15", figures, by: "Terry Title", via: "title" });
    const matched = run(b, person("title", []), save(right), true).after;
    expect(settlementLines(deal(matched, "d15")).every((line) => !line.off)).toBe(true);
    expect(settlementHold(deal(matched, "d15"))).toBeNull();
    // Lender fees $500 over what was agreed.
    const off = run(b, person("title", []), save({ ...right, lenderFees: right.lenderFees + 500 }), true);
    expect(settlementHold(deal(off.after, "d15"))).toMatch(/lender fees/);
    expect(alertsFor(b, off.after, off.action)[0]).toMatchObject({ to: "team", subject: expect.stringContaining("doesn't match") });
    expect(check(off.after, owner, { t: "approveFunding", dealId: "d15", by: "" })).toMatchObject({ error: expect.stringContaining("settlement statement") });
    expect(reducer(off.after, { t: "approveFunding", dealId: "d15", by: "owner name" })).toBe(off.after);
    expect(nextStage(deal(off.after, "d15"), evaluate(deal(off.after, "d15").app), serviceDay(off.after))?.blockers.join(" ")).toContain("settlement statement");
    // A processor can't explain it away; someone who approves funding can.
    expect(check(off.after, processor, { t: "explainSettlement", dealId: "d15", reason: "Title's fee", by: "" })).toHaveProperty("error");
    const explained = run(off.after, owner, { t: "explainSettlement", dealId: "d15", reason: "Includes the $500 courier fee the borrower agreed to", by: "" }).after;
    expect(settlementHold(deal(explained, "d15"))).toBeNull();
    expect(check(explained, owner, { t: "approveFunding", dealId: "d15", by: "" })).toHaveProperty("action");
    // New figures need their own explanation.
    const again = run(explained, owner2, { ...save({ ...right, lenderFees: right.lenderFees + 900 }), via: "team" } as BookAction).after;
    expect(deal(again, "d15").settlement).toMatchObject({ via: "team", by: "owner2 name" });
    expect(settlementHold(deal(again, "d15"))).not.toBeNull();
  });

  it("checks a line within a dollar as matching, and blank as none on the statement", () => {
    const lines = linesFrom({ loanAmount: 100_000, points: 2_000, lenderFees: 995, brokerFee: 0, interestReserve: 0, docStamps: 350, intangibleTax: 200 }, { loanAmount: 100_000.6, points: 2_000, lenderFees: 995, docStamps: 350, intangibleTax: 200 });
    expect(lines.filter((line) => line.off)).toEqual([]);
    expect(linesFrom({ loanAmount: 1, points: 0, lenderFees: 0, brokerFee: 2_000, interestReserve: 0, docStamps: 0, intangibleTax: 0 }, { loanAmount: 1 }).find((line) => line.key === "brokerFee")?.off).toBe(true);
  });

  it("keeps the statement from the borrower's and broker's copies", () => {
    const { b } = atClosing();
    const entered = run(b, person("title", []), { t: "saveSettlement", dealId: "d15", figures: { loanAmount: 1 }, by: "Terry", via: "title" }, true).after;
    expect(scopeBook(entered, broker).deals.find((item) => item.id === "d15")?.settlement).toBeUndefined();
  });
});

describe("late asks (lib/late-asks.ts)", () => {
  it("counts an ask late once the loan clears to close, or within a few days of closing", () => {
    expect(lateReason({ status: "clear_to_close", closingDate: "2026-12-30" }, "2026-10-31")).toBe("The loan has cleared to close");
    expect(lateReason({ status: "conditions", closingDate: "2026-11-03" }, "2026-10-31")).toBe("Closing is 3 days away");
    expect(lateReason({ status: "conditions", closingDate: "2026-11-30" }, "2026-10-31")).toBeNull();
    expect(lateReason({ status: "servicing_current", closingDate: "2026-11-01" }, "2026-10-31")).toBeNull();
    expect(LATE_DAYS).toBe(5);
  });

  const condition = { title: "Final contractor bid", detail: "", category: "prior_to_funding" as const, owner: "borrower" as const, needsUpload: true };
  it("asks for a reason the borrower sees, and waits for a manager when the asker can't approve", () => {
    const b = book();
    const add: BookAction = { t: "addCondition", dealId: "d7", condition, by: "" };
    expect(check(b, processor, add)).toMatchObject({ error: expect.stringContaining("say why this is needed now") });
    const reason = "The lender's inspector asked for it this morning";
    const { after, action } = run(b, processor, { ...add, reason } as BookAction);
    expect(deal(after, "d7").conditions?.some((item) => item.title === "Final contractor bid")).toBe(false);
    expect(pendingAsks(deal(after, "d7")).map((ask) => ask.reason)).toContain(reason);
    expect(alertsFor(b, after, action)).toEqual([expect.objectContaining({ to: "team", subject: expect.stringContaining("late ask") })]);
    expect(workQueue(after, { id: "uw" }, new Date("2026-10-31T15:00:00Z")).team.some((item) => item.label.includes("Final contractor bid"))).toBe(true);
    // The processor can't approve it; an underwriter can, and the borrower then sees why.
    const ask = pendingAsks(deal(after, "d7")).find((item) => item.reason === reason)!;
    expect(check(after, processor, { t: "decideLateAsk", dealId: "d7", askId: ask.id, approve: true, note: "", by: "" })).toHaveProperty("error");
    const approved = run(after, underwriter, { t: "decideLateAsk", dealId: "d7", askId: ask.id, approve: true, note: "", by: "" });
    const added = deal(approved.after, "d7").conditions!.find((item) => item.title === "Final contractor bid")!;
    expect(added.asked).toMatchObject({ reason, late: true, approvedBy: "uw name" });
    expect(alertsFor(after, approved.after, approved.action)[0]).toMatchObject({ to: "borrower", body: expect.stringContaining(reason) });
    const seen = scopeBook(approved.after, person(deal(b, "d7").borrowerId, ["BORROWER"])).deals.find((item) => item.id === "d7")!;
    expect(seen.conditions!.find((item) => item.title === "Final contractor bid")!.asked).toMatchObject({ reason, approvedBy: undefined });
    expect(seen.lateAsks).toBeUndefined();
    expect(askedLine(added.asked)).toBe(`Asked for close to closing: ${reason}`);
  });

  it("lets someone who can approve late asks add one straight away, and turns one down with a reason", () => {
    const b = book();
    const direct = run(b, underwriter, { t: "addCondition", dealId: "d7", condition, reason: "Inspector's ask", by: "" } as BookAction).after;
    expect(deal(direct, "d7").conditions!.find((item) => item.title === "Final contractor bid")!.asked).toMatchObject({ approvedBy: "uw name" });
    expect(check(b, underwriter, { t: "decideLateAsk", dealId: "d7", askId: "ask-demo-7", approve: false, note: " ", by: "" })).toHaveProperty("error");
    const declined = run(b, underwriter, { t: "decideLateAsk", dealId: "d7", askId: "ask-demo-7", approve: false, note: "The August statement covers it", by: "" }).after;
    expect(pendingAsks(deal(declined, "d7"))).toEqual([]);
    expect(deal(declined, "d7").docs.some((doc) => doc.name === "Updated bank statement")).toBe(false);
  });

  it("holds clear to close and funding while a late ask waits", () => {
    const b = book();
    const d7 = { ...deal(b, "d7"), status: "closing" as const };
    expect(nextStage(d7, evaluate(d7.app), serviceDay(b))?.blockers).toContain("1 late ask waiting for a manager (Conditions tab)");
  });

  it("asks why when a paper the borrower already sent is asked for again", () => {
    const b = book();
    const d1 = deal(b, "d1");
    const sent = d1.docs.find((doc) => doc.status === "accepted" || doc.status === "uploaded");
    expect(sent).toBeDefined();
    expect(alreadyOnFile(d1, sent!.name)).toMatchObject({ name: sent!.name });
    expect(askProblem(d1, sent!.name, "", serviceDay(b))).toMatch(/already sent/);
    expect(askProblem(d1, sent!.name, "The copy is cut off", serviceDay(b))).toBeNull();
    expect(alreadyOnFile(d1, "Something never asked for")).toBeNull();
    // A condition for after closing is never late.
    expect(askNeeds(deal(b, "d7"), "Final title policy", serviceDay(b), true).late).toBeNull();
    // A title policy isn't the insurance policy already sent, though the word is the same.
    expect(alreadyOnFile(deal(b, "d7"), "Final title policy")).toBeNull();
    expect(alreadyOnFile({ docs: [{ id: "bank", name: "Bank statements (2 most recent)", category: "Liquidity", status: "accepted" }] }, "Updated bank statement")).toMatchObject({ name: "Bank statements (2 most recent)" });
  });

  it("asks late for documents the same way", () => {
    const b = book();
    const doc: BookAction = { t: "addDocRequest", dealId: "d7", name: "Signed contractor agreement", category: "Property", reason: "Draws need it", by: "" };
    const pending = run(b, processor, doc).after;
    expect(deal(pending, "d7").docs.some((item) => item.name === "Signed contractor agreement")).toBe(false);
    expect(pendingAsks(deal(pending, "d7")).some((ask) => ask.kind === "doc" && ask.doc?.name === "Signed contractor agreement")).toBe(true);
    const direct = run(b, owner, doc).after;
    expect(deal(direct, "d7").docs.find((item) => item.name === "Signed contractor agreement")?.asked).toMatchObject({ reason: "Draws need it", approvedBy: "owner name" });
  });
});

describe("closing date moves (lib/closing-moves.ts)", () => {
  it("needs a new date, what it waits on and why", () => {
    const d = { status: "conditions" as const, closingDate: "2026-11-06" };
    expect(moveProblem(d, "2026-11-13", "appraiser", "", "2026-10-31")).toMatch(/Say why/);
    expect(moveProblem(d, "2026-10-01", "appraiser", "x", "2026-10-31")).toMatch(/past/);
    expect(moveProblem(d, "2026-11-06", "appraiser", "x", "2026-10-31")).toMatch(/already/);
    expect(moveProblem(d, "2026-11-13", "nobody", "x", "2026-10-31")).toMatch(/waiting on/);
    expect(moveProblem({ ...d, status: "servicing_current" }, "2026-11-13", "title", "x", "2026-10-31")).toMatch(/before the loan funds/);
    expect(moveProblem(d, "2026-11-13", "title", "x", "2026-10-31")).toBeNull();
  });

  it("keeps each move, tells the borrower, broker, title company and team, and shows the same record to the broker", () => {
    const b = book();
    const { after, action } = run(b, processor, { t: "moveClosingDate", dealId: "d3", moveId: "mv1", to: "2026-11-20", party: "insurance", reason: "The windstorm binder is still with the carrier", by: "" });
    const d3 = deal(after, "d3");
    expect(d3.closingDate).toBe("2026-11-20");
    expect(d3.closingMoves!.at(-1)).toMatchObject({ from: "2026-11-06", to: "2026-11-20", party: "insurance", by: "proc name" });
    expect(waitingOn(d3)?.party).toBe("insurance");
    expect(slips(d3)).toBe(3);
    expect(moveLine(d3.closingMoves!.at(-1)!)).toBe("Nov 6, 2026 → Nov 20, 2026, waiting on insurance: The windstorm binder is still with the carrier");
    expect(alertsFor(b, after, action).map((alert) => alert.to)).toEqual(["borrower", "broker", "team"]);
    expect(scopeBook(after, broker).deals.find((item) => item.id === "d3")?.closingMoves).toHaveLength(3);
    expect(check(after, broker, { t: "moveClosingDate", dealId: "d3", moveId: "mv2", to: "2026-11-21", party: "borrower", reason: "x", by: "" })).toHaveProperty("error");
    // A partner looking at the teaser, or a buyer at a loan for sale, sees none of it: reasons and answers carry names.
    const teaser = scopeBook(after, { id: "pia", name: "Pia", roleCodes: ["PARTNER_LENDER"], organizationId: DEMO_PARTNER_ID }).deals.find((item) => item.id === "d3")!;
    expect(teaser).toMatchObject({ closingMoves: undefined, termChanges: undefined, settlement: undefined, lateAsks: undefined, borrowerName: "" });
  });

  it("tells the title company when it has the closer's email", () => {
    const b = book();
    const { after, action } = run(b, processor, { t: "moveClosingDate", dealId: "d15", moveId: "mv1", to: "2026-11-10", party: "lendhous", reason: "Waiting on the second funding approval", by: "" });
    expect(alertsFor(b, after, action).find((alert) => alert.to === "email")).toMatchObject({ email: "closings@sample-title.test" });
  });
});

describe("reply times and cover (lib/replies.ts)", () => {
  const message = (side: LoanMessage["side"], at: string, from: string = side): LoanMessage => ({ id: `${side}${at}`, dealId: "d1", from, side, text: "x", at });
  it("counts from the client's oldest message since the team last wrote, across time zones", () => {
    const messages = [message("team", "2026-11-02T10:00:00-05:00"), message("borrower", "2026-11-02T08:30:00-08:00", "Alex"), message("broker", "2026-11-02T17:00:00Z", "Bea"), message("internal", "2026-11-02T18:00:00Z")];
    expect(awaitingReply(messages, "d1")).toEqual({ since: "2026-11-02T08:30:00-08:00", from: "Alex" });
    expect(awaitingReply([...messages, message("team", "2026-11-02T19:00:00Z")], "d1")).toBeNull();
    expect(awaitingReply(messages, "d1", "2026-11-02T18:00:00Z")).toBeNull();
    expect(awaitingReply(messages, "d2")).toBeNull();
  });

  it("promises a reply a business day out, and says so once it's past", () => {
    // A Friday at 4 PM in Florida: the reply is due the next business day at 4 PM.
    expect(replyBy("2026-11-06T21:00:00Z", SLA_TARGETS).toISOString()).toBe("2026-11-09T21:00:00.000Z");
    expect(replyLine("2026-11-06T21:00:00Z", SLA_TARGETS, new Date("2026-11-07T12:00:00Z"))).toBe("We'll reply by Monday, November 9 at 4:00 PM.");
    expect(replyLine("2026-11-06T21:00:00Z", SLA_TARGETS, new Date("2026-11-10T12:00:00Z"))).toMatch(/past the time/);
  });

  it("puts waiting messages on the queue with their clock, until someone answers or marks no reply needed", () => {
    const b = book();
    const asked = reducer(b, { t: "sendMessage", dealId: "d3", from: "Bea Broker (FAKE)", side: "broker", text: "Any update on the appraisal?" });
    const now = new Date(Date.now() + 60_000);
    const item = [...workQueue(asked, { id: "uw" }, now).mine, ...workQueue(asked, { id: "uw" }, now).team].find((entry) => entry.key === "reply:d3");
    expect(item).toMatchObject({ label: "Reply to Bea Broker (FAKE)'s message", clock: { state: "ok" } });
    const handled = run(asked, underwriter, { t: "noReplyNeeded", dealId: "d3", by: "" }).after;
    expect(deal(handled, "d3").replyHandled?.by).toBe("uw name");
    expect([...workQueue(handled, { id: "uw" }, now).team, ...workQueue(handled, { id: "uw" }, now).mine].some((entry) => entry.key === "reply:d3")).toBe(false);
    expect(check(handled, underwriter, { t: "noReplyNeeded", dealId: "d3", by: "" })).toHaveProperty("error");
  });

  it("checks a notice before it's saved", () => {
    const [olivia, uma] = DEMO_TEAM;
    expect(awayProblem(olivia, olivia, "2026-11-01", "2026-11-02", "2026-10-31")).toMatch(/Someone else/);
    expect(awayProblem(olivia, undefined, "2026-11-01", "2026-11-02", "2026-10-31")).toMatch(/who covers/);
    expect(awayProblem(olivia, uma, "2026-11-03", "2026-11-02", "2026-10-31")).toMatch(/before the first/);
    expect(awayProblem(olivia, uma, "2026-11-01", "2027-02-01", "2026-10-31")).toMatch(/at most/);
    expect(awayProblem(olivia, uma, "2026-11-01", "2026-11-05", "2026-10-31")).toBeNull();
  });

  it("routes an away colleague's loans to whoever covers: queue, notices and the borrower's team card", () => {
    const b = book();
    const [, uma, pat] = DEMO_TEAM;
    const d1 = deal(b, "d1");
    expect(awayToday(b.away, uma, "2026-10-31")?.backup.id).toBe(pat.id);
    expect(awayToday(b.away, uma, "2026-11-05")).toBeUndefined();
    expect(coverOf(d1, b.away, "2026-10-31")).toEqual([expect.objectContaining({ role: "officer", member: expect.objectContaining({ id: uma.id }) })]);
    expect(coverEmails(d1, b.away, "2026-10-31")).toEqual([pat.email]);
    // Pat's queue holds Uma's loans while she's out (the demo's day is October 31).
    const now = new Date("2026-10-31T15:00:00Z");
    const patQueue = workQueue(b, { id: pat.id, email: pat.email }, now);
    expect(patQueue.mine.some((item) => item.deal && deal(b, item.deal.id).team?.officer?.id === uma.id)).toBe(true);
    const later = workQueue(b, { id: pat.id, email: pat.email }, new Date("2026-11-10T15:00:00Z"));
    expect(later.mine.some((item) => item.deal && deal(b, item.deal.id).team?.officer?.id === uma.id && deal(b, item.deal.id).team?.processor?.id !== pat.id)).toBe(false);
    // The borrower sees who covers on their own loans, but not who set it; nobody can set it from a browser.
    const borrowerView = scopeBook(b, person(d1.borrowerId, ["BORROWER"]));
    expect(borrowerView.away).toEqual([expect.objectContaining({ id: uma.id, by: "" })]);
    expect(check(b, owner, { t: "setAway", member: uma, backup: pat, from: "2026-11-01", until: "2026-11-02", by: "" })).toHaveProperty("error");
    const set = run(b, person("server", []), { t: "setAway", member: pat, backup: uma, from: "2026-11-02", until: "2026-11-03", by: "Pat" }, true);
    expect(set.after.away).toHaveLength(2);
    expect(alertsFor(b, set.after, set.action)).toEqual([expect.objectContaining({ to: "email", email: uma.email })]);
    expect(reducer(set.after, { t: "endAway", memberId: pat.id, by: "Pat" }).away).toHaveLength(1);
  });
});

describe("the demo book", () => {
  it("shows each piece: a moved closing, a change waiting for a borrower, a late ask and someone away", () => {
    const b = book();
    expect(movesOfDeal(deal(b, "d1"))).toBe(1);
    expect(openTermChange(deal(b, "d8"))?.lines.length).toBeGreaterThan(0);
    expect(pendingAsks(deal(b, "d7"))).toHaveLength(1);
    expect(b.away).toHaveLength(1);
  });
});
const movesOfDeal = (d: Deal) => d.closingMoves?.length ?? 0;
