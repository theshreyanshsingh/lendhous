import { afterEach, describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { extensionFee } from "@/lib/loan-exits";
import { seedDeals, type Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { pricingConfig } from "@/lib/pricing-config";
import { applyDraft, draftChanges, draftOf, draftProblems, draftSchema, draftWarnings } from "@/lib/pricing-draft";
import { adoptPricing, BASE_VERSION, currentPricing, pricingFor, pricingPayload } from "@/lib/pricing-versions";
import { ledgerOf, servicingTermsOf } from "@/lib/servicing";

// A second version: every fix & flip rate half a point higher, a 6% late fee and a bigger extension fee.
const raised = () => {
  const draft = draftOf(pricingConfig);
  for (const tier of [1, 2, 3, 4] as const) draft.fixFlip.tiers[tier].rate = [draft.fixFlip.tiers[tier].rate[0] + 0.5, draft.fixFlip.tiers[tier].rate[1] + 0.5];
  draft.servicing.lateFeePct = 0.06;
  draft.extensions.feePoints = 2;
  return applyDraft(pricingConfig, draft, "2026-11-03-v1");
};
const publish = (config = raised()) => adoptPricing({ current: config.version, versions: [config] });
afterEach(() => adoptPricing({ current: BASE_VERSION, versions: [] }));

const flip = (changes: Partial<Deal> = {}): Deal => {
  const base = seedDeals.find((item) => item.id === "d9")!;
  return { ...base, id: "L1", borrowerId: "borrower-1", app: { ...base.app, pricingVersion: BASE_VERSION }, closingDate: "2026-06-10", boardedThrough: "2026-07-01", nextPaymentDue: "2026-07-01", paymentsLate: 0, status: "servicing_current", ...changes };
};
const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (book: Book, viewer: Viewer, action: BookAction) => authorize(book, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }));

