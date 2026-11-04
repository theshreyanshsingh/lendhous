import { describe, expect, it } from "vitest";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { blankGuarantor, draftForAccount, draftFromLoan, repeatDraft } from "@/lib/borrower-application";
import { evaluate, repeatTierOf } from "@/lib/engine";
import type { Deal, Sponsor } from "@/lib/mockData";
import { pricingConfig } from "@/lib/pricing-config";
import { applyDraft, draftChanges, draftOf, draftProblems } from "@/lib/pricing-draft";
import { carryOverDocs, repeatHistory } from "@/lib/repeat-borrower";

const TODAY = "2026-10-31";
const ALEX = "b-alex";
const withDeal = (book: Book, id: string, change: Partial<Deal>): Book => ({ ...book, deals: book.deals.map((deal) => (deal.id === id ? { ...deal, ...change } : deal)) });
const sponsor = (changes: Partial<Sponsor> = {}): Sponsor => ({ entityState: "FL", guarantors: [{ name: "Alex Sample (FAKE)", ownershipPct: 100, fico: 740, citizenship: "us" }], trackRecord: [], declarations: { bankruptcy: false, foreclosure: false, delinquent: false, judgments: false, lawsuit: false, felony: false, borrowedDownPayment: false, explanation: "" }, ...changes });
const submit = (book: Book, entityName = "Sample Flips LLC (FAKE)", profile = sponsor()): Deal => {
  const app = { ...book.deals.find((deal) => deal.id === "d1")!.app, pricingVersion: undefined };
  const action: BookAction = { t: "submitApp", app, address: "9 Next St", city: "Hollywood", zip: "33020", entityName, exitStrategy: "Sell", sponsor: profile };
  const after = reducer(book, action);
  return after.deals.find((deal) => !book.deals.some((old) => old.id === deal.id))!;
};
// d2 is the demo borrower's funded loan: closed Sep 4, 2026, its first payment due Oct 1. Unpaid, it's late by Oct 31.
const lateOnOctober = (book: Book) => withDeal(book, "d2", { nextPaymentDue: "2026-10-01", paymentsLate: 1, payments: [], servicedThrough: TODAY });

describe("repeat borrowers: loans paid as agreed count", () => {
  it("counts funded loans paid as agreed in the last 24 months", () => {
    const book = demoBook();
    expect(repeatHistory(book.deals, ALEX, TODAY)).toEqual({ loans: 1, counted: ["LH-DEMO-1002"], asOf: TODAY });
    const d2 = book.deals.find((deal) => deal.id === "d2")!;
    const paidOff = { ...d2, id: "old-1", loanNumber: "LH-OLD-1", status: "paid_off" as const, closingDate: "2025-02-10" };
    const tooOld = { ...d2, id: "old-2", loanNumber: "LH-OLD-2", status: "paid_off" as const, closingDate: "2024-06-15" };
    expect(repeatHistory([...book.deals, paidOff, tooOld], ALEX, TODAY)).toMatchObject({ loans: 2, counted: ["LH-DEMO-1002", "LH-OLD-1"] });
    // Applications that never funded don't count.
    expect(repeatHistory(book.deals, ALEX, TODAY).counted).not.toContain("LH-DEMO-1001");
  });
  it("a late payment in the window pauses it; a waived late fee doesn't", () => {
    const late = lateOnOctober(demoBook());
    expect(repeatHistory(late.deals, ALEX, TODAY)).toMatchObject({ loans: 0, pausedBy: "LH-DEMO-1002" });
    const waived = withDeal(late, "d2", { waivedFees: [{ due: "2026-10-01", by: "Uma", at: "2026-10-20T00:00:00Z", reason: "Bank error" }] });
    expect(repeatHistory(waived.deals, ALEX, TODAY)).toMatchObject({ loans: 1 });
    expect(repeatHistory(withDeal(demoBook(), "d2", { status: "default" }).deals, ALEX, TODAY).pausedBy).toBe("LH-DEMO-1002");
  });
  it("prices on the tier reached: rate and points off, nothing while paused", () => {
    const app = { ...demoBook().deals[0].app, pricingVersion: undefined, termRate: undefined, termPoints: undefined };
    const plain = evaluate(app);
    const three = evaluate({ ...app, repeat: { loans: 3, counted: ["a", "b", "c"], asOf: TODAY } });
    expect(three.rate).toBeCloseTo(plain.rate - 0.5, 6);
    expect(three.pointsPct).toBeCloseTo(plain.pointsPct - 0.25, 6);
    expect(three.pointsRange[0]).toBeCloseTo(Math.max(0, plain.pointsRange[0] - 0.25), 6);
    expect(three.flags).toContain("Repeat borrower, 3 loans paid as agreed: −0.5%, −0.25 points");
    expect(evaluate({ ...app, repeat: { loans: 12, counted: [], asOf: TODAY } }).rate).toBeCloseTo(plain.rate - 1, 6);
    const paused = evaluate({ ...app, repeat: { loans: 3, counted: [], pausedBy: "LH-DEMO-1002", asOf: TODAY } });
    expect(paused.rate).toBe(plain.rate);
    expect(paused.flags.some((flag) => flag.startsWith("Repeat pricing paused"))).toBe(true);
    // Staff's mark for loans from before the system counts as one; pricing published before the tiers had a flat cut.
    expect(repeatTierOf({ repeatBorrower: true })).toMatchObject({ loans: 1, rateCut: 0.25 });
    const older = { ...pricingConfig, adjusters: { ...pricingConfig.adjusters, repeatTiers: undefined, repeatBorrowerRateCut: 0.375 } };
    expect(evaluate({ ...app, repeatBorrower: true }, older).rate).toBeCloseTo(evaluate(app, older).rate - 0.375, 6);
  });
  it("counts at submission and keeps the count with the application", () => {
    const deal = submit(demoBook());
    expect(deal.app.repeat).toEqual({ loans: 1, counted: ["LH-DEMO-1002"], asOf: TODAY });
    expect(evaluate(deal.app).rate).toBeCloseTo(evaluate({ ...deal.app, repeat: undefined }).rate - 0.25, 6);
    expect(submit(lateOnOctober(demoBook())).app.repeat).toMatchObject({ pausedBy: "LH-DEMO-1002" });
    // A first-time borrower has nothing to count.
    const stranger = reducer(demoBook(), { t: "submitApp", app: demoBook().deals[0].app, address: "1 St", city: "Miami", zip: "33101", entityName: "New LLC", exitStrategy: "Sell", client: { name: "New Person" } });
    expect(stranger.deals[0].app.repeat).toBeUndefined();
  });
});

