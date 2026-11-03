import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attentionCounts } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { defaultScope } from "@/lib/draws";
import { evaluate, fundedBalances } from "@/lib/engine";
import { payoffOn } from "@/lib/loan-exits";
import { seedDeals, type Deal, type PayoffRequest } from "@/lib/mockData";
import { letterPdf } from "@/lib/payoff-pdf";
import { addBusinessDays, holidaysIn, isBusinessDay, letterContent, letterDueBy, letterFigures, matchLoan, payoffReminders, publicRequestProblem, receivedOnFor, staleLetter } from "@/lib/payoffs";
import { can, type Permission } from "@/lib/permissions";
import { payoffFor } from "@/lib/servicing";

// The same fix and flip as the loan exit tests: closed January 15, 2026, current on November 3, 2026.
const loan = (changes: Partial<Deal> = {}): Deal => {
  const base = seedDeals.find((item) => item.id === "d9")!;
  const e = evaluate(base.app);
  return { ...base, id: "L1", borrowerId: "borrower-1", brokerId: undefined, scope: defaultScope(base.app.product, e.holdback, 0), allocations: [{ sourceId: "gt-main", amount: e.noteAmount }], capitalStatus: "funded", closingDate: "2026-01-15", status: "servicing_current", boardedThrough: "2026-12-01", nextPaymentDue: "2026-12-01", paymentsLate: 0, ...changes };
};
const MONTHLY = fundedBalances(evaluate(loan().app), loan().app, loan().disbursedDraws).nextPayment;
const book = (deal: Deal = loan(), extra: Partial<Book> = {}): Book => ({ ...emptyBook(), deals: [deal], ...extra });
const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const servicer = person("servicer", ["SERVICER"]);
const processor = person("proc", ["PROCESSOR"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const borrower = person("borrower-1", ["BORROWER"]);
const system = person("system", []);
const title = { kind: "title" as const, name: "Terry Title", company: "Sunshine Title", email: "terry@sunshine-title.test", fileNumber: "ST-77" };
const logged = (changes: Partial<Extract<BookAction, { t: "logPayoffRequest" }>> = {}): BookAction => ({ t: "logPayoffRequest", dealId: "L1", goodThrough: "2026-11-20", channel: "email", sentOn: "2026-11-03", requester: title, authorized: true, note: "", by: "x", ...changes });
const issue = (payoffId: string, changes: Partial<Extract<BookAction, { t: "issuePayoffLetter" }>> = {}): BookAction => ({ t: "issuePayoffLetter", payoffId, goodThrough: "2026-11-20", reason: "", by: "x", ...changes });
/** A book with one title company request, authorization in hand, and its first letter sent. */
const withLetter = (deal = loan()) => {
  const asked = run(book(deal), servicer, logged()).after;
  const id = asked.payoffs[0].id;
  return { id, ...run(asked, servicer, issue(id)) };
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T17:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("when a payoff request counts as received, and when the letter is due (Fla. Stat. 701.04(1)(f))", () => {
  it("knows the banks' holidays, moving a Sunday one to Monday but not a Saturday one to Friday", () => {
    const y2026 = holidaysIn(2026);
    for (const day of ["2026-01-01", "2026-01-19", "2026-05-25", "2026-06-19", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) expect(y2026.has(day)).toBe(true);
    expect(y2026.has("2026-07-03")).toBe(false);
    expect(holidaysIn(2027).has("2027-07-05")).toBe(true);
    expect(isBusinessDay("2026-11-07")).toBe(false);
    expect(isBusinessDay("2026-11-11")).toBe(false);
    expect(isBusinessDay("2026-11-12")).toBe(true);
  });
  it("counts mail as received five business days after it was posted, and anything else the day it was sent", () => {
    expect(receivedOnFor("mail", "2026-11-03")).toBe("2026-11-10");
    // Veterans Day falls inside it, so it's one more day.
    expect(receivedOnFor("mail", "2026-11-06")).toBe("2026-11-16");
    expect(addBusinessDays("2026-11-07", 5)).toBe("2026-11-16");
    expect(addBusinessDays("2026-11-13", 5)).toBe("2026-11-20");
    expect(receivedOnFor("email", "2026-11-04")).toBe("2026-11-04");
    expect(receivedOnFor("web_form", "2026-11-07")).toBe("2026-11-09");
    expect(receivedOnFor("courier", "2026-11-26")).toBe("2026-11-27");
  });
  it("gives 10 days, moved to the next business day when the tenth is a weekend or holiday", () => {
    expect(letterDueBy("2026-11-04")).toBe("2026-11-16");
    expect(letterDueBy("2026-11-16")).toBe("2026-11-27");
    expect(letterDueBy("2026-10-22")).toBe("2026-11-02");
  });
});

describe("asking for a payoff letter", () => {
  it("lets the borrower ask from the portal, counted as received today, for a date up to 30 days out", () => {
    const { after, action } = run(book(), borrower, { t: "requestPayoff", dealId: "L1", goodThrough: "2026-11-20", by: "" });
    expect(after.payoffs[0]).toMatchObject({ status: "requested", receivedOn: "2026-11-03", channel: "portal", requester: { kind: "borrower", name: "borrower-1 name" } });
    expect(after.payoffs[0].check).toBeUndefined();
    expect(alertsFor(book(), after, action)).toMatchObject([{ to: "team", event: "payoff.requested", body: expect.stringMatching(/until November 13, 2026/) }]);
    expect(check(book(), borrower, { t: "requestPayoff", dealId: "L1", goodThrough: "2026-11-02", by: "" })).toMatchObject({ error: expect.stringMatching(/past/) });
    expect(check(book(), borrower, { t: "requestPayoff", dealId: "L1", goodThrough: "2026-12-04", by: "" })).toMatchObject({ error: expect.stringMatching(/30 days/) });
  });
  it("lets servicing log one that came by mail, from the postmark, and tells the borrower someone else asked", () => {
    const { after, action } = run(book(), servicer, logged({ channel: "mail", sentOn: "2026-11-02", authorized: false }));
    expect(after.payoffs[0]).toMatchObject({ receivedOn: "2026-11-09", channel: "mail", loggedBy: "servicer name", requester: title, check: { status: "pending" } });
    const told = alertsFor(book(), after, action);
    expect(told.map((alert) => [alert.to, alert.event])).toEqual([["team", "payoff.requested"], ["borrower", "payoff.third_party"]]);
    expect(told[0].body).toMatch(/until November 19, 2026.*First: Waiting for the borrower's written authorization/s);
    expect(told[1].body).toMatch(/Terry Title, Sunshine Title \(title company\) asked.*didn't authorize/s);
  });
  it("keeps it to servicing, with a real date sent and a firm for a title company", () => {
    expect(check(book(), processor, logged())).toHaveProperty("error");
    expect(check(book(), servicer, logged({ sentOn: "2026-11-04" }))).toMatchObject({ error: expect.stringMatching(/future/) });
    expect(check(book(), servicer, logged({ requester: { ...title, company: " " } }))).toMatchObject({ error: expect.stringMatching(/title company/) });
    expect(check(book(loan({ status: "underwriting" })), servicer, logged())).toMatchObject({ error: expect.stringMatching(/funded/) });
    expect(parseAction({ ...logged(), requester: { ...title, email: "not an email" } })).toBeNull();
  });
  it("takes the public form's request only from the server, and nothing else the server alone does", () => {
    const submit: BookAction = { t: "submitPayoffRequest", dealId: "L1", goodThrough: "2026-11-20", sentOn: "2026-11-07", requester: title, check: { status: "pending", note: "Signed authorization uploaded with the request.", documentId: "doc1", fileName: "auth.pdf" }, note: "Closing Nov 18" };
    expect(check(book(), owner, submit)).toHaveProperty("error");
    const { after } = run(book(), system, submit, true);
    expect(after.payoffs[0]).toMatchObject({ channel: "web_form", receivedOn: "2026-11-09", note: "Closing Nov 18", check: { documentId: "doc1" } });
    expect(parseAction(submit)).toBeNull();
    expect(parseAction({ t: "payoffLetterDelivered", payoffId: "p", number: 1, to: [], result: "sent" })).toBeNull();
    expect(parseAction({ t: "sendPayoff", payoffId: "p" })).toBeNull();
  });
});

describe("the payoff letter", () => {
  it("waits until someone checks the borrower's authorization", () => {
    const asked = run(book(), servicer, logged({ authorized: false })).after;
    const id = asked.payoffs[0].id;
    expect(check(asked, servicer, issue(id))).toMatchObject({ error: expect.stringMatching(/authorization first/) });
    const checked = run(asked, servicer, { t: "acceptPayoffCheck", payoffId: id, note: "Signed by the managing member", by: "x" }).after;
    expect(checked.payoffs[0].check).toMatchObject({ status: "accepted", by: "servicer name", note: "Signed by the managing member" });
    expect(check(checked, servicer, { t: "acceptPayoffCheck", payoffId: id, note: "", by: "x" })).toMatchObject({ error: expect.stringMatching(/nothing to check/) });
    expect(check(checked, servicer, issue(id))).toHaveProperty("action");
  });
  it("itemizes the payoff as of the good-through date, the same as the payoff that day", () => {
    const { after, id } = withLetter();
    const letter = after.payoffs[0].letters![0];
    const quote = payoffFor(loan(), "2026-11-20");
    expect(after.payoffs[0].status).toBe("sent");
    expect(after.payoffs.find((item) => item.id === id)!.letters).toHaveLength(1);
    expect(letter).toMatchObject({ number: 1, issuedOn: "2026-11-03", issuedBy: "servicer name", goodThrough: "2026-11-20", principal: quote.principal, accrued: quote.accrued, perDiem: quote.perDiem, total: quote.total, interestFrom: "2026-11-01", interestDays: 19, defaultAccrued: 0 });
    expect(letter.replaces).toBeUndefined();
    expect(letter.total).toBeCloseTo(letter.principal + letter.accrued, 2);
  });
  it("splits interest at the default rate from a default's effective date", () => {
    const inDefault = run(book(), owner, { t: "declareDefault", dealId: "L1", kind: "covenant", effectiveOn: "2026-11-02", note: "Unpermitted transfer", by: "x" }).after.deals[0];
    const figures = letterFigures(inDefault, "2026-11-20", "2026-11-03");
    expect(figures).toMatchObject({ interestFrom: "2026-11-01", interestDays: 1, defaultFrom: "2026-11-02", defaultDays: 18 });
    expect(figures.defaultRate).toBeGreaterThan(figures.rate);
    expect(figures.total).toBeCloseTo(figures.principal + figures.accrued + figures.defaultAccrued, 2);
    expect(letterContent(inDefault, { id: "payoffabc1", dealId: "L1", receivedOn: "2026-11-03" } as PayoffRequest, { ...figures, number: 1, issuedAt: "", issuedBy: "" }).rows.map((row) => row.label)).toEqual(["Unpaid principal", `Interest at ${figures.rate.toFixed(2)}%`, `Default interest at ${figures.defaultRate!.toFixed(2)}%`]);
  });
  it("never qualifies its figures or carries wire instructions", () => {
    const { after } = withLetter();
    const content = letterContent(after.deals[0], after.payoffs[0], after.payoffs[0].letters![0]);
    const words = JSON.stringify(content);
    expect(words).not.toMatch(/subject to change|estimate|approximate|reserve the right/i);
    expect(words).not.toMatch(/routing|account number|\b\d{9}\b/i);
    expect(words).toMatch(/no wire instructions/);
    expect(content.to).toEqual(["Terry Title", "Sunshine Title", "terry@sunshine-title.test"]);
    expect(content.reference).toMatch(/^LH-DEMO-1009-P\w{4}-1$/);
    expect(content.corrected).toBeUndefined();
  });
  it("needs a reason for a second letter, and says which one it replaces", () => {
    const { after, id } = withLetter();
    expect(check(after, servicer, issue(id, { goodThrough: "2026-11-25" }))).toMatchObject({ error: expect.stringMatching(/why a new letter/) });
    const again = run(after, servicer, issue(id, { goodThrough: "2026-11-25", reason: "Closing moved to the 24th" })).after;
    const second = again.payoffs[0].letters![1];
    expect(second).toMatchObject({ number: 2, replaces: 1, reason: "Closing moved to the 24th", goodThrough: "2026-11-25" });
    expect(letterContent(again.deals[0], again.payoffs[0], second).corrected).toMatch(/replaces our letter of November 3, 2026 \(Closing moved to the 24th\)/);
  });
  it("can be refused while it's waiting, and the person who asked is told why", () => {
    const asked = run(book(), servicer, logged({ authorized: false })).after;
    const id = asked.payoffs[0].id;
    const { after, action } = run(asked, servicer, { t: "refusePayoff", payoffId: id, reason: "The authorization isn't signed by the borrower.", by: "x" });
    expect(after.payoffs[0]).toMatchObject({ status: "refused", refused: { by: "servicer name" } });
    expect(alertsFor(asked, after, action)).toMatchObject([{ to: "email", email: "terry@sunshine-title.test", event: "payoff.refused", body: expect.stringMatching(/isn't signed by the borrower\. Send a new request/) }]);
    expect(check(after, servicer, issue(id))).toMatchObject({ error: expect.stringMatching(/closed/) });
    expect(check(withLetter().after, servicer, { t: "refusePayoff", payoffId: withLetter().id, reason: "x", by: "x" })).toHaveProperty("error");
  });
  it("records how emailing it went, from the server only, and warns the team when it didn't go", () => {
    const { after, id } = withLetter();
    const delivered: BookAction = { t: "payoffLetterDelivered", payoffId: id, number: 1, to: ["terry@sunshine-title.test"], result: "failed" };
    expect(check(after, owner, delivered)).toHaveProperty("error");
    const next = run(after, system, delivered, true);
    expect(next.after.payoffs[0].letters![0].delivery).toMatchObject({ to: ["terry@sunshine-title.test"], result: "failed" });
    expect(alertsFor(after, next.after, next.action)).toMatchObject([{ to: "team", event: "payoff.undelivered" }]);
  });
  it("shows the borrower every letter, but not who on the team handled it or the authorization", () => {
    const { after, id } = withLetter();
    const delivered = run(after, system, { t: "payoffLetterDelivered", payoffId: id, number: 1, to: ["terry@sunshine-title.test"], result: "sent" }, true).after;
    const mine = scopeBook(delivered, borrower).payoffs[0];
    expect(mine.letters![0]).toMatchObject({ issuedBy: "", total: delivered.payoffs[0].letters![0].total, delivery: { to: [], result: "sent" } });
    expect(mine.check).toEqual({ status: "accepted", note: "" });
    expect(mine.loggedBy).toBeUndefined();
    expect(scopeBook(delivered, person("other", ["BORROWER"])).payoffs).toEqual([]);
  });
});

describe("a letter whose figures move after it's sent", () => {
  it("is flagged when a payment changes the payoff, and the team hears straight away", () => {
    const { after } = withLetter();
    expect(staleLetter(after.deals[0], after.payoffs[0], "2026-11-03")).toBeNull();
    const paid = run(after, servicer, { t: "recordPayment", dealId: "L1", amount: MONTHLY, receivedOn: "2026-11-03", method: "wire", reference: "w1", by: "x" });
    const stale = staleLetter(paid.after.deals[0], paid.after.payoffs[0], "2026-11-03")!;
    expect(stale.now.total).toBeLessThan(stale.letter.total);
    const told = alertsFor(after, paid.after, paid.action).filter((alert) => alert.event === "payoff.stale");
    expect(told).toMatchObject([{ to: "team", body: expect.stringMatching(/Letter 1 to Terry Title.*Interest \$[\d,.]+ → \$0\.00.*3 p\.m\./s) }]);
    expect(attentionCounts(paid.after, 0).payoffs).toBe(1);
    expect(payoffReminders(paid.after, "2026-11-03")).toEqual([expect.stringMatching(/letter 1 to Terry Title.*Send a corrected letter/)]);
  });
  it("is fixed by a corrected letter, and isn't flagged again once its good-through date has passed", () => {
    const { after, id } = withLetter();
    const paid = run(after, servicer, { t: "recordPayment", dealId: "L1", amount: MONTHLY, receivedOn: "2026-11-03", method: "wire", reference: "w1", by: "x" }).after;
    const corrected = run(paid, servicer, issue(id, { reason: "Corrected: the December payment arrived" })).after;
    expect(corrected.payoffs[0].letters![1]).toMatchObject({ replaces: 1 });
    expect(staleLetter(corrected.deals[0], corrected.payoffs[0], "2026-11-03")).toBeNull();
    expect(attentionCounts(corrected, 0).payoffs).toBe(0);
    expect(staleLetter(paid.deals[0], paid.payoffs[0], "2026-11-21")).toBeNull();
  });
});

describe("paying off on a letter (Fla. Stat. 701.04(1)(c)3)", () => {
  const pay = (amount: number, changes: Partial<Extract<BookAction, { t: "recordPayoff" }>> = {}): BookAction => ({ t: "recordPayoff", dealId: "L1", amount, receivedOn: "2026-11-20", method: "wire", reference: "TITLE-9", by: "x", ...changes });
  // The letter went out, then a default raised the payoff, and the title company wired the letter's amount on its
  // good-through date: less than was owed that day.
  const short = () => {
    const { after, id } = withLetter();
    const defaulted = run(after, owner, { t: "declareDefault", dealId: "L1", kind: "covenant", effectiveOn: "2026-11-03", note: "Unpermitted transfer", by: "x" }).after;
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
    return { book: defaulted, id, letter: defaulted.payoffs[0].letters![0], owed: payoffOn(defaulted.deals[0], "2026-11-20").quote.total };
  };
  it("takes the letter's amount as the payoff, records what it left out, and tells everyone the rest is still owed", () => {
    const { book: start, id, letter, owed } = short();
    expect(owed).toBeGreaterThan(letter.total);
    expect(check(start, servicer, pay(letter.total))).toMatchObject({ error: expect.stringMatching(/short of the/) });
    const { after, action } = run(start, servicer, pay(letter.total, { onLetter: { payoffId: id, number: 1 } }));
    expect(after.deals[0]).toMatchObject({ status: "paid_off", paidOff: { amount: letter.total, owed, letter: { payoffId: id, number: 1, total: letter.total, shortfall: Math.round((owed - letter.total) * 100) / 100 } } });
    expect(after.payoffs[0].status).toBe("paid");
    const told = alertsFor(start, after, action);
    expect(told[0]).toMatchObject({ to: "borrower", subject: expect.stringMatching(/Payoff received/), body: expect.stringMatching(/left out \$[\d,.]+ that's still owed/) });
    expect(told[1]).toMatchObject({ to: "team", body: expect.stringMatching(/paid on payoff letter 1.*mortgage has to be released anyway/) });
  });
  it("still won't take less than the letter, a letter past its date, or one from another loan", () => {
    const { book: start, id, letter } = short();
    expect(check(start, servicer, pay(letter.total - 1, { onLetter: { payoffId: id, number: 1 } }))).toMatchObject({ error: expect.stringMatching(/\$1\.00 short of the .* on letter 1/) });
    expect(check(start, servicer, pay(letter.total, { onLetter: { payoffId: id, number: 2 } }))).toMatchObject({ error: expect.stringMatching(/isn't on this loan/) });
    vi.setSystemTime(new Date("2026-11-25T17:00:00Z"));
    expect(check(start, servicer, pay(letter.total, { receivedOn: "2026-11-24", onLetter: { payoffId: id, number: 1 } }))).toMatchObject({ error: expect.stringMatching(/good through 2026-11-20/) });
  });
});

describe("the morning reminder", () => {
  it("lists letters due within two days or late, and nothing further out", () => {
    const request = (id: string, receivedOn: string): PayoffRequest => ({ id, dealId: "L1", goodThrough: "2026-11-20", principal: 0, accrued: 0, perDiem: 0, total: 0, requestedAt: `${receivedOn}T12:00:00Z`, by: "B", status: "requested", receivedOn, requester: { kind: "borrower", name: `Asker ${id}` } });
    const lines = payoffReminders({ deals: [loan()], payoffs: [request("late", "2026-10-22"), request("soon", "2026-10-26"), request("later", "2026-10-30")] }, "2026-11-03");
    expect(lines).toEqual([expect.stringMatching(/Asker late is 1 day late/), expect.stringMatching(/Asker soon is due November 5, 2026/)]);
  });
});

describe("the public request form", () => {
  const fields = { loanNumber: "lh-demo-1009", zip: "33019", kind: "title", name: "Terry Title", company: "Sunshine Title", email: "terry@sunshine-title.test", phone: "", fileNumber: "", goodThrough: "2026-11-20", note: "" };
  it("checks the fields the same way in the browser and on the server", () => {
    expect(publicRequestProblem(fields, "2026-11-03")).toHaveProperty("request");
    expect(publicRequestProblem({ ...fields, company: "" }, "2026-11-03")).toMatchObject({ error: expect.stringMatching(/title company/) });
    expect(publicRequestProblem({ ...fields, kind: "borrower", company: "" }, "2026-11-03")).toHaveProperty("request");
    expect(publicRequestProblem({ ...fields, zip: "3301" }, "2026-11-03")).toMatchObject({ error: expect.stringMatching(/ZIP/) });
    expect(publicRequestProblem({ ...fields, email: "terry" }, "2026-11-03")).toMatchObject({ error: expect.stringMatching(/email/) });
    expect(publicRequestProblem({ ...fields, goodThrough: "2026-12-20" }, "2026-11-03")).toMatchObject({ error: expect.stringMatching(/30 days/) });
  });
  it("finds the loan only when its number and the property's ZIP code both match", () => {
    expect(matchLoan([loan()], " lh-demo-1009 ", "33019")?.id).toBe("L1");
    expect(matchLoan([loan()], "LH-DEMO-1009", "33020")).toBeUndefined();
    expect(matchLoan([loan()], "LH-DEMO-1010", "33019")).toBeUndefined();
  });
});

describe("the PDF", () => {
  it("is a PDF of the letter", async () => {
    const { after } = withLetter();
    const bytes = await letterPdf(letterContent(after.deals[0], after.payoffs[0], after.payoffs[0].letters![0]));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });
});