describe("a loan keeps the pricing it was quoted on", () => {
  it("prices a saved loan on its own version, and a new quote on the current one", () => {
    const before = evaluate(flip().app);
    publish();
    expect(evaluate(flip().app).rate).toBe(before.rate);
    const { pricingVersion: _version, ...quote } = flip().app;
    expect(evaluate(quote).rate).toBe(before.rate + 0.5);
  });
  it("keeps the late fee and extension terms in each loan's note", () => {
    const late = (deal: Deal) => ledgerOf(deal, "2026-07-12").rows[0].fee;
    const onBase = late(flip());
    publish();
    expect(late(flip())).toBe(onBase);
    expect(servicingTermsOf(flip()).lateFeePct).toBe(0.05);
    const onNew = flip({ app: { ...flip().app, pricingVersion: "2026-11-03-v1" } });
    // The new version's rate is higher too, so its payment is bigger, and 6% of that.
    const payment = ledgerOf(onNew, "2026-07-12").rows[0].amount;
    expect(payment).toBeGreaterThan(ledgerOf(flip(), "2026-07-12").rows[0].amount);
    expect(late(onNew)).toBeCloseTo(payment * 0.06, 2);
    expect(extensionFee(onNew, 3)).toBeCloseTo(extensionFee(flip(), 3) * 2, 2);
  });
  it("refuses to price a loan on a version it hasn't been sent, rather than guess", () => {
    expect(() => pricingFor("never-published")).toThrow(/isn't loaded/);
    expect(pricingFor(undefined).version).toBe(BASE_VERSION);
  });
});

describe("new applications and repricing", () => {
  const submit: BookAction = { t: "submitApp", app: flip().app, address: "1 New St", city: "Hollywood", zip: "33020", entityName: "New LLC", exitStrategy: "Sell", client: { name: "Nina New" } };
  it("stamps a new application with the pricing current when it was submitted", () => {
    publish();
    const after = reducer(emptyBook(), submit);
    expect(after.deals[0].app.pricingVersion).toBe("2026-11-03-v1");
    // A browser can't choose its own pricing: the field isn't accepted.
    expect((parseAction({ ...submit, app: { ...flip().app, pricingVersion: "cheap" } }) as Extract<BookAction, { t: "submitApp" }>).app.pricingVersion).toBeUndefined();
  });
  it("lets term sheet authority move an application in review onto the current pricing, and nothing later", () => {
    const owner = person("owner", ["ADMIN_OWNER"]);
    const review = { ...emptyBook(), deals: [flip({ status: "underwriting", boardedThrough: undefined, nextPaymentDue: undefined })] };
    expect(check(review, owner, { t: "repriceLoan", dealId: "L1", by: "x" })).toMatchObject({ error: expect.stringMatching(/already on the current/) });
    publish();
    expect(check(review, person("proc", ["PROCESSOR"]), { t: "repriceLoan", dealId: "L1", by: "x" })).toHaveProperty("error");
    const ok = check(review, owner, { t: "repriceLoan", dealId: "L1", by: "x" });
    expect(ok).toMatchObject({ action: { by: "owner name" } });
    const after = reducer(review, (ok as { action: BookAction }).action);
    expect(after.deals[0].app.pricingVersion).toBe("2026-11-03-v1");
    expect(evaluate(after.deals[0].app).rate).toBe(evaluate(flip().app).rate + 0.5);
    const funded = { ...emptyBook(), deals: [flip()] };
    expect(check(funded, owner, { t: "repriceLoan", dealId: "L1", by: "x" })).toMatchObject({ error: expect.stringMatching(/term sheet/) });
  });
  it("keeps the demo book on the original numbers", () => {
    publish();
    expect(demoBook().deals.every((deal) => deal.app.pricingVersion === BASE_VERSION)).toBe(true);
  });
  it("sends a browser the current pricing and each of its loans' versions", () => {
    publish();
    const book = { ...emptyBook(), deals: [flip({ borrowerId: "borrower-1" })] };
    const seen = scopeBook(book, person("borrower-1", ["BORROWER"]));
    expect(seen.pricing?.current).toBe("2026-11-03-v1");
    expect(seen.pricing?.versions.map((item) => item.version).sort()).toEqual(["2026-11-03-v1", BASE_VERSION].sort());
    expect(pricingPayload([]).versions.map((item) => item.version)).toEqual(["2026-11-03-v1"]);
  });
});

describe("the pricing editor's draft", () => {
  it("round-trips the config and lists what changed", () => {
    const draft = draftOf(pricingConfig);
    expect(draftSchema.safeParse(draft).success).toBe(true);
    expect(applyDraft(pricingConfig, draft, pricingConfig.version)).toEqual(pricingConfig);
    expect(draftChanges(draft, draftOf(raised()))).toContain("fixFlip.tiers.2.rate: 11–12 → 11.5–12.5");
  });
  it("stops a backwards range or loan size, and flags a rate over Florida's cap", () => {
    const draft = draftOf(pricingConfig);
    draft.bridge.tiers[1].rate = [13, 12];
    draft.loanSize.min = 5_000_000;
    expect(draftProblems(draft)).toEqual(expect.arrayContaining([expect.stringMatching(/Bridge tier 1 rate/), expect.stringMatching(/Loan sizes/)]));
    const high = draftOf(pricingConfig);
    high.fixFlip.tiers[1].rate = [12, 19];
    expect(draftProblems(high)).toEqual([]);
    expect(draftWarnings(high)[0]).toMatch(/18%/);
    expect(draftSchema.safeParse({ ...high, servicing: { ...high.servicing, lateFeePct: 5 } }).success).toBe(false);
    high.bridge.tiers[4].rate = [20, 26];
    expect(draftProblems(high)[0]).toMatch(/criminal usury/);
  });
  it("carries over everything the editor doesn't show", () => {
    const next = raised();
    expect(next.dscr.grid).toEqual(pricingConfig.dscr.grid);
    expect(next.score).toEqual(pricingConfig.score);
    expect(currentPricing().version).toBe(BASE_VERSION);
  });
});