describe("repeat borrowers: what carries over", () => {
  it("the same entity's papers carry over; stale good standing and another entity's don't", () => {
    const fresh = withDeal(demoBook(), "d2", { docs: [...demoBook().deals.find((deal) => deal.id === "d2")!.docs, { id: "good-standing", name: "Good standing", category: "Entity", status: "accepted", acceptedOn: "2026-09-01", documentId: "doc-gs", fileName: "gs.pdf" }] });
    const docs = submit(fresh).docs;
    const byId = (id: string) => docs.find((item) => item.id === id)!;
    expect(byId("entity")).toMatchObject({ status: "accepted", carriedFrom: "LH-DEMO-1002" });
    expect(byId("ein")).toMatchObject({ status: "accepted", carriedFrom: "LH-DEMO-1002" });
    expect(byId("good-standing")).toMatchObject({ status: "accepted", documentId: "doc-gs", fileName: "gs.pdf", carriedFrom: "LH-DEMO-1002" });
    expect(byId("bank").status).toBe("requested");
    // The ID's acceptance date isn't known, so it's asked for again.
    expect(byId("id").status).toBe("requested");
    expect(submit(fresh, "Another Entity LLC").docs.filter((item) => item.carriedFrom)).toEqual([]);
    const stale = carryOverDocs([{ id: "good-standing", name: "", category: "Entity", status: "requested" }], fresh.deals.filter((deal) => deal.id === "d2"), { entityName: "Sample Flips LLC (FAKE)" }, "2026-12-15");
    expect(stale[0].status).toBe("requested");
  });
  it("an ID carries over only when every guarantor was on the earlier loan", () => {
    const d2 = { ...demoBook().deals.find((deal) => deal.id === "d2")!, sponsor: sponsor(), docs: [{ id: "id", name: "ID", category: "Identity", status: "accepted" as const, acceptedOn: "2026-08-20" }] };
    const wanted = [{ id: "id", name: "ID", category: "Identity", status: "requested" as const }];
    expect(carryOverDocs(wanted, [d2], { entityName: "Anything LLC", sponsor: sponsor() }, TODAY)[0].status).toBe("accepted");
    const more = sponsor({ guarantors: [...sponsor().guarantors, { name: "New Partner", ownershipPct: 50, fico: 720, citizenship: "us" }] });
    expect(carryOverDocs(wanted, [d2], { entityName: "Anything LLC", sponsor: more }, TODAY)[0].status).toBe("requested");
  });
  it("past deals confirmed on an earlier loan stay confirmed, and their statements aren't asked for again", () => {
    const flip = { id: "t1", address: "1 Old St", kind: "flip" as const, completed: "2025-05", purchasePrice: 200_000, salePrice: 300_000 };
    const book = withDeal(demoBook(), "d2", { sponsor: sponsor({ trackRecord: [{ ...flip, verified: true }] }) });
    const deal = submit(book, "Sample Flips LLC (FAKE)", sponsor({ trackRecord: [{ ...flip, id: "new-1", address: " 1 old st " }] }));
    expect(deal.sponsor?.trackRecord[0].verified).toBe(true);
    expect(deal.docs.find((item) => item.id === "track")?.status).toBe("accepted");
    const another = submit(book, "Sample Flips LLC (FAKE)", sponsor({ trackRecord: [flip, { ...flip, id: "t2", address: "2 New St" }] }));
    expect(another.sponsor?.trackRecord.map((item) => Boolean(item.verified))).toEqual([true, false]);
    expect(another.docs.find((item) => item.id === "track")?.status).toBe("requested");
  });
  it("accepting a document dates it; asking again for a carried one clears the old file", () => {
    let book = demoBook();
    const deal = submit(book);
    book = { ...book, deals: [deal, ...book.deals] };
    const accepted = reducer(book, { t: "docStatus", dealId: deal.id, docId: "bank", status: "accepted" });
    expect(accepted.deals[0].docs.find((item) => item.id === "bank")?.acceptedOn).toBe(TODAY);
    const asked = reducer(book, { t: "docStatus", dealId: deal.id, docId: "entity", status: "requested" }).deals[0].docs.find((item) => item.id === "entity")!;
    expect(asked).toMatchObject({ status: "requested" });
    expect(asked.carriedFrom).toBeUndefined();
    expect(asked.documentId).toBeUndefined();
  });
});

