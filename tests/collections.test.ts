import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { carryingCosts, claimDueOn, defaultNotice, lossSplit, nextAction, openBankruptcy, owedAtTitle, promiseState, reoProceeds, stageOf } from "@/lib/collections";
import { evaluate } from "@/lib/engine";
import { payoffParts, splitOf, statementFor } from "@/lib/investor-statements";
import { lienReleaseOpen } from "@/lib/loan-exits";
import type { Deal } from "@/lib/mockData";
import { letterFigures } from "@/lib/payoffs";
import { can, type Permission } from "@/lib/permissions";
import { advancesOwed, balanceOf, ledgerOf, payoffFor } from "@/lib/servicing";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};
const servicer = person("svc", ["SERVICER"]);
const owner = person("own", ["ADMIN_OWNER"]);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const at = new Date("2026-10-31T15:00:00Z");
const queue = (b: Book, dealId: string) => workQueue(b, { id: "" }, at).team.filter((item) => item.deal?.id === dealId).map((item) => item.label);

/** d11 is half the demo partner's; with its two payments taken out it's behind, so it can go all the way to foreclosure. */
function behindAndHalfHeld() {
  const b = demoBook();
  return { ...b, deals: b.deals.map((d) => (d.id === "d11" ? { ...d, payments: [] } : d)) };
}
/** Declared in default with a notice of default that arrived and whose cure period is over, ready for the attorney. */
function readyToForeclose(dealId: string, b: Book) {
  let next = run(b, owner, { t: "declareDefault", dealId, kind: "monetary", effectiveOn: "2026-09-20", note: "Behind (FAKE)", by: "x" });
  next = run(next, servicer, { t: "logNotice", dealId, kind: "default", sentOn: "2026-09-22", method: "certified_mail", to: "Borrower, 1 Sample St", tracking: "9407 1000 (FAKE)", amount: 4_000, by: "x" });
  const notice = deal(next, dealId).notices!.at(-1)!;
  return run(next, servicer, { t: "noticeOutcome", dealId, noticeId: notice.id, outcome: "delivered", on: "2026-09-25", detail: "Green card signed (FAKE)", by: "x" });
}

