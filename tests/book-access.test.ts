import { describe, expect, it } from "vitest";
import { authorize, canOpenFile, canUploadFile, firmOf, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { attentionItems } from "@/lib/attention";
import { toCsv } from "@/lib/csv";
import { can, type Permission } from "@/lib/permissions";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const allowedFor = (viewer: Viewer) => (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer });
const check = (book: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(book, viewer, action, allowedFor(viewer), trusted);

// The demo book with its people replaced by real ids, the way a live book looks.
const book = (): Book => {
  const base = demoBook();
  return {
    ...base,
    deals: base.deals.map((deal) => ({ ...deal, borrowerId: deal.borrowerId === "b-alex" ? "borrower-1" : deal.borrowerId, brokerId: deal.brokerId ? "broker-firm" : undefined })),
    partners: base.partners.map((partner) => (partner.id === "p-a" ? { ...partner, id: "partner-firm" } : partner)),
    bids: base.bids.map((bid) => (bid.partnerId === "p-a" ? { ...bid, partnerId: "partner-firm" } : bid)),
    messages: [...base.messages, { id: "note-1", dealId: "d1", from: "Uma", side: "internal", text: "Borrower is slow to respond", at: "2026-10-20T00:00:00Z" }, { id: "note-2", dealId: "d3", from: "Uma", side: "internal", text: "Partner is pushy", at: "2026-10-20T00:00:00Z" }],
  };
};
const live = () => {
  const b = book();
  const partnerDeals = b.deals.map((deal) => (deal.teaserSentTo.includes("p-a") ? { ...deal, teaserSentTo: ["partner-firm"] } : deal));
  return { ...b, deals: partnerDeals };
};
const owner = person("owner", ["ADMIN_OWNER"]);
const underwriter = person("uw", ["UNDERWRITER"]);
const processor = person("proc", ["PROCESSOR"]);
const borrower = person("borrower-1", ["BORROWER"]);
const stranger = person("borrower-2", ["BORROWER"]);
const broker = person("broker-user", ["BROKER"], "broker-firm");
const partner = person("partner-user", ["PARTNER_LENDER"], "partner-firm");
const buyer = person("buy-a", ["LOAN_BUYER"]);
const agent = person("agent", ["CLOSING_AGENT"]);

describe("what each account receives", () => {
  it("staff see the whole book", () => {
    const scoped = scopeBook(live(), owner);
    expect(scoped.deals.length).toBe(live().deals.length);
    expect(scoped.sources.length).toBeGreaterThan(0);
    expect(scoped.messages.some((message) => message.side === "internal")).toBe(true);
  });
  it("a borrower gets only their own loans, with no capital, broker or team details", () => {
    const scoped = scopeBook(live(), borrower);
    expect(scoped.deals.map((deal) => deal.borrowerId).every((id) => id === "borrower-1")).toBe(true);
    expect(scoped.deals.length).toBeGreaterThan(0);
    const text = JSON.stringify(scoped);
    for (const secret of ["Jordan Demo", "Quinn Sample", "Balance Sheet", "Borrower is slow", "Demo Partner Capital", "Harbor Note"]) expect(text).not.toContain(secret);
    for (const deal of scoped.deals) expect(deal).toMatchObject({ allocations: [], teaserSentTo: [], brokerPoints: undefined });
    expect(scoped).toMatchObject({ bids: [], offers: [], sales: [], sources: [], audit: [], partners: [], buyers: [] });
    expect(scopeBook(live(), stranger).deals).toEqual([]);
  });
  it("a broker gets only their firm's deals, and never team notes", () => {
    const scoped = scopeBook(live(), broker);
    expect(scoped.deals.map((deal) => deal.id).sort()).toEqual(["d10", "d15", "d3"]);
    expect(scoped.deals.find((deal) => deal.id === "d3")?.borrowerName).toBe("Jordan Demo (FAKE)");
    expect(scoped.brokerId).toBe("broker-firm");
    expect(JSON.stringify(scoped)).not.toContain("Partner is pushy");
    expect(scoped.sources).toEqual([]);
  });
  it("a partner sees blind teasers, with no borrower, address or other firm's bid", () => {
    const scoped = scopeBook(live(), partner);
    expect(scoped.deals.map((deal) => deal.id).sort()).toEqual(["d3", "d5"]);
    const text = JSON.stringify(scoped);
    for (const secret of ["Jordan Demo", "Demo Holdings", "789 Mockingbird", "Miami\"", "Sample Bridge Fund", "Riley Placeholder", "Partner is pushy"]) expect(text).not.toContain(secret);
    expect(scoped.bids.map((bid) => bid.partnerId)).toEqual(["partner-firm"]);
    expect(scoped.partners.map((item) => item.id)).toEqual(["partner-firm"]);
  });
  it("a partner sees nothing before signing, and the whole file only after winning", () => {
    const unsigned = live();
    unsigned.partners = unsigned.partners.map((item) => (item.id === "partner-firm" ? { ...item, ndaSigned: false } : item));
    expect(scopeBook(unsigned, partner).deals).toEqual([]);
    const won = reducer(live(), { t: "acceptBid", bidId: "bid1" });
    expect(scopeBook(won, partner).deals.find((deal) => deal.id === "d3")?.borrowerName).toBe("Jordan Demo (FAKE)");
    expect(scopeBook(won, partner).deals.find((deal) => deal.id === "d5")?.borrowerName).toBe("");
  });
  it("another partner only learns a deal is taken, not by whom or at what price", () => {
    const won = reducer(live(), { t: "acceptBid", bidId: "bid2" });
    const taken = scopeBook(won, partner).bids.find((bid) => bid.id === "bid2")!;
    expect(taken).toMatchObject({ partnerId: "", pct: 0, lenderRate: 0, status: "accepted" });
  });
  it("a buyer sees blind loans for sale and the full file only on what they own", () => {
    const scoped = scopeBook(live(), buyer);
    expect(scoped.buyerId).toBe("buy-a");
    const text = JSON.stringify(scoped);
    for (const secret of ["Quinn Sample", "410 Test Harbor", "Blake Notreal", "Sample Whole Loan", "Balance Sheet"]) expect(text).not.toContain(secret);
    expect(scoped.deals.find((deal) => deal.id === "d14")?.address).toBe("250 Sample Shore Dr");
    expect(scoped.offers.every((offer) => offer.buyerId === "buy-a")).toBe(true);
  });
  it("a buyer never sees who else bought a loan or for how much", () => {
    const other = reducer(live(), { t: "offerLoan", saleId: "s-d9", buyerId: "buy-b", pricePct: 97, note: "", atAsk: false });
    const offerId = other.offers.find((offer) => offer.buyerId === "buy-b" && offer.saleId === "s-d9")!.id;
    const offered = reducer(other, { t: "offerLoan", saleId: "s-d9", buyerId: "buy-a", pricePct: 96, note: "", atAsk: false });
    const sold = reducer(offered, { t: "decideOffer", offerId, accept: true });
    const sale = scopeBook(sold, buyer).sales.find((item) => item.id === "s-d9")!;
    expect(sale).toMatchObject({ status: "sold", soldTo: "another buyer", soldPct: undefined });
    expect(scopeBook(sold, buyer).deals.find((deal) => deal.id === "d9")?.address).toBe("");
  });
  it("a role with no workspace gets nothing", () => {
    expect(scopeBook(live(), agent).deals).toEqual([]);
  });
});

describe("what each account may do", () => {
  const b = live();
  it("names and firms come from the session, not the request", () => {
    expect(check(b, partner, { t: "bid", bid: { dealId: "d5", partnerId: "someone-else", pct: 100, lenderRate: 9, lenderPoints: 1, conditions: "", type: "bid" } })).toMatchObject({ action: { bid: { partnerId: "partner-firm" } } });
    expect(check(b, underwriter, { t: "approveDrawRequest", drawId: "draw-1", by: "Forged Name" })).toMatchObject({ action: { by: "uw name" } });
    expect(check(b, borrower, { t: "sendMessage", dealId: "d1", from: "The Owner", side: "team", text: "hi" })).toMatchObject({ action: { from: "borrower-1 name", side: "borrower" } });
    expect(check(b, buyer, { t: "offerLoan", saleId: "s-d9", buyerId: "buy-b", pricePct: 90, note: "", atAsk: false })).toMatchObject({ action: { buyerId: "buy-a" } });
  });
  it("a borrower can't touch another borrower's loan or any staff step", () => {
    expect(check(b, stranger, { t: "acceptTermSheet", dealId: "d18", signedName: "x" })).toEqual({ error: expect.stringMatching(/Only the borrower/) });
    expect(check(b, borrower, { t: "acceptTermSheet", dealId: "d18", signedName: "x" })).toHaveProperty("action");
    expect(check(b, stranger, { t: "requestDraw", dealId: "d2", by: "", note: "", contact: "x", photos: [], lines: [{ scopeId: "kitchen", requested: 1 }] })).toHaveProperty("error");
    expect(check(b, stranger, { t: "sendMessage", dealId: "d1", from: "", side: "borrower", text: "hi" })).toHaveProperty("error");
    for (const action of [{ t: "advanceLoan", dealId: "d1" }, { t: "docStatus", dealId: "d1", docId: "id", status: "accepted" }, { t: "commit", dealId: "d8" }, { t: "releaseDraw", drawId: "draw-1" }, { t: "recordPayment", dealId: "d2" }, { t: "saveSource", source: { id: "x", name: "x", type: "gt_balance_sheet", commitment: 1, baseDeployed: 0, baseUnfunded: 0 } }] as BookAction[]) {
      expect(check(b, borrower, action)).toHaveProperty("error");
    }
  });
  it("only team members can write a team note", () => {
    expect(check(b, owner, { t: "sendMessage", dealId: "d1", from: "", side: "internal", text: "note" })).toMatchObject({ action: { side: "internal" } });
    expect(check(b, borrower, { t: "sendMessage", dealId: "d1", from: "", side: "internal", text: "note" })).toMatchObject({ action: { side: "borrower" } });
  });
  it("staff are held to their permissions", () => {
    expect(check(b, processor, { t: "docStatus", dealId: "d1", docId: "id", status: "accepted" })).toHaveProperty("action");
    expect(check(b, processor, { t: "commit", dealId: "d8" })).toHaveProperty("error");
    expect(check(b, processor, { t: "releaseDraw", drawId: "draw-1" })).toHaveProperty("error");
    expect(check(b, processor, { t: "saveSource", source: { id: "x", name: "x", type: "gt_balance_sheet", commitment: 1, baseDeployed: 0, baseUnfunded: 0 } })).toHaveProperty("error");
    expect(check(b, underwriter, { t: "approveFunding", dealId: "d15", by: "" })).toHaveProperty("action");
    expect(check(b, processor, { t: "approveFunding", dealId: "d15", by: "" })).toHaveProperty("error");
    expect(check(b, person("denied", ["PROCESSOR"]), { t: "docStatus", dealId: "d1", docId: "id", status: "accepted" })).toHaveProperty("action");
    const blocked = { ...person("denied", ["PROCESSOR"]), deniedPermissions: ["review_documents"] };
    expect(check(b, blocked, { t: "docStatus", dealId: "d1", docId: "id", status: "accepted" })).toHaveProperty("error");
  });
  it("a term sheet above the underwriter's limit is refused", () => {
    const big = { ...b, deals: b.deals.map((deal) => (deal.id === "d3" ? { ...deal, status: "underwriting" as const, app: { ...deal.app, purchasePrice: 2_000_000, rehab: 800_000, arv: 4_000_000 } } : deal)) };
    expect(check(big, underwriter, { t: "advanceLoan", dealId: "d3" })).toEqual({ error: expect.stringMatching(/above your term sheet limit/) });
    expect(check(big, owner, { t: "advanceLoan", dealId: "d3" })).toHaveProperty("action");
  });
  it("funding takes two different people", () => {
    expect(check(b, owner, { t: "advanceLoan", dealId: "d15" })).toHaveProperty("action");
    const once = reducer(b, { t: "approveFunding", dealId: "d15", by: "owner name" });
    expect(check(once, owner, { t: "approveFunding", dealId: "d15", by: "" })).toEqual({ error: expect.stringMatching(/different approver/) });
    expect(reducer(once, { t: "advanceLoan", dealId: "d15" })).toBe(once);
    const twice = reducer(once, { t: "approveFunding", dealId: "d15", by: "uw name" });
    expect(reducer(twice, { t: "advanceLoan", dealId: "d15" }).deals.find((deal) => deal.id === "d15")?.status).toBe("funded");
  });
  it("a partner or buyer can't act for another firm or on what they weren't sent", () => {
    expect(check(b, partner, { t: "bid", bid: { dealId: "d1", partnerId: "", pct: 100, lenderRate: 9, lenderPoints: 1, conditions: "", type: "bid" } })).toHaveProperty("error");
    expect(check(b, partner, { t: "bid", bid: { dealId: "d3", partnerId: "", pct: 100, lenderRate: 9, lenderPoints: 1, conditions: "", type: "bid" } })).toEqual({ error: expect.stringMatching(/already responded/) });
    expect(check(b, buyer, { t: "offerLoan", saleId: "s-d14", buyerId: "", pricePct: 90, note: "", atAsk: false })).toEqual({ error: expect.stringMatching(/no longer for sale/) });
    expect(check(b, buyer, { t: "offerLoan", saleId: "s-d10", buyerId: "", pricePct: 90, note: "", atAsk: false })).toEqual({ error: expect.stringMatching(/already have an offer/) });
    expect(check(b, borrower, { t: "offerLoan", saleId: "s-d9", buyerId: "", pricePct: 90, note: "", atAsk: false })).toHaveProperty("error");
  });
  it("a document can't be marked received without its file, or a loan relinked by a request", () => {
    expect(check(b, borrower, { t: "uploadDoc", dealId: "d1", docId: "bank", fileName: "x.pdf" })).toEqual({ error: expect.stringMatching(/Upload the file/) });
    expect(check(b, borrower, { t: "uploadDoc", dealId: "d1", docId: "bank", fileName: "x.pdf" }, true)).toHaveProperty("action");
    expect(check(b, owner, { t: "linkBorrower", dealId: "d1", borrowerId: "x", borrowerName: "x" })).toHaveProperty("error");
    expect(parseAction({ t: "uploadDoc", dealId: "d1", docId: "bank", fileName: "x.pdf" })).toBeNull();
    expect(parseAction({ t: "linkBorrower", dealId: "d1", borrowerId: "x", borrowerName: "x" })).toBeNull();
  });
  it("sample data controls never reach the server", () => {
    for (const t of ["loadSample", "clearSample", "reset"] as const) expect(check(b, owner, { t })).toHaveProperty("error");
    for (const t of ["loadSample", "clearSample", "reset"]) expect(parseAction({ t })).toBeNull();
  });
  it("a scope of work keeps what was already released, whatever the request says", () => {
    const result = check(b, borrower, { t: "saveScope", dealId: "d1", summary: "", scope: b.deals.find((deal) => deal.id === "d1")!.scope!.map((line) => ({ ...line, released: 0 })) });
    expect(result).toHaveProperty("action");
    const funded = check(b, borrower, { t: "saveScope", dealId: "d2", summary: "", scope: [] });
    expect(funded).toEqual({ error: expect.stringMatching(/locked/) });
  });
  it("staff can start a loan; a real application needs real details", () => {
    const app = b.deals[0].app;
    const full = { t: "submitApp" as const, app, address: "1 Real St", city: "Miami", zip: "33101", entityName: "Real LLC", exitStrategy: "Sell" };
    expect(check(b, borrower, { ...full, address: "" })).toEqual({ error: expect.stringMatching(/property address/) });
    expect(check(b, borrower, { ...full, client: { name: "Forged", borrowerId: "someone-else" } })).toMatchObject({ action: { client: { name: "borrower-1 name", borrowerId: "borrower-1" } } });
    expect(check(b, broker, { ...full, client: { name: "Client", brokerId: "other-firm", brokerPoints: 99 } })).toMatchObject({ action: { client: { name: "Client", brokerId: "broker-firm", brokerPoints: 5 } } });
    expect(check(b, broker, full)).toEqual({ error: expect.stringMatching(/client's name/) });
    expect(check(b, owner, { ...full, client: { name: "Client" } })).toHaveProperty("action");
    expect(check(b, partner, full)).toHaveProperty("error");
  });
  it("files follow the same lines", () => {
    const yes = allowedFor(owner);
    expect(canOpenFile(b, owner, "d1", yes)).toBe(true);
    expect(canOpenFile(b, borrower, "d1", yes)).toBe(true);
    expect(canOpenFile(b, stranger, "d1", yes)).toBe(false);
    expect(canOpenFile(b, broker, "d3", yes)).toBe(true);
    expect(canOpenFile(b, broker, "d1", yes)).toBe(false);
    expect(canOpenFile(b, partner, "d3", yes)).toBe(false);
    expect(canOpenFile(reducer(b, { t: "acceptBid", bidId: "bid1" }), partner, "d3", yes)).toBe(true);
    expect(canOpenFile(b, buyer, "d14", yes)).toBe(true);
    expect(canOpenFile(b, buyer, "d9", yes)).toBe(false);
    expect(canOpenFile(b, owner, "nope", yes)).toBe(false);
    expect(canUploadFile(b, borrower, "d1", yes)).toBe(true);
    expect(canUploadFile(b, stranger, "d1", yes)).toBe(false);
    expect(canUploadFile(b, partner, "d3", yes)).toBe(false);
    expect(firmOf(partner)).toBe("partner-firm");
    expect(firmOf(buyer)).toBe("buy-a");
  });
});

describe("requests from the browser", () => {
  it("drops unknown fields and refuses anything malformed", () => {
    expect(parseAction({ t: "advanceLoan", dealId: "d1", extra: "x" })).toEqual({ t: "advanceLoan", dealId: "d1" });
    expect(parseAction({ t: "nothing" })).toBeNull();
    expect(parseAction("nonsense")).toBeNull();
    expect(parseAction({ t: "listLoan", dealId: "d1", askPct: 500 })).toBeNull();
    expect(parseAction({ t: "requestPayoff", dealId: "d1", goodThrough: "tomorrow", by: "" })).toBeNull();
    expect(parseAction({ t: "sendMessage", dealId: "d1", from: "", side: "team", text: "x".repeat(5000) })).toBeNull();
    expect(parseAction({ t: "updateDealNumbers", dealId: "d1", changes: { purchasePrice: -5 } })).toBeNull();
    expect(parseAction({ t: "submitApp", app: { ...demoBook().deals[0].app, fico: "high" }, address: "", city: "", zip: "", entityName: "", exitStrategy: "" })).toBeNull();
    expect(parseAction({ t: "submitApp", app: demoBook().deals[0].app, address: "1 St", city: "x", zip: "1", entityName: "x", exitStrategy: "Sell" })).toHaveProperty("app");
  });
});

describe("alerts", () => {
  const b = live();
  it("tells the team about new work and the borrower about their loan, without details", () => {
    const applied = reducer(b, { t: "submitApp", app: b.deals[0].app, address: "1 St", city: "Miami", zip: "33101", entityName: "x", exitStrategy: "Sell", client: { name: "New Person", borrowerId: "n1" } });
    expect(alertsFor(b, applied, { t: "submitApp", app: b.deals[0].app, address: "1 St", city: "Miami", zip: "33101", entityName: "x", exitStrategy: "Sell" })[0]).toMatchObject({ to: "team", event: "loan.submitted" });
    const issued = reducer(b, { t: "advanceLoan", dealId: "d1" });
    expect(alertsFor(b, issued, { t: "advanceLoan", dealId: "d1" }).map((alert) => alert.to)).toEqual(["borrower", "broker"]);
    expect(alertsFor(b, b, { t: "sendMessage", dealId: "d1", from: "Uma", side: "team", text: "secret detail" }).map((alert) => alert.to)).toEqual(["borrower", "broker"]);
    expect(JSON.stringify(alertsFor(b, b, { t: "sendMessage", dealId: "d1", from: "Uma", side: "team", text: "secret detail" }))).not.toContain("secret detail");
    expect(alertsFor(b, b, { t: "sendMessage", dealId: "d1", from: "Uma", side: "internal", text: "note" })).toEqual([]);
    expect(alertsFor(b, b, { t: "sendMessage", dealId: "d1", from: "Alex", side: "borrower", text: "hi" })[0].to).toBe("team");
  });
});

describe("the attention list and exports", () => {
  it("adds up what's waiting and skips what isn't", () => {
    const items = attentionItems(live(), 3);
    expect(items.find((item) => item.key === "leads")).toMatchObject({ count: 3, href: "/admin/leads" });
    expect(items.find((item) => item.key === "draws")?.count).toBe(4);
    expect(items.find((item) => item.key === "late")?.count).toBe(1);
    expect(attentionItems(live(), 0).some((item) => item.key === "leads")).toBe(false);
  });
  it("a single loan's link goes straight to that loan", () => {
    const items = attentionItems({ ...live(), deals: live().deals.filter((deal) => deal.id === "d15") }, 0);
    expect(items.find((item) => item.key === "funding")).toMatchObject({ count: 1, href: "/admin/deals/d15" });
  });
  it("makes a spreadsheet safe from formulas, and quotes what needs it", () => {
    expect(toCsv([])).toBe("");
    expect(toCsv([{ Name: "=HYPERLINK(1)", City: "Fort Lauderdale, FL", Note: 'say "hi"', Amount: -5 }])).toBe('Name,City,Note,Amount\r\n\'=HYPERLINK(1),"Fort Lauderdale, FL","say ""hi""",-5');
  });
});