describe("repeat borrowers: the next application", () => {
  it("starts from the last signed one, with private details and the declarations asked again", () => {
    const signed = draftForAccount({ name: "Alex Sample", email: "alex@example.com" });
    signed.vesting = { ...signed.vesting, hasLlc: true, entityName: "Sample Flips LLC", ein: "12-3456789" };
    signed.guarantors = [{ ...blankGuarantor(), firstName: "Alex", lastName: "Sample", ssn: "123-45-6789", dob: "1980-01-01", fico: "740", ownershipPct: "100", citizenship: "us", answers: { bankruptcy: false }, occupy: false }];
    signed.property.address.street = "1 Old St";
    signed.loan.purchasePrice = "300000";
    signed.trackRecord = [{ id: "t1", address: "1 Old St", kind: "flip", completed: "2025-05", purchasePrice: 200_000, verified: true }];
    const next = repeatDraft(signed);
    expect(next.vesting.entityName).toBe("Sample Flips LLC");
    expect(next.guarantors[0]).toMatchObject({ firstName: "Alex", ownershipPct: "100", citizenship: "us", ssn: "", dob: "", fico: "", answers: {}, occupy: null });
    expect(next.property.address.street).toBe("");
    expect(next.loan.purchasePrice).toBe("");
    expect(next.trackRecord).toEqual([{ id: "t1", address: "1 Old St", kind: "flip", completed: "2025-05", purchasePrice: 200_000 }]);
  });
  it("or from a loan the team entered", () => {
    const d5 = demoBook().deals.find((deal) => deal.id === "d5")!;
    const draft = draftFromLoan(d5, { name: "Riley Placeholder", email: "riley@example.com", phone: "305-555-0100" });
    expect(draft.contact).toMatchObject({ firstName: "Riley", email: "riley@example.com" });
    expect(draft.vesting).toMatchObject({ hasLlc: true, entityName: d5.entityName });
    expect(draft.guarantors.map((g) => g.fico)).toEqual(["", ""]);
    expect(draft.guarantors[0].phone).toBe("305-555-0100");
    expect(draft.property.address.street).toBe("");
    expect(draftFromLoan({ ...d5, entityName: "Riley Placeholder (LLC to be formed)" }, { name: "Riley", email: "r@example.com" }).vesting).toMatchObject({ hasLlc: false, entityName: "" });
  });
});

describe("repeat tiers in the pricing editor", () => {
  it("are edited, checked and published like the other numbers", () => {
    const draft = draftOf(pricingConfig);
    expect(draft.repeatTiers).toHaveLength(4);
    const changed = { ...draft, repeatTiers: draft.repeatTiers.map((tier, at) => (at === 1 ? { ...tier, rateCut: 0.625 } : tier)) };
    expect(draftChanges(draft, changed)).toEqual(["repeatTiers.1.rateCut: 0.5 → 0.625"]);
    expect(draftChanges(draft, { ...draft, repeatTiers: [...draft.repeatTiers, { loans: 15, rateCut: 1.25, pointsCut: 1 }] })).toEqual(["repeatTiers: 4 → 5 tiers"]);
    expect(applyDraft(pricingConfig, changed, "v-next").adjusters.repeatTiers?.[1].rateCut).toBe(0.625);
    expect(draftProblems({ ...draft, repeatTiers: [{ loans: 3, rateCut: 0.5, pointsCut: 0 }, { loans: 3, rateCut: 1, pointsCut: 0 }] })).toContain("Each repeat-borrower tier needs more loans than the one before it.");
    const older = { ...pricingConfig, adjusters: { ...pricingConfig.adjusters, repeatTiers: undefined } };
    expect(draftOf(older).repeatTiers).toEqual([{ loans: 1, rateCut: 0.25, pointsCut: 0 }]);
  });
});
