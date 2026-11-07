import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { DEMO_BROKER_ID, DEMO_BUYER_ID, DEMO_PARTNER_ID, DEMO_SPONSORS, type Screening } from "@/lib/mockData";
import { firmHeld, firmOfacBlocker, firmSubjects } from "@/lib/ofac";
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
const capital = person("cam", ["CAPITAL_MANAGER"]);
const partner = person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID);
const buyer = person("bella", ["LOAN_BUYER"], DEMO_BUYER_ID);
const broker = person("bea", ["BROKER"], DEMO_BROKER_ID);
const system = person("system", []);

const screening = (status: Screening["status"], names: string[], at = "2026-10-30T12:00:00Z", hitOn?: string): Screening => ({ id: `scr-${status}-${at}`, at, by: "Nightly sanctions check", checkedAt: at, list: { fetchedAt: at, names: 18_000 }, status, subjects: names.map((name, index) => ({ name, role: index ? "principal" : "entity", hits: name === hitOn ? [{ uid: 7, name: "LISTED HOLDINGS", type: "entity", program: "SDGT", score: 0.94 }] : [] })) });
const withPartner = (b: Book, id: string, changes: Partial<Book["partners"][number]>): Book => ({ ...b, partners: b.partners.map((firm) => (firm.id === id ? { ...firm, ...changes } : firm)) });
const withBuyer = (b: Book, id: string, changes: Partial<Book["buyers"][number]>): Book => ({ ...b, buyers: b.buyers.map((firm) => (firm.id === id ? { ...firm, ...changes } : firm)) });