describe("collections on a late loan", () => {
  it("shows where it stands and what to do next", () => {
    const b = demoBook();
    const today = serviceDay(b);
    const d13 = deal(b, "d13");
    expect(stageOf(d13, today)).toBe("delinquent");
    expect(stageOf(deal(b, "d2"), today)).toBeNull();
    // The demo's promise for the October payment came and went with nothing in, so the queue asks for another call.
    expect(promiseState(d13, d13.promises![0], today)).toEqual({ state: "broken", received: 0 });
    expect(nextAction(d13, today)).toBe("Promise broken: call again");
    expect(queue(b, "d13")).toContain("Promise to pay broken: call again");
  });

  it("keeps the calls and a promise, which is kept once that much arrives by the day", () => {
    let b = demoBook();
    const today = serviceDay(b);
    expect(check(b, person("b", ["BORROWER"]), { t: "logContact", dealId: "d13", on: today, channel: "call", with: "Sam", outcome: "reached", note: "", by: "x" })).toHaveProperty("error");
    expect(check(b, servicer, { t: "logContact", dealId: "d13", on: "2099-01-01", channel: "call", with: "Sam", outcome: "reached", note: "", by: "x" })).toEqual({ error: "The date can't be in the future." });
    b = run(b, servicer, { t: "logContact", dealId: "d13", on: today, channel: "call", with: "Sam Sample", outcome: "reached", note: "Will wire Monday (FAKE)", by: "x" });
    expect(deal(b, "d13").contacts!.at(-1)).toMatchObject({ with: "Sam Sample", by: "svc name" });
    expect(check(b, servicer, { t: "recordPromise", dealId: "d13", amount: 0, dueBy: today, note: "", by: "x" })).toEqual({ error: "Enter the amount promised." });
    expect(check(b, servicer, { t: "recordPromise", dealId: "d13", amount: 100, dueBy: "2027-03-01", note: "", by: "x" })).toMatchObject({ error: expect.stringMatching(/next 45 days/) });
    b = run(b, servicer, { t: "recordPromise", dealId: "d13", amount: 2_000, dueBy: "2026-11-04", note: "", by: "x" });
    const promise = deal(b, "d13").promises!.at(-1)!;
    expect(promiseState(deal(b, "d13"), promise, today).state).toBe("open");
    const paid: Deal = { ...deal(b, "d13"), payments: [...(deal(b, "d13").payments ?? []), { id: "p1", amount: 2_000, receivedOn: "2026-11-03", method: "wire", reference: "W", by: "x", at: "2026-11-03T12:00:00Z" }] };
    expect(promiseState(paid, promise, "2026-11-05").state).toBe("kept");
    expect(promiseState(deal(b, "d13"), promise, "2026-11-05").state).toBe("broken");
  });

  it("records notices and the proof they arrived, and starts the cure clock on a notice of default", () => {
    let b = demoBook();
    expect(check(b, servicer, { t: "logNotice", dealId: "d13", kind: "default", sentOn: "2026-10-30", method: "certified_mail", to: "x", tracking: "1", amount: 1, by: "x" })).toEqual({ error: "Declare the default first." });
    expect(check(b, servicer, { t: "logNotice", dealId: "d13", kind: "late", sentOn: "2026-10-30", method: "certified_mail", to: "x", tracking: "", amount: 1, by: "x" })).toEqual({ error: "Enter the tracking number." });
    expect(check(b, servicer, { t: "logNotice", dealId: "d2", kind: "late", sentOn: "2026-10-30", method: "first_class", to: "x", tracking: "", amount: 1, by: "x" })).toEqual({ error: "No payment is late." });
    b = readyToForeclose("d13", b);
    const sent = defaultNotice(deal(b, "d13"))!;
    expect(sent.notice).toMatchObject({ cureBy: "2026-10-22", delivered: { on: "2026-09-25", proof: "Green card signed (FAKE)" } });
    expect(sent.cureEnds).toBe("2026-10-22");
    expect(check(b, servicer, { t: "noticeOutcome", dealId: "d13", noticeId: sent.notice.id, outcome: "returned", on: "2026-09-26", detail: "x", by: "x" })).toEqual({ error: "That notice's delivery is already recorded." });
    expect(nextAction(deal(b, "d13"), serviceDay(b))).toBe("Cure period over: refer it to the foreclosure attorney");
    expect(queue(b, "d13")).toContain("Cure period over: refer it to the foreclosure attorney");
    // The borrower and broker see none of the file.
    const mine = scopeBook(b, person(deal(b, "d13").borrowerId, ["BORROWER"])).deals.find((d) => d.id === "d13")!;
    expect([mine.contacts, mine.promises, mine.notices, mine.bankruptcies, mine.foreclosure]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("a bankruptcy", () => {
  const filed = () => run(demoBook(), servicer, { t: "recordBankruptcy", dealId: "d13", debtor: "Sample Holdings LLC (FAKE)", chapter: 13, caseNumber: "26-12345-RAM", court: "U.S. Bankruptcy Court, S.D. Fla.", filedOn: "2026-10-28", by: "x" });
  it("pauses collection while the automatic stay is on", () => {
    const b = filed();
    const d13 = deal(b, "d13");
    expect(stageOf(d13, serviceDay(b))).toBe("bankruptcy");
    expect(check(b, servicer, { t: "recordPromise", dealId: "d13", amount: 100, dueBy: "2026-11-05", note: "", by: "x" })).toMatchObject({ error: expect.stringMatching(/automatic stay/) });
    expect(check(b, servicer, { t: "logNotice", dealId: "d13", kind: "late", sentOn: "2026-10-30", method: "first_class", to: "x", tracking: "", amount: 1, by: "x" })).toMatchObject({ error: expect.stringMatching(/automatic stay/) });
    expect(check(b, owner, { t: "declareDefault", dealId: "d13", kind: "monetary", effectiveOn: "2026-10-30", note: "x", by: "x" })).toMatchObject({ error: expect.stringMatching(/Declaring a default has to wait/) });
    expect(check(b, servicer, { t: "recordBankruptcy", dealId: "d13", debtor: "x", chapter: 7, caseNumber: "1", court: "x", filedOn: "2026-10-29", by: "x" })).toEqual({ error: "A bankruptcy case is already open on this loan." });
    // The queue asks for the proof of claim by its deadline and stops asking for collection calls.
    expect(claimDueOn(openBankruptcy(d13)!)).toBe("2027-01-06");
    expect(queue(b, "d13")).toContain("File the proof of claim in the bankruptcy");
    expect(queue(b, "d13")).not.toContain("Payment past due");
    expect(queue(b, "d13")).not.toContain("Promise to pay broken: call again");
  });
  it("stops the late and maturity emails to the borrower, not the team's", () => {
    const b = filed();
    const action: BookAction = { t: "settleLoans", asOf: "2026-11-20" };
    const alerts = alertsFor(b, reducer(b, action), action).filter((alert) => alert.dealId === "d13" || alert.body.includes(deal(b, "d13").borrowerName));
    expect(alerts.some((alert) => alert.to === "team" && alert.event === "payment.late")).toBe(true);
    expect(alerts.some((alert) => alert.to === "borrower")).toBe(false);
    // Without the case, the borrower hears about the late payment.
    const plain = demoBook();
    expect(alertsFor(plain, reducer(plain, action), action).some((alert) => alert.to === "borrower" && alert.dealId === "d13" && alert.event === "payment.late")).toBe(true);
  });
  it("ends, and collection goes on", () => {
    let b = filed();
    const id = openBankruptcy(deal(b, "d13"))!.id;
    b = run(b, servicer, { t: "bankruptcyClaimFiled", dealId: "d13", bankruptcyId: id, on: "2026-10-30", by: "x" });
    expect(queue(b, "d13")).not.toContain("File the proof of claim in the bankruptcy");
    b = run(b, servicer, { t: "endBankruptcy", dealId: "d13", bankruptcyId: id, on: "2026-10-31", how: "dismissed", by: "x" });
    expect(stageOf(deal(b, "d13"), serviceDay(b))).toBe("delinquent");
    expect(check(b, servicer, { t: "recordPromise", dealId: "d13", amount: 100, dueBy: "2026-11-05", note: "", by: "x" })).not.toHaveProperty("error");
  });
});

describe("a foreclosure", () => {
  it("waits for the cure period, then goes step by step in order", () => {
    let b = run(demoBook(), owner, { t: "declareDefault", dealId: "d13", kind: "monetary", effectiveOn: "2026-10-20", note: "x", by: "x" });
    expect(check(b, owner, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-31", by: "x" })).toMatchObject({ error: expect.stringMatching(/notice of default first/) });
    b = run(b, servicer, { t: "logNotice", dealId: "d13", kind: "default", sentOn: "2026-10-21", method: "certified_mail", to: "x", tracking: "1", amount: 1, by: "x" });
    expect(check(b, owner, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-31", by: "x" })).toEqual({ error: "The notice of default's cure period runs to Nov 20, 2026." });
    b = readyToForeclose("d13", demoBook());
    expect(check(b, servicer, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-26", by: "x" })).toHaveProperty("error");
    b = run(b, owner, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-26", by: "x" });
    expect(stageOf(deal(b, "d13"), serviceDay(b))).toBe("foreclosure");
    expect(check(b, owner, { t: "foreclosureStep", dealId: "d13", step: "served", on: "2026-10-28", note: "", by: "x" })).toEqual({ error: "The next step is: complaint filed and lis pendens recorded." });
    b = run(b, owner, { t: "foreclosureStep", dealId: "d13", step: "complaint_filed", on: "2026-10-27", note: "", caseNumber: "CACE-26-001 (FAKE)", county: "Broward", by: "x" });
    expect(deal(b, "d13").foreclosure).toMatchObject({ caseNumber: "CACE-26-001 (FAKE)", county: "Broward" });
    expect(check(b, owner, { t: "foreclosureStep", dealId: "d13", step: "served", on: "2026-10-20", note: "", by: "x" })).toEqual({ error: "That's before the step before it." });
  });

  it("ends with a payoff, a modification or the borrower bringing it current", () => {
    let b = readyToForeclose("d13", demoBook());
    b = run(b, owner, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-26", by: "x" });
    b = run(b, servicer, { t: "recordAdvance", dealId: "d13", on: "2026-10-27", kind: "attorney", amount: 1_500, note: "Retainer (FAKE)", by: "x" });
    const quote = payoffFor(deal(b, "d13"), "2026-10-31");
    expect(quote.advances).toBe(1_500);
    expect(quote.total).toBeCloseTo(payoffFor(deal(readyToForeclose("d13", demoBook()), "d13"), "2026-10-31").total + 1_500, 2);
    expect(letterFigures(deal(b, "d13"), "2026-10-31", "2026-10-31").advances).toBe(1_500);
    const paid = run(b, servicer, { t: "recordPayoff", dealId: "d13", amount: quote.total, receivedOn: "2026-10-31", method: "wire", reference: "WIRE-1", by: "x" });
    const d13 = deal(paid, "d13");
    expect(d13.foreclosure!.stopped).toMatchObject({ why: "paid_off" });
    // Costs come back to LendHous first; the rest of the payoff over principal is interest.
    expect(payoffParts(d13).interest).toBeCloseTo(quote.total - balanceOf(d13) - 1_500, 2);
  });

  it("ends in a sale: a third party's bid pays the loan, short or not", () => {
    let b = readyToForeclose("d13", demoBook());
    b = run(b, owner, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-26", by: "x" });
    for (const [step, on, extra] of [["complaint_filed", "2026-10-27", {}], ["served", "2026-10-28", {}], ["default_entered", "2026-10-29", {}], ["judgment", "2026-10-30", { judgment: { amount: 260_000, saleOn: "2026-10-31" } }], ["sale_held", "2026-10-31", { sale: { winner: "third_party", amount: 150_000 } }]] as const) {
      b = run(b, owner, { t: "foreclosureStep", dealId: "d13", step, on, note: "", ...extra, by: "x" });
    }
    expect(check(b, owner, { t: "foreclosureStep", dealId: "d13", step: "certificate_of_title", on: "2026-10-31", note: "", by: "x" })).toEqual({ error: "A third party won the sale: record the money from the clerk instead." });
    expect(queue(b, "d13")).toContain("Record the sale money from the clerk");
    const owed = payoffFor(deal(b, "d13"), "2026-10-31", ledgerOf(deal(b, "d13"), "2026-10-31")).total;
    expect(check(b, owner, { t: "saleProceeds", dealId: "d13", amount: owed + 10, on: "2026-10-31", reference: "CLERK-1", by: "x" })).toMatchObject({ error: expect.stringMatching(/any surplus goes to the owner/) });
    b = run(b, owner, { t: "saleProceeds", dealId: "d13", amount: 150_000, on: "2026-10-31", reference: "CLERK-1", by: "x" });
    const d13 = deal(b, "d13");
    expect(d13.status).toBe("paid_off");
    expect(d13.paidOff).toMatchObject({ amount: 150_000, foreclosureSale: { saleOn: "2026-10-31", shortfall: Math.round((owed - 150_000) * 100) / 100 } });
    expect(payoffParts(d13)).toEqual({ principal: 150_000, interest: 0 });
    expect(lienReleaseOpen(d13)).toBe(false);
  });

  it("ends with the property LendHous's, sold, and the loss split by who holds the loan", () => {
    let b = readyToForeclose("d11", behindAndHalfHeld());
    b = run(b, owner, { t: "referForeclosure", dealId: "d11", attorney: "Sample Law (FAKE)", on: "2026-10-26", by: "x" });
    b = run(b, servicer, { t: "recordAdvance", dealId: "d11", on: "2026-10-26", kind: "attorney", amount: 2_000, note: "", by: "x" });
    for (const [step, on, extra] of [["complaint_filed", "2026-10-27", {}], ["served", "2026-10-28", {}], ["default_entered", "2026-10-29", {}], ["judgment", "2026-10-29", { judgment: { amount: 300_000, saleOn: "2026-10-30" } }], ["sale_held", "2026-10-30", { sale: { winner: "lendhous", amount: 300_000 } }]] as const) {
      b = run(b, owner, { t: "foreclosureStep", dealId: "d11", step, on, note: "", ...extra, by: "x" });
    }
    const before = deal(b, "d11");
    const owed = owedAtTitle(before, "2026-10-31");
    b = run(b, owner, { t: "foreclosureStep", dealId: "d11", step: "certificate_of_title", on: "2026-10-31", note: "", by: "x" });
    const d11 = deal(b, "d11");
    expect(d11.status).toBe("reo");
    expect(d11.reo).toMatchObject({ since: "2026-10-31", how: "certificate_of_title", owed: { principal: balanceOf(before), advances: 2_000 } });
    expect(owed.interest).toBeGreaterThan(0);
    expect(stageOf(d11, "2026-10-31")).toBe("reo");
    expect(queue(b, "d11")).toContain("List the bank-owned property for sale");
    // Once it's LendHous's, costs are carrying costs, not owed by the borrower.
    b = run(b, servicer, { t: "recordAdvance", dealId: "d11", on: "2026-10-31", kind: "taxes", amount: 3_000, note: "", by: "x" });
    expect(carryingCosts(deal(b, "d11"))).toBe(3_000);
    expect(advancesOwed(deal(b, "d11"))).toBe(2_000);
    expect(check(b, owner, { t: "sellReo", dealId: "d11", on: "2026-10-31", price: 1, closingCosts: 0, reference: "R", by: "x" })).not.toHaveProperty("error");
    b = run(b, owner, { t: "listReo", dealId: "d11", on: "2026-10-31", price: 280_000, value: 275_000, by: "x" });
    const principal = d11.reo!.owed.principal;
    const price = principal * 0.8;
    const listed = b;
    const sell: BookAction = { t: "sellReo", dealId: "d11", on: "2026-10-31", price, closingCosts: 15_000, reference: "REO-CLOSE-1", by: "x" };
    b = run(b, owner, sell);
    const sold = deal(b, "d11");
    // The partner hears its loan is closed out, though closing it out let the capital go.
    expect(alertsFor(listed, b, sell).filter((alert) => alert.to === "partner").map((alert) => alert.event)).toEqual(["foreclosure.closed"]);
    const paid = reoProceeds(sold);
    // The sale's own costs, then LendHous's 5,000 of costs, then principal; the rest of principal is the loss.
    expect(paid).toMatchObject({ net: Math.round((price - 15_000) * 100) / 100, costs: 5_000, costsBack: 5_000, interest: 0 });
    expect(paid.principal).toBeCloseTo(price - 15_000 - 5_000, 2);
    expect(paid.principalLoss).toBeCloseTo(principal - paid.principal, 2);
    const split = lossSplit(b, sold);
    expect(split.map((line) => line.who)).toEqual([b.partners.find((p) => p.id === b.bids.find((bid) => bid.dealId === "d11" && bid.status === "accepted")!.partnerId)!.name, "LendHous"]);
    expect(split.reduce((sum, line) => sum + line.loss, 0)).toBeCloseTo(paid.principalLoss, 1);
    expect(stageOf(sold, "2026-10-31")).toBeNull();
    // The partner's share of what came back is owed to it, and its statement shows it with nothing left outstanding.
    const partnerId = b.bids.find((bid) => bid.dealId === "d11" && bid.status === "accepted")!.partnerId;
    const proceeds = b.partners.find((p) => p.id === partnerId)!.proceeds!.at(-1)!;
    const share = b.bids.find((bid) => bid.dealId === "d11" && bid.status === "accepted")!.pct / 100;
    expect(proceeds).toMatchObject({ dealId: "d11", on: "2026-10-31" });
    expect(proceeds.principal).toBeCloseTo(share * paid.principal, 2);
    const line = statementFor(b, { type: "partner", id: partnerId }, "2026-10").lines.find((item) => item.dealId === "d11")!;
    expect(line).toMatchObject({ balance: 0, status: "reo" });
    expect(line.principal).toBeCloseTo(share * paid.principal, 2);
    expect(splitOf({ deal: sold, share, investorRate: 9, noteRate: evaluate(sold.app).rate }, (day) => day === "2026-10-31").principal).toBeCloseTo(share * paid.principal, 2);
    // A partner holding the loan sees the case and the sale, without the team's notes.
    const held = scopeBook(b, person("pp", ["PARTNER_LENDER"], partnerId)).deals.find((d) => d.id === "d11")!;
    expect(held.reo?.sold?.price).toBe(price);
    expect(held.foreclosure?.steps.every((step) => step.note === "" && step.by === "")).toBe(true);
    expect(held.contacts).toBeUndefined();
  });

  it("can end with a deed in lieu instead", () => {
    let b = readyToForeclose("d13", demoBook());
    b = run(b, owner, { t: "referForeclosure", dealId: "d13", attorney: "Sample Law (FAKE)", on: "2026-10-26", by: "x" });
    b = run(b, owner, { t: "stopForeclosure", dealId: "d13", on: "2026-10-30", why: "deed_in_lieu", note: "Recorded OR BK 1 PG 2 (FAKE)", by: "x" });
    expect(deal(b, "d13")).toMatchObject({ status: "reo", reo: { how: "deed_in_lieu", since: "2026-10-30" }, foreclosure: { stopped: { why: "deed_in_lieu" } } });
  });
});
