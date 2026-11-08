import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { addBusinessDays, closingShare, creditOf, currentBids, DRAW_CALL_DAYS, payoffProceeds, proceedsToSend, transferProblem, transferQuote, unsettledTransfers } from "@/lib/capital-moves";
import { evaluate } from "@/lib/engine";
import { holdingsOf, splitOf, statementFor } from "@/lib/investor-statements";
import { drawHolds } from "@/lib/lien-law";
import { payoffOn } from "@/lib/loan-exits";
import { DEMO_PARTNER_ID, type Deal } from "@/lib/mockData";
import { partnerFundsBlocker, sentProblem, toWire } from "@/lib/partner-funding";
import { can, type Permission } from "@/lib/permissions";
import { workQueue } from "@/lib/work-queue";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const owner = person("owner", ["ADMIN_OWNER"]);
const pia = person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID);
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
// The demo partner holds half of d11, a funded bridge loan, at 9.25%.
const payOff = (b: Book, on = "2026-10-30") => {
  const total = payoffOn(deal(b, "d11"), on).quote.total;
  return run(b, owner, { t: "recordPayoff", dealId: "d11", amount: total, receivedOn: on, method: "wire", reference: "PAYOFF", by: "x" });
};

describe("a partner's money at payoff", () => {
  it("is sent by default, with what it came to", () => {
    const b = demoBook();
    const { after, action } = payOff(b);
    const [item] = after.partners.find((p) => p.id === DEMO_PARTNER_ID)!.proceeds!;
    expect(item).toMatchObject({ dealId: "d11", choice: "send", rolled: 0 });
    // Half the principal, and half the interest at the partner's 9.25% rather than the note's rate.
    expect(item.principal).toBeCloseTo(evaluate(deal(b, "d11").app).noteAmount / 2, 0);
    expect(item.toSend).toBeCloseTo(item.principal + item.interest, 2);
    expect(proceedsToSend(after.partners)).toHaveLength(1);
    const told = alertsFor(b, after, action).filter((alert) => alert.to === "partner");
    expect(told).toMatchObject([{ firmId: DEMO_PARTNER_ID, event: "investor.paid_off" }]);
    expect(told[0].body).toMatch(/LendHous will send it to you/);
  });
  it("rolls the principal, or all of it, into the partner's next loan, which wires less", () => {
    const b = demoBook();
    expect(check(b, person("other", ["PARTNER_LENDER"], "p-b"), { t: "setRollover", partnerId: DEMO_PARTNER_ID, choice: "all", by: "x" })).toHaveProperty("error");
    const principal = payOff(run(b, pia, { t: "setRollover", partnerId: DEMO_PARTNER_ID, choice: "principal", by: "x" }).after).after;
    const kept = principal.partners.find((p) => p.id === DEMO_PARTNER_ID)!.proceeds![0];
    expect(kept.rolled).toBe(kept.principal);
    expect(kept.toSend).toBe(kept.interest);
    const all = payOff(run(b, pia, { t: "setRollover", partnerId: DEMO_PARTNER_ID, choice: "all", by: "x" }).after).after;
    const rolled = all.partners.find((p) => p.id === DEMO_PARTNER_ID)!.proceeds![0];
    expect(rolled.toSend).toBe(0);
    expect(creditOf(all, DEMO_PARTNER_ID)).toBe(rolled.rolled);
    expect(proceedsToSend(all.partners)).toEqual([]);
    // The partner's next accepted bid takes the rolled money first.
    const won = run(all, owner, { t: "acceptBid", bidId: "bid1" }).after;
    const funding = deal(won, "d3").partnerFunding!;
    expect(funding.fromCredit).toBe(Math.min(rolled.rolled, funding.amount));
    expect(toWire(funding)).toBe(Math.max(0, Math.round((funding.amount - funding.fromCredit!) * 100) / 100));
    expect(creditOf(won, DEMO_PARTNER_ID)).toBeCloseTo(Math.max(0, rolled.rolled - funding.amount), 2);
    // Money that covers the whole share needs no wire, and doesn't hold the closing.
    const covered = { ...funding, fromCredit: funding.amount };
    expect(partnerFundsBlocker({ partnerFunding: covered })).toBeNull();
    expect(sentProblem({ ...deal(won, "d3"), status: "clear_to_close", partnerFunding: covered }, DEMO_PARTNER_ID)).toMatch(/nothing to send/);
    // A loan that falls through gives the money back.
    const fell: Book = { ...won, deals: won.deals.map((d) => (d.id === "d3" ? { ...d, status: "withdrawn" as const } : d)) };
    expect(creditOf(fell, DEMO_PARTNER_ID)).toBe(rolled.rolled);
  });
  it("is sent by the team, who records the wire", () => {
    const after = payOff(demoBook()).after;
    const item = after.partners.find((p) => p.id === DEMO_PARTNER_ID)!.proceeds![0];
    const send: BookAction = { t: "sendProceeds", partnerId: DEMO_PARTNER_ID, proceedsId: item.id, on: "2026-10-31", reference: "FED 1", by: "x" };
    expect(check(after, pia, send)).toHaveProperty("error");
    const sent = run(after, owner, send);
    expect(sent.after.partners.find((p) => p.id === DEMO_PARTNER_ID)!.proceeds![0].sent).toMatchObject({ on: "2026-10-31", reference: "FED 1", by: "owner name" });
    expect(alertsFor(after, sent.after, sent.action)).toMatchObject([{ to: "partner", event: "investor.proceeds_sent" }]);
    expect(check(sent.after, owner, send)).toHaveProperty("error");
    const queue = workQueue(after, { id: "" }, new Date("2026-10-31T16:00:00Z"));
    expect([...queue.mine, ...queue.team].some((entry) => entry.key === `proceeds:${item.id}`)).toBe(true);
  });
  it("tells the partner a payoff may be coming, and what will happen to its money", () => {
    const b = demoBook();
    // The borrower on d11 asks for a payoff letter.
    const { after, action } = run(b, person("b-avery", ["BORROWER"]), { t: "requestPayoff", dealId: "d11", goodThrough: "2026-11-20", by: "" });
    const told = alertsFor(b, after, action).find((alert) => alert.event === "investor.payoff_coming");
    expect(told).toMatchObject({ to: "partner", firmId: DEMO_PARTNER_ID });
    expect(told!.body).toMatch(/send it to me/);
  });
});