describe("who at a firm is screened", () => {
  it("is the firm, its owners and officers, and the people who sign in for it, once each", () => {
    expect(firmSubjects({ name: "Harbor Note Fund LLC", principals: ["Ana Peña", " ", "ana pena"] }, ["Bella Buyer", "Ana Peña"])).toEqual([{ name: "Harbor Note Fund LLC", role: "entity" }, { name: "Ana Peña", role: "principal" }, { name: "Bella Buyer", role: "principal" }]);
  });

  it("holds a firm that was never screened, has a match open or confirmed, or added an owner since, and money on a stale check", () => {
    const firm = { name: "Gulf Capital LLC", principals: ["Rita Owner"] };
    expect(firmOfacBlocker({ ...firm })).toMatch(/hasn't been screened/);
    expect(firmOfacBlocker({ ...firm, screening: screening("review", ["Gulf Capital LLC", "Rita Owner"], undefined, "Gulf Capital LLC") })).toMatch(/possible OFAC sanctions match on Gulf Capital LLC/);
    expect(firmOfacBlocker({ ...firm, screening: screening("match", ["Gulf Capital LLC", "Rita Owner"]) })).toMatch(/confirmed OFAC sanctions match/);
    expect(firmOfacBlocker({ ...firm, screening: screening("clear", ["Gulf Capital LLC"]) })).toBe("Rita Owner not screened against the OFAC list yet");
    const clean = { ...firm, screening: screening("clear", ["Gulf Capital LLC", "Rita Owner"]) };
    expect(firmOfacBlocker(clean)).toBeNull();
    expect(firmOfacBlocker(clean, "2026-11-01")).toBeNull();
    expect(firmOfacBlocker(clean, "2026-11-04")).toMatch(/more than 3 days old/);
    expect(firmHeld(clean)).toBe(false);
    expect(firmHeld({ screening: { ...clean.screening, status: "cleared" } })).toBe(false);
  });
});

describe("partner lenders", () => {
  it("can't have a bid accepted, or get a teaser, until they're screened and clear", () => {
    const b = demoBook();
    expect(check(b, owner, { t: "acceptBid", bidId: "bid1" })).not.toHaveProperty("error");
    const unscreened = withPartner(b, DEMO_PARTNER_ID, { screening: undefined });
    expect(check(unscreened, owner, { t: "acceptBid", bidId: "bid1" })).toMatchObject({ error: "Demo Partner Capital A (FAKE) hasn't been screened against the OFAC sanctions list yet." });
    // The unsigned prospect has a possible match in the demo.
    expect(check(b, owner, { t: "sendTeaser", dealId: "d1", partnerIds: ["p-b", "p-d"] })).toMatchObject({ error: expect.stringMatching(/Unsigned Prospect D \(FAKE\) has a possible or confirmed OFAC match/) });
    expect(check(b, owner, { t: "sendTeaser", dealId: "d1", partnerIds: ["p-b"] })).not.toHaveProperty("error");
  });

  it("on hold can't bid, and aren't told why", () => {
    const b = withPartner(demoBook(), DEMO_PARTNER_ID, { screening: screening("review", ["Demo Partner Capital A (FAKE)"], undefined, "Demo Partner Capital A (FAKE)") });
    const bid: BookAction = { t: "bid", bid: { dealId: "d3", partnerId: "", pct: 50, lenderRate: 10, lenderPoints: 0.5, conditions: "", type: "bid" } };
    const fresh = { ...b, bids: b.bids.filter((item) => item.partnerId !== DEMO_PARTNER_ID) };
    const refused = check(fresh, partner, bid);
    expect(refused).toMatchObject({ error: expect.stringMatching(/finish a check on your firm/) });
    expect(JSON.stringify(refused)).not.toMatch(/OFAC|sanction/i);
  });

  it("take money in only on a screening from the last few days", () => {
    const accepted = run(demoBook(), owner, { t: "acceptBid", bidId: "bid1" }).after;
    const received: BookAction = { t: "partnerFundsReceived", dealId: "d3", on: "2026-10-31", by: "x" };
    expect(check(accepted, capital, received)).not.toHaveProperty("error");
    const stale = withPartner(accepted, DEMO_PARTNER_ID, { screening: screening("clear", ["Demo Partner Capital A (FAKE)"], "2026-10-20T12:00:00Z") });
    expect(check(stale, capital, received)).toMatchObject({ error: expect.stringMatching(/more than 3 days old: screen again before money moves/) });
  });

  it("never see their own screening or the owners the team entered", () => {
    const b = withPartner(demoBook(), DEMO_PARTNER_ID, { principals: ["Pia Partner"] });
    expect(scopeBook(b, partner).partners).toEqual([expect.not.objectContaining({ screening: expect.anything() })]);
    expect(scopeBook(b, partner).partners[0]).not.toHaveProperty("principals");
    expect(scopeBook(b, buyer).buyers[0]).not.toHaveProperty("screening");
  });
});

describe("loan buyers", () => {
  it("on hold can't offer, and a sale to one waits for a fresh, clear screening", () => {
    const held = withBuyer(demoBook(), DEMO_BUYER_ID, { screening: screening("review", ["Harbor Note Fund (FAKE)"], undefined, "Harbor Note Fund (FAKE)") });
    expect(check(held, buyer, { t: "offerLoan", saleId: "s-d9", pricePct: 99, note: "", atAsk: false, buyerId: "" } as BookAction)).toMatchObject({ error: expect.stringMatching(/finish a check on your firm/) });
    expect(check(held, owner, { t: "decideOffer", offerId: "offer-1", accept: true })).toMatchObject({ error: expect.stringMatching(/possible OFAC sanctions match on Harbor Note Fund/) });
    // Declining an offer moves no money, so it doesn't wait.
    expect(check(held, owner, { t: "decideOffer", offerId: "offer-1", accept: false })).not.toHaveProperty("error");
    expect(check(demoBook(), owner, { t: "decideOffer", offerId: "offer-1", accept: true })).not.toHaveProperty("error");
  });
});

describe("reviewing a firm's possible match", () => {
  it("takes clear_ofac and a reason, unblocks the firm when cleared, and tells the team to report a confirmed one", () => {
    const b = demoBook();
    const review = b.partners.find((firm) => firm.id === "p-d")!.screening!;
    const decide = (decision: "cleared" | "match", reason = "Listed company registered in Panama; ours is a Florida LLC formed 2012"): BookAction => ({ t: "decideFirmScreening", kind: "partner", firmId: "p-d", screeningId: review.id, decision, reason, by: "x" });
    expect(parseAction(decide("cleared"))).not.toBeNull();
    expect(check(b, capital, decide("cleared"))).toHaveProperty("error");
    expect(check(b, owner, decide("cleared", " "))).toMatchObject({ error: expect.stringMatching(/what you compared/) });
    const cleared = run(b, owner, decide("cleared")).after;
    expect(cleared.partners.find((firm) => firm.id === "p-d")!.screening).toMatchObject({ status: "cleared", decided: { by: "owner name" } });
    expect(check(cleared, owner, { t: "sendTeaser", dealId: "d1", partnerIds: ["p-d"] })).not.toHaveProperty("error");
    expect(check(cleared, owner, decide("match"))).toMatchObject({ error: expect.stringMatching(/no open match/) });
    const matched = run(b, owner, decide("match"));
    expect(alertsFor(b, matched.after, matched.action)).toMatchObject([{ to: "team", event: "ofac.match", body: expect.stringMatching(/within 10 business days \(31 CFR 501\.603, 501\.604\)/) }]);
  });

  it("lists firms on hold in the queue and in Needs attention", () => {
    const b = demoBook();
    expect(workQueue(b, { id: "" }, new Date("2026-10-31T16:00:00Z")).team.find((item) => item.key === "ofac-partner:p-d")).toMatchObject({ label: "Review a possible sanctions match: Unsigned Prospect D (FAKE)", href: "/admin/partners" });
    const loans = b.deals.filter((deal) => deal.screenings?.at(-1)?.status === "review").length;
    expect(attentionItems(b, 0).find((item) => item.key === "sanctions")).toMatchObject({ count: loans + 1 });
  });
});

describe("screenings recorded by the server", () => {
  it("only come from the server, and the same result again keeps a cleared decision", () => {
    const b = demoBook();
    const firm = b.partners.find((item) => item.id === "p-d")!;
    const again: BookAction = { t: "firmScreened", kind: "partner", firmId: "p-d", screening: { ...firm.screening!, id: "scr-next", at: "2026-11-01T12:00:00Z", checkedAt: "2026-11-01T12:00:00Z" } };
    expect(check(b, owner, again)).toHaveProperty("error");
    expect(parseAction(again)).toBeNull();
    const cleared = run(b, owner, { t: "decideFirmScreening", kind: "partner", firmId: "p-d", screeningId: firm.screening!.id, decision: "cleared", reason: "Different country and owners, checked", by: "x" }).after;
    const next = run(cleared, system, again, true);
    expect(next.after.partners.find((item) => item.id === "p-d")!.screening).toMatchObject({ status: "cleared", checkedAt: "2026-11-01T12:00:00Z" });
    expect(alertsFor(cleared, next.after, next.action)).toEqual([]);
    // A new hit is a new review, and the team hears about it.
    const fresh: BookAction = { t: "firmScreened", kind: "buyer", firmId: DEMO_BUYER_ID, screening: screening("review", ["Harbor Note Fund (FAKE)"], "2026-11-01T12:00:00Z", "Harbor Note Fund (FAKE)") };
    const flagged = run(b, system, fresh, true);
    expect(flagged.after.buyers.find((item) => item.id === DEMO_BUYER_ID)!.screening!.status).toBe("review");
    expect(alertsFor(b, flagged.after, flagged.action)).toMatchObject([{ to: "team", event: "ofac.review", subject: "Possible OFAC match: Harbor Note Fund (FAKE)" }]);
  });

  it("saving a firm keeps its screening and the owners entered", () => {
    const b = demoBook();
    const firm = b.partners.find((item) => item.id === DEMO_PARTNER_ID)!;
    const { after } = run(b, capital, { t: "saveFirm", kind: "partner", id: DEMO_PARTNER_ID, name: firm.name, buyBox: firm.buyBox, principals: [" Pia Partner ", ""] });
    const saved = after.partners.find((item) => item.id === DEMO_PARTNER_ID)!;
    expect(saved).toMatchObject({ principals: ["Pia Partner"], screening: firm.screening });
    // Pia hasn't been screened yet, so a bid can't be accepted until the screening the save starts comes back.
    expect(check(after, owner, { t: "acceptBid", bidId: "bid1" })).toMatchObject({ error: "Pia Partner not screened against the OFAC list yet." });
  });
});

describe("brokerages", () => {
  it("found on the list after approval can't send deals until it's reviewed, and a repeat of a cleared result stays cleared", () => {
    const b = demoBook();
    const demo = b.brokers.find((item) => item.id === DEMO_BROKER_ID)!;
    const hit = { ...demo.screening!, id: "scr-broker-hit", at: "2026-11-01T12:00:00Z", checkedAt: "2026-11-01T12:00:00Z", status: "review" as const, subjects: demo.screening!.subjects.map((subject, index) => (index ? subject : { ...subject, hits: [{ uid: 9, name: "DEMO BROKERAGE SA", type: "entity", program: "SDGT", score: 0.92 }] })) };
    const flagged = run(b, system, { t: "brokerScreened", brokerId: DEMO_BROKER_ID, screening: hit }, true);
    expect(alertsFor(b, flagged.after, flagged.action)).toMatchObject([{ to: "team", event: "ofac.review", subject: "Possible OFAC match: Demo Brokerage (FAKE)" }]);
    const app = b.deals.find((deal) => deal.id === "d5")!.app;
    const submit: BookAction = { t: "submitApp", app, address: "9 Test St", city: "Hollywood", zip: "33020", entityName: "Client Flips LLC", exitStrategy: "Sell", sponsor: DEMO_SPONSORS.d5, client: { name: "Client Person" } };
    expect(check(flagged.after, broker, submit)).toMatchObject({ error: expect.stringMatching(/finish a check on your firm/) });
    const cleared = run(flagged.after, owner, { t: "decideFirmScreening", kind: "broker", firmId: DEMO_BROKER_ID, screeningId: "scr-broker-hit", decision: "cleared", reason: "A Panamanian company; ours is the Florida LLC on Sunbiz", by: "x" }).after;
    expect(check(cleared, broker, submit)).not.toHaveProperty("error");
    const nightly = run(cleared, system, { t: "brokerScreened", brokerId: DEMO_BROKER_ID, screening: { ...hit, id: "scr-broker-next", at: "2026-11-02T12:00:00Z", checkedAt: "2026-11-02T12:00:00Z" } }, true).after;
    expect(nightly.brokers.find((item) => item.id === DEMO_BROKER_ID)!.screening).toMatchObject({ id: "scr-broker-hit", status: "cleared", checkedAt: "2026-11-02T12:00:00Z" });
    expect(workQueue(flagged.after, { id: "" }, new Date("2026-10-31T16:00:00Z")).team.find((item) => item.key === `ofac-broker:${DEMO_BROKER_ID}`)).toMatchObject({ href: "/admin/brokers" });
  });
});