describe("moving a partner's share mid-loan", () => {
  it("prices it at par plus interest at the partner's rate to the day", () => {
    const b = demoBook();
    const bid = currentBids(b, "d11")[0];
    const quote = transferQuote(deal(b, "d11"), bid, "2026-10-20");
    const { quote: payoff } = payoffOn(deal(b, "d11"), "2026-10-20");
    expect(quote.principal).toBeCloseTo(payoff.principal / 2, 2);
    expect(quote.accrued).toBeCloseTo((payoff.accrued / 2) * (bid.lenderRate / evaluate(deal(b, "d11").app).rate), 2);
    expect(quote.price).toBeCloseTo(quote.principal + quote.holdback + quote.accrued, 2);
    expect(quote.perDiem).toBeGreaterThan(0);
  });
  it("checks who can take it and when", () => {
    const b = demoBook();
    const d11 = deal(b, "d11");
    expect(transferProblem(b, d11, DEMO_PARTNER_ID, "p-b", "2026-11-30", "2026-10-31")).toMatch(/day that's come/);
    expect(transferProblem(b, d11, DEMO_PARTNER_ID, "p-d", "2026-10-20", "2026-10-31")).toMatch(/NDA/);
    expect(transferProblem(b, d11, "p-b", "p-c", "2026-10-20", "2026-10-31")).toMatch(/doesn't hold a share/);
    expect(transferProblem(b, deal(b, "d3"), DEMO_PARTNER_ID, "p-b", "2026-10-20", "2026-10-31")).toMatch(/funded loan/);
    expect(check(b, pia, { t: "transferShare", dealId: "d11", from: DEMO_PARTNER_ID, to: "p-b", on: "2026-10-20", by: "x" })).toHaveProperty("error");
  });
  it("hands the payments on from that day, and the new holder sees the loan", () => {
    const b = demoBook();
    const { after, action } = run(b, owner, { t: "transferShare", dealId: "d11", from: DEMO_PARTNER_ID, to: "p-b", on: "2026-10-15", rate: 9.5, by: "x" });
    const d11 = deal(after, "d11");
    expect(d11.allocations.map((item) => item.sourceId).sort()).toEqual(["gt-main", "partner:p-b"]);
    expect(d11.teaserSentTo).toContain("p-b");
    expect(d11.transfers![0]).toMatchObject({ from: DEMO_PARTNER_ID, to: "p-b", pct: 50, on: "2026-10-15", rate: 9.5 });
    const [old] = holdingsOf(after, { type: "partner", id: DEMO_PARTNER_ID });
    const [taken] = holdingsOf(after, { type: "partner", id: "p-b" });
    expect(old).toMatchObject({ until: "2026-10-15" });
    expect(taken).toMatchObject({ since: "2026-10-15", investorRate: 9.5 });
    // The November 1 payment, paid before the move in the demo, stays the old partner's; nothing after it is.
    const all = (holding: typeof old) => splitOf(holding, () => true).payments;
    const before = splitOf({ ...old, until: undefined }, () => true).payments;
    expect(all(old) + all(taken)).toBe(before);
    expect(statementFor(after, { type: "partner", id: DEMO_PARTNER_ID }, "2026-10").lines[0]?.balance ?? 0).toBe(0);
    expect(alertsFor(b, after, action).map((alert) => [alert.to, alert.firmId ?? ""])).toEqual([["partner", DEMO_PARTNER_ID], ["partner", "p-b"], ["team", ""]]);
    // The new holder sees the loan as its own, with the transfer; a partner that wasn't part of it sees neither.
    const theirs = scopeBook(after, person("bo", ["PARTNER_LENDER"], "p-b")).deals.find((d) => d.id === "d11")!;
    expect(theirs.transfers).toHaveLength(1);
    expect(theirs.allocations).toEqual([]);
    expect(scopeBook(after, person("cy", ["PARTNER_LENDER"], "p-c")).deals.find((d) => d.id === "d11")?.transfers).toBeUndefined();
    // The team settles it once the money has moved.
    expect(unsettledTransfers(after.deals)).toHaveLength(1);
    const settled = run(after, owner, { t: "settleTransfer", dealId: "d11", transferId: d11.transfers![0].id, on: "2026-10-20", reference: "FED 2", by: "x" }).after;
    expect(unsettledTransfers(settled.deals)).toEqual([]);
  });
  it("can bring a share back onto LendHous's own books", () => {
    const after = run(demoBook(), owner, { t: "transferShare", dealId: "d11", from: DEMO_PARTNER_ID, to: "gt-main", on: "2026-10-15", by: "x" }).after;
    const d11 = deal(after, "d11");
    expect(d11.allocations).toEqual([{ sourceId: "gt-main", amount: evaluate(d11.app).noteAmount }]);
    expect(d11.route).toBe("in_house");
    expect(currentBids(after, "d11")).toEqual([]);
    // And a payoff after it pays no partner.
    expect(payOff(after).after.partners.find((p) => p.id === DEMO_PARTNER_ID)!.proceeds).toBeUndefined();
  });
});

describe("partners who fund draws as they're released", () => {
  it("wire only their share of the rest at closing", () => {
    const b = demoBook();
    const d3 = deal(b, "d3");
    expect(check(b, pia, { t: "setFundsDraws", partnerId: DEMO_PARTNER_ID, on: true })).toHaveProperty("error");
    const set = run(b, owner, { t: "setFundsDraws", partnerId: DEMO_PARTNER_ID, on: true }).after;
    const funding = deal(run(set, owner, { t: "acceptBid", bidId: "bid1" }).after, "d3").partnerFunding!;
    const e = evaluate(d3.app);
    expect(funding).toMatchObject({ drawsAsReleased: true, amount: Math.round(e.noteAmount - e.holdback) });
    expect(closingShare(d3, 100, false)).toBe(Math.round(e.noteAmount));
  });
  it("are asked for their share of each draw, due in a few business days", () => {
    // The demo flip, half held by the demo partner, which sends its share as draws are released.
    const base = demoBook();
    const today = serviceDay(base);
    const bid = { id: "bid-d2", dealId: "d2", partnerId: DEMO_PARTNER_ID, pct: 50, lenderRate: 9.5, lenderPoints: 0, conditions: "", status: "accepted" as const, type: "bid" as const, at: "2026-08-01T00:00:00Z" };
    const draw = { ...base.draws.find((item) => item.id === "draw-1")!, status: "approved" as const, approved: 10_000, approvers: ["Cam"] };
    const withHolds = { ...draw, override: { holds: drawHolds(deal(base, "d2"), draw, today), by: "Owner", reason: "test", at: "x" } };
    const b: Book = { ...base, bids: [...base.bids, bid], draws: base.draws.map((item) => (item.id === "draw-1" ? withHolds : item)), deals: base.deals.map((d): Deal => (d.id === "d2" ? { ...d, partnerFunding: { partnerId: DEMO_PARTNER_ID, amount: 100_000, drawsAsReleased: true, received: { on: "2026-09-04", by: "x", at: "x" } }, allocations: [{ sourceId: `partner:${DEMO_PARTNER_ID}`, amount: 250_000 }, { sourceId: "gt-main", amount: 250_000 }] } : d)) };
    const { after, action } = run(b, owner, { t: "releaseDraw", drawId: "draw-1" });
    const [call] = deal(after, "d2").drawCalls!;
    expect(call).toMatchObject({ partnerId: DEMO_PARTNER_ID, amount: 5_000, drawId: "draw-1", calledOn: today, dueOn: addBusinessDays(today, DRAW_CALL_DAYS) });
    expect(alertsFor(b, after, action).find((alert) => alert.to === "partner")).toMatchObject({ firmId: DEMO_PARTNER_ID, event: "investor.draw_call" });
    // The partner says it's sent; the team confirms it arrived.
    expect(check(after, person("other", ["PARTNER_LENDER"], "p-b"), { t: "drawCallSent", dealId: "d2", callId: call.id, on: today, reference: "", by: "x" })).toHaveProperty("error");
    const sent = run(after, pia, { t: "drawCallSent", dealId: "d2", callId: call.id, on: today, reference: "FED 3", by: "x" });
    expect(alertsFor(after, sent.after, sent.action)).toMatchObject([{ to: "team", event: "investor.draw_call_sent" }]);
    const queue = workQueue(sent.after, { id: "" }, new Date(`${today}T16:00:00Z`));
    expect([...queue.mine, ...queue.team].find((entry) => entry.key === `drawcall:${call.id}`)?.label).toMatch(/Confirm .* draw share arrived/);
    const received = run(sent.after, owner, { t: "drawCallReceived", dealId: "d2", callId: call.id, on: today, by: "x" }).after;
    expect(deal(received, "d2").drawCalls![0].received).toMatchObject({ on: today });
    // A partner that paid its whole share at closing isn't asked.
    const prepaid: Book = { ...b, deals: b.deals.map((d) => (d.id === "d2" ? { ...d, partnerFunding: { ...d.partnerFunding!, drawsAsReleased: undefined } } : d)) };
    expect(deal(reducer(prepaid, { t: "releaseDraw", drawId: "draw-1" }), "d2").drawCalls).toBeUndefined();
  });
  it("count business days past weekends and Florida holidays", () => {
    // Friday Nov 6 2026: Monday, Tuesday, then Thursday (Veterans Day is Wednesday Nov 11).
    expect(addBusinessDays("2026-11-06", 3)).toBe("2026-11-12");
    expect(addBusinessDays("2026-10-31", 3)).toBe("2026-11-04");
  });
});

describe("payoff proceeds", () => {
  it("only go to partners still holding a share", () => {
    const b = demoBook();
    const paid = { ...deal(b, "d11"), paidOff: { amount: 1, receivedOn: "2026-10-30", method: "wire" as const, reference: "", by: "x", at: "x", owed: 1 } };
    expect(payoffProceeds(b, paid, (n) => `x${n}`)).toHaveLength(1);
    const gone = { ...b, bids: b.bids.map((bid) => (bid.dealId === "d11" ? { ...bid, until: "2026-10-01" } : bid)) };
    expect(payoffProceeds(gone, paid, (n) => `x${n}`)).toEqual([]);
  });
});
