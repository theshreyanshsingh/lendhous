// The loan book's rules: one set of records and one reducer, with no React and no database. Demo seats and sample data
// run it in the browser; real accounts run it on the server (lib/book-store.ts), after lib/book-access.ts checks them.
import { evaluate, type Application, type BuyBox } from "./engine";
import { countedDeals, missingDocs, needsList, withSponsor } from "./credit";
import { approversNeeded, approvalError, defaultScope, drawRequestError, releaseToScope, reviewDraw } from "./draws";
import { activeWire, missingClosingItems, verifyProblem, wireProblem } from "./closing";
import { latestScreening, ofacBlocker, sameResult, screeningSubjects } from "./ofac";
import { cureError, defaultError, executeError, extensionFee, extensionRequestError, payoffError, payoffOn, PRE_FUNDING, reopenTo, closureReason, DEFAULT_KINDS } from "./loan-exits";
import { canAdvance, nextStage } from "./loan-stages";
import { seedDeals, seedBids, seedDraws, seedLoanSales, seedLoanOffers, seedMessages, seedPhotoRequests, DEMO_SPONSORS, capitalSources, partners as seedPartners, brokers as seedBrokers, loanBuyers, BORROWER_ID, DEMO_PARTNER_ID, DEMO_BUYER_ID, DEMO_BROKER_ID, type Broker, type ClosingAgent, type Closure, type Deal, type DefaultKind, type Bid, type DrawRequest, type DrawRequestLine, type LoanExtension, type LoanMessage, type Screening, type WireInstruction, type Partner, type PayoffRequest, type DocStatus, type CapitalSource, type LoanBuyer, type LoanOffer, type LoanSale, type LoanPayment, type PaymentMethod, type PhotoRequest, type RequestPhoto, type ScopeLine, type Sponsor } from "./mockData";
import { BASE_VERSION, currentPricing, type PricingPayload } from "./pricing-versions";
import { DEMO_SERVICING_DAY, firstDueDate, ledger, maturityOf, payoffFor, servicingDate, settle } from "./servicing";

export interface Book { partnerId: string; buyerId: string; brokerId: string; borrowerId: string; loanPrefix: string; deals: Deal[]; bids: Bid[]; partners: Partner[]; buyers: LoanBuyer[]; brokers: Broker[]; sales: LoanSale[]; offers: LoanOffer[]; draws: DrawRequest[]; photoRequests: PhotoRequest[]; payoffs: PayoffRequest[]; messages: LoanMessage[]; sources: CapitalSource[]; audit: { at: string; text: string }[]; sample?: boolean; /** The pricing its loans use, as sent to a browser. Not part of the records. */ pricing?: PricingPayload }

export type BookAction =
  | { t: "submitApp"; app: Application; address: string; city: string; zip: string; entityName: string; exitStrategy: string; client?: { name: string; borrowerId?: string; brokerId?: string; brokerPoints?: number }; source?: string; sponsor?: Sponsor }
  | { t: "saveSponsor"; dealId: string; sponsor: Sponsor }
  /** A signed borrower application, applied to a loan already started. Only the server does it, from the signed link. */
  | { t: "applyBorrowerInfo"; dealId: string; app: Application; address: string; city: string; zip: string; entityName: string; exitStrategy: string; sponsor: Sponsor; signedBy: string }
  | { t: "verifyTrackDeal"; dealId: string; trackId: string; verified: boolean }
  | { t: "signOffCredit"; dealId: string; by: string; note: string }
  | { t: "reopenCreditReview"; dealId: string }
  | { t: "advanceLoan"; dealId: string }
  /** Moves an application not yet given a term sheet onto the pricing new quotes use. */
  | { t: "repriceLoan"; dealId: string; by: string }
  | { t: "approveFunding"; dealId: string; by: string }
  | { t: "saveClosing"; dealId: string; closing: ClosingAgent }
  | { t: "enterWire"; dealId: string; wireId: string; bankName: string; routing: string; account: string; beneficiary: string; reference: string; source: string; by: string }
  | { t: "addClosingChecklist"; dealId: string }
  /** A screening against the sanctions list. Only the server makes one: it holds the list. */
  | { t: "recordScreening"; dealId: string; screening: Screening }
  | { t: "decideScreening"; dealId: string; screeningId: string; decision: "cleared" | "match"; reason: string; by: string }
  | { t: "verifyWire"; dealId: string; wireId: string; phone: string; phoneSource: string; spokeWith: string; by: string }
  | { t: "updateDealNumbers"; dealId: string; changes: Partial<Application> }
  | { t: "addDocRequest"; dealId: string; name: string; category: string }
  | { t: "linkBorrower"; dealId: string; borrowerId: string; borrowerName: string }
  | { t: "saveSource"; source: CapitalSource }
  | { t: "removeSource"; id: string }
  | { t: "saveFirm"; kind: "partner" | "buyer"; id: string; name: string; buyBox: BuyBox }
  | { t: "acceptTermSheet"; dealId: string; signedName: string }
  | { t: "saveScope"; dealId: string; scope: ScopeLine[]; summary: string }
  | { t: "requestDraw"; dealId: string; by: string; note: string; contact: string; photos: string[]; photoIds?: string[]; lines: DrawRequestLine[] }
  | { t: "askForPhotos"; requestId: string; dealId: string; drawId?: string; to: string; email?: string; who: PhotoRequest["who"]; scopeIds: string[]; by: string; byTeam: boolean; expiresAt: string }
  | { t: "renewPhotoRequest"; requestId: string; expiresAt: string }
  | { t: "turnOffPhotoRequest"; requestId: string }
  | { t: "addRequestPhoto"; requestId: string; photo: RequestPhoto }
  | { t: "removeRequestPhoto"; requestId: string; photoId: string }
  | { t: "finishPhotoRequest"; requestId: string; by: string; note: string }
  | { t: "sendInspector"; drawId: string }
  | { t: "recordInspection"; drawId: string; observed: Record<string, number> }
  | { t: "approveDrawRequest"; drawId: string; by: string }
  | { t: "rejectDraw"; drawId: string; reason: string }
  | { t: "releaseDraw"; drawId: string }
  | { t: "recordPayment"; dealId: string; amount: number; receivedOn: string; method: PaymentMethod; reference: string; by: string }
  | { t: "reversePayment"; dealId: string; paymentId: string; reason: string; by: string }
  | { t: "waiveLateFee"; dealId: string; due: string; reason: string; by: string }
  /** The nightly check: brings every serviced loan up to a day. Only the server's job sends it. */
  | { t: "settleLoans"; asOf: string }
  | { t: "requestPayoff"; dealId: string; goodThrough: string; by: string }
  | { t: "sendPayoff"; payoffId: string }
  | { t: "recordPayoff"; dealId: string; amount: number; receivedOn: string; method: PaymentMethod; reference: string; by: string }
  | { t: "recordLienRelease"; dealId: string; step: "sent" | "recorded"; on: string; reference: string; by: string }
  /** byTeam comes from the session, never the request: it decides who hears about it. */
  | { t: "closeApplication"; dealId: string; outcome: "declined" | "withdrawn"; reason: string; note: string; by: string; byTeam: boolean }
  | { t: "reopenApplication"; dealId: string; by: string }
  | { t: "declareDefault"; dealId: string; kind: DefaultKind; effectiveOn: string; note: string; by: string }
  | { t: "cureDefault"; dealId: string; note: string; by: string }
  | { t: "requestExtension"; dealId: string; months: number; reason: string; by: string; byTeam: boolean }
  | { t: "approveExtension"; dealId: string; extensionId: string; by: string }
  | { t: "declineExtension"; dealId: string; extensionId: string; reason: string; by: string }
  | { t: "executeExtension"; dealId: string; extensionId: string; on: string; method: PaymentMethod; reference: string; by: string }
  | { t: "sendMessage"; dealId: string; from: string; side: LoanMessage["side"]; text: string }
  | { t: "uploadDoc"; dealId: string; docId: string; fileName: string; documentId?: string }
  | { t: "docStatus"; dealId: string; docId: string; status: DocStatus }
  | { t: "route"; dealId: string; route: "in_house" | "partner" | "split"; inHouseAmount: number }
  | { t: "sendTeaser"; dealId: string; partnerIds: string[] }
  | { t: "bid"; bid: Omit<Bid, "id" | "at" | "status"> }
  | { t: "acceptBid"; bidId: string }
  | { t: "commit"; dealId: string }
  | { t: "signNda"; partnerId: string }
  | { t: "signBuyerNda"; buyerId: string }
  | { t: "listLoan"; dealId: string; askPct: number }
  | { t: "unlistLoan"; saleId: string }
  | { t: "offerLoan"; saleId: string; buyerId: string; pricePct: number; note: string; atAsk: boolean }
  | { t: "decideOffer"; offerId: string; accept: boolean }
  | { t: "loadSample" }
  | { t: "clearSample" }
  | { t: "reset" };

const now = () => new Date().toISOString();
// Two records made in the same millisecond must not share an id, or the second would overwrite the first once saved.
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** Fixed, not now(): /admin is prerendered, so a load-time stamp would not match the server HTML (hydration error). */
const SEED_AT = "2026-10-18T09:00:00-07:00";
const DEMO_PREFIX = "LH-DEMO-";
/** The FAKE demo book, whether a demo seat's or an account's sample data. */
export const isDemoBook = (s: Book) => s.loanPrefix === DEMO_PREFIX;
/** Today for servicing. The demo book keeps its own fixed day, so its loans don't fall further behind every month. */
export const serviceDay = (s: Book) => (isDemoBook(s) ? DEMO_SERVICING_DAY : servicingDate(new Date()));
const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function demoBook(): Book {
  const deals = seedDeals.map((d) => {
    const e = evaluate(d.app);
    const deal: Deal = { ...d, app: { ...d.app, pricingVersion: BASE_VERSION }, sponsor: DEMO_SPONSORS[d.id], scope: defaultScope(d.app.product, e.holdback, d.disbursedDraws ?? 0), allocations: d.allocations.map((a) => ({ ...a, amount: a.amount || e.noteAmount })) };
    // Every demo loan was screened the day before the demo's day, and one has a possible match to review.
    deal.screenings = [{ id: `ofac-demo-${d.id}`, at: "2026-10-30T12:00:00Z", by: "Nightly sanctions check", checkedAt: "2026-10-30T12:00:00Z", list: { fetchedAt: "2026-10-30T11:00:00Z", names: 18_240 }, status: d.id === "d6" ? "review" : "clear",
      subjects: screeningSubjects(deal).map((subject) => ({ ...subject, hits: d.id === "d6" && subject.role === "borrower" ? [{ uid: 990_001, name: "MOCKUP, Morgan Alexei (FAKE)", type: "individual", program: "SDGT (FAKE)", score: 0.946 }] : [] })) }];
    // Two loans near closing: one with its wire confirmed by a call-back, one whose instructions still need the call.
    const agent = { company: "Sample Title & Escrow (FAKE)", contact: "Terry Title (FAKE)", phone: "(954) 555-0142", email: "closings@sample-title.test", fileNumber: `ST-${d.loanNumber.slice(-4)}` };
    const wire = (id: string, verified: boolean): WireInstruction => ({ id, bankName: "First Demo Bank (FAKE)", routing: "123456780", account: "000123456789", beneficiary: "Sample Title & Escrow Trust Account (FAKE)", reference: agent.fileNumber, source: "Title company's secure portal", enteredBy: "Pat Processor (FAKE)", enteredAt: "2026-10-27T10:00:00-07:00", verification: verified ? { by: "Olivia Owner (FAKE)", at: "2026-10-28T09:30:00-07:00", phone: "(954) 555-0100", phoneSource: "Title company's website", spokeWith: "Dana Escrow (FAKE)" } : undefined });
    if (d.id === "d15") return { ...deal, closing: agent, wires: [wire("wire-demo-15", true)], docs: [...deal.docs, ...missingClosingItems(deal).map((doc) => ({ ...doc, status: "accepted" as const }))] };
    if (d.id === "d7") return { ...deal, closing: agent, wires: [wire("wire-demo-7", false)], docs: [...deal.docs, ...missingClosingItems(deal).map((doc) => ({ ...doc, status: "accepted" as const }))] };
    // One loan close to maturity whose borrower called to ask for more time, so the extension queue has something in it.
    if (d.id !== "d14") return deal;
    const extension: LoanExtension = { id: "ext-demo-1", months: 3, reason: "Kitchen cabinets are back-ordered; listing in February (FAKE)", requestedBy: "Pat Processor (FAKE)", requestedAt: "2026-10-28T10:00:00-07:00", fee: extensionFee(deal, 3), fromMaturity: maturityOf(deal), status: "requested", approvers: [] };
    return { ...deal, extensions: [extension] };
  });
  const quoted = payoffFor(deals.find((d) => d.id === "d11")!, "2026-11-15");
  const payoffs: PayoffRequest[] = [{ id: "payoff-1", dealId: "d11", goodThrough: "2026-11-15", requestedAt: "2026-10-22T10:00:00-07:00", by: "Avery Mock (FAKE)", status: "requested", ...quoted }];
  return { partnerId: DEMO_PARTNER_ID, buyerId: DEMO_BUYER_ID, brokerId: DEMO_BROKER_ID, borrowerId: BORROWER_ID, loanPrefix: DEMO_PREFIX, deals, bids: seedBids, partners: seedPartners, buyers: loanBuyers, brokers: seedBrokers, sales: seedLoanSales, offers: seedLoanOffers, draws: seedDraws, photoRequests: seedPhotoRequests, payoffs, messages: seedMessages, sources: capitalSources, audit: [{ at: SEED_AT, text: "Demo data loaded (all records are FAKE)" }] };
}

/** A book with no records: a new database, or an account with nothing to see yet. */
export const emptyBook = (): Book => ({ partnerId: "", buyerId: "", brokerId: "", borrowerId: "", loanPrefix: "LH-", deals: [], bids: [], partners: [], buyers: [], brokers: [], sales: [], offers: [], draws: [], photoRequests: [], payoffs: [], messages: [], sources: [], audit: [] });

export function reducer(s: Book, a: BookAction): Book {
  const log = (text: string) => [{ at: now(), text }, ...s.audit].slice(0, 50);
  const upd = (id: string, f: (d: Deal) => Deal) => s.deals.map((d) => (d.id === id ? f(d) : d));
  const photos = (id: string, f: (r: PhotoRequest) => PhotoRequest) => s.photoRequests.map((r) => (r.id === id ? f(r) : r));
  const requestOf = (id: string) => s.photoRequests.find((r) => r.id === id)!;
  switch (a.t) {
    case "reset": return demoBook();
    case "loadSample": return { ...demoBook(), sample: true };
    case "clearSample": return emptyBook();
    case "submitApp": {
      // Credit inputs come from the people and deals listed, and nothing arrives already verified.
      const sponsor = a.sponsor && { ...a.sponsor, trackRecord: a.sponsor.trackRecord.map(({ verified: _verified, ...item }) => item) };
      // Priced on today's pricing, and kept on it: publishing new numbers later doesn't change this loan.
      const app = { ...(sponsor ? withSponsor(a.app, sponsor, new Date()) : a.app), pricingVersion: currentPricing().version };
      // The highest number so far, not a count: a count could repeat if a record ever went away.
      const n = Math.max(1000, ...s.deals.map((item) => Number(item.loanNumber.match(/(\d+)$/)?.[1]) || 0)) + 1;
      const d: Deal = { id: `d${uid()}`, loanNumber: `${s.loanPrefix}${n}`, borrowerId: a.client?.borrowerId ?? (a.client ? `client-${uid()}` : s.borrowerId), borrowerName: a.client?.name || "Alex Sample (FAKE)", entityName: a.entityName || "Sample Flips LLC (FAKE)", address: a.address || "100 New Demo St", city: a.city || "Hollywood", zip: a.zip || "33020", app, status: "submitted", daysInStage: 0, capitalStatus: "not_started", allocations: [], teaserSentTo: [], source: a.source ?? (a.client?.brokerId ? "broker" : "web_quote"), brokerId: a.client?.brokerId, brokerPoints: a.client?.brokerPoints, scope: defaultScope(app.product, evaluate(app).holdback),
        docs: needsList(app, sponsor), sponsor, exitStrategy: a.exitStrategy, closingDate: "2026-11-30" };
      return { ...s, deals: [d, ...s.deals], audit: log(`Application ${d.loanNumber} submitted${a.client?.brokerId ? " by broker" : a.client ? " by staff" : " by borrower"}`) };
    }
    case "approveFunding": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // An approval is of a loan going to one verified wire, so there has to be one.
      const wire = activeWire(deal);
      if (deal.status !== "closing" || deal.fundingApprovers?.includes(a.by) || !wire?.verification) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, fundingApprovers: [...(d.fundingApprovers ?? []), a.by], fundingWireId: wire.id })), audit: log(`${deal.loanNumber}: funding approved by ${a.by}`) };
    }
    case "recordScreening": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const latest = latestScreening(deal);
      // The same names and the same hits as last time: it's a re-check, and any review of those hits still stands.
      if (latest && sameResult(latest, a.screening)) return { ...s, deals: upd(a.dealId, (d) => ({ ...d, screenings: d.screenings!.map((x) => (x.id === latest.id ? { ...x, checkedAt: a.screening.at, list: a.screening.list } : x)) })) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, screenings: [...(d.screenings ?? []), a.screening] })), audit: log(`${deal.loanNumber}: OFAC screening ${a.screening.status === "clear" ? "clear" : "found a possible match"}`) };
    }
    case "decideScreening": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const latest = latestScreening(deal);
      if (latest?.id !== a.screeningId || latest.status !== "review") return s;
      const decided = { by: a.by, at: now(), reason: a.reason };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, screenings: d.screenings!.map((x) => (x.id === a.screeningId ? { ...x, status: a.decision, decided } : x)) })), audit: log(`${deal.loanNumber}: possible OFAC match ${a.decision === "cleared" ? "cleared as a false positive" : "CONFIRMED"} by ${a.by}`) };
    }
    case "addClosingChecklist": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const missing = missingClosingItems(deal);
      if (!missing.length) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: [...d.docs, ...missing] })), audit: log(`${deal.loanNumber}: closing checklist added`) };
    }
    case "saveClosing": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, closing: a.closing })), audit: log(`${deal.loanNumber}: closing agent set to ${a.closing.company}`) };
    }
    case "enterWire": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (wireProblem(a) || deal.wires?.some((w) => w.id === a.wireId)) return s;
      const wire: WireInstruction = { id: a.wireId, bankName: a.bankName.trim(), routing: a.routing, account: a.account, beneficiary: a.beneficiary.trim(), reference: a.reference.trim(), source: a.source, enteredBy: a.by, enteredAt: now() };
      const replacing = Boolean(activeWire(deal));
      // New instructions replace the old ones and void any approval given on them: everyone looks again.
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, wires: [...(d.wires ?? []).map((w) => (w.replaced ? w : { ...w, replaced: { by: a.by, at: now() } })), wire], fundingApprovers: undefined, fundingWireId: undefined })), audit: log(`${deal.loanNumber}: wire instructions ${replacing ? "changed; funding approvals cleared" : "entered"} by ${a.by}`) };
    }
    case "verifyWire": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const wire = deal.wires?.find((w) => w.id === a.wireId);
      if (verifyProblem(wire, a.by, a.phone, a.phoneSource, a.spokeWith)) return s;
      const verification = { by: a.by, at: now(), phone: a.phone.trim(), phoneSource: a.phoneSource, spokeWith: a.spokeWith.trim() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, wires: d.wires?.map((w) => (w.id === a.wireId ? { ...w, verification } : w)) })), audit: log(`${deal.loanNumber}: wire instructions verified by ${a.by} with a call to ${verification.phone}`) };
    }
    case "updateDealNumbers": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const app = { ...deal.app, ...a.changes };
      const holdback = evaluate(app).holdback;
      // A new rehab budget starts its scope of work over, because the old split no longer adds up.
      const scope = holdback === evaluate(deal.app).holdback ? deal.scope : defaultScope(app.product, holdback);
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app, scope })), audit: log(`${deal.loanNumber}: underwriting numbers updated`) };
    }
    case "addDocRequest": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const doc = { id: `req-${uid()}`, name: a.name, category: a.category, status: "requested" as const };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: [...d.docs, doc] })), audit: log(`${deal.loanNumber}: requested ${a.name}`) };
    }
    case "linkBorrower": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, borrowerId: a.borrowerId, borrowerName: a.borrowerName })), audit: log(`${deal.loanNumber}: borrower account linked`) };
    }
    case "saveSponsor": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // Nothing listed is verified until staff check it, whatever the request says.
      const sponsor = { ...a.sponsor, trackRecord: a.sponsor.trackRecord.map((item) => ({ ...item, verified: deal.sponsor?.trackRecord.find((old) => old.id === item.id && old.address === item.address)?.verified })) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, sponsor, app: withSponsor(d.app, sponsor, new Date()), docs: [...d.docs, ...missingDocs(d.docs, d.app, sponsor)] })), audit: log(`${deal.loanNumber}: borrower profile updated`) };
    }
    case "applyBorrowerInfo": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // Once a term sheet is out or credit is signed off, the numbers are underwriting's: the team updates it by hand.
      if (!["submitted", "initial_review", "underwriting"].includes(deal.status) || deal.creditReview) return s;
      const sponsor = { ...a.sponsor, trackRecord: a.sponsor.trackRecord.map(({ verified: _verified, ...item }) => item) };
      const app = withSponsor({ ...a.app, pricingVersion: deal.app.pricingVersion }, sponsor, new Date());
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app, sponsor, address: a.address, city: a.city, zip: a.zip, entityName: a.entityName, exitStrategy: a.exitStrategy, docs: [...d.docs, ...missingDocs(d.docs, app, sponsor)] })), audit: log(`${deal.loanNumber}: borrower application signed by ${a.signedBy}`) };
    }
    case "verifyTrackDeal": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, sponsor: d.sponsor && { ...d.sponsor, trackRecord: d.sponsor.trackRecord.map((item) => (item.id === a.trackId ? { ...item, verified: a.verified } : item)) } })), audit: log(`${deal.loanNumber}: past deal ${a.verified ? "verified" : "unverified"}`) };
    }
    case "signOffCredit": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // From here the loan is priced on what was checked, not on what was claimed.
      const app = deal.sponsor ? withSponsor(deal.app, deal.sponsor, new Date(), true) : deal.app;
      const verifiedDeals = deal.sponsor ? countedDeals(deal.sponsor.trackRecord, new Date(), true).deals : deal.app.verifiedDeals;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app, creditReview: { by: a.by, at: now(), note: a.note, verifiedDeals } })), audit: log(`${deal.loanNumber}: credit review signed off by ${a.by}`) };
    }
    case "reopenCreditReview": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, creditReview: undefined })), audit: log(`${deal.loanNumber}: credit review reopened`) };
    }
    case "saveSource": return { ...s, sources: s.sources.some((x) => x.id === a.source.id) ? s.sources.map((x) => (x.id === a.source.id ? a.source : x)) : [...s.sources, a.source], audit: log(`Capital source saved: ${a.source.name}`) };
    case "removeSource": return { ...s, sources: s.sources.filter((x) => x.id !== a.id), audit: log("Capital source removed") };
    case "saveFirm": {
      const list = a.kind === "partner" ? s.partners : s.buyers;
      const firm = { id: a.id, name: a.name, ndaSigned: list.find((x) => x.id === a.id)?.ndaSigned ?? false, buyBox: a.buyBox };
      const saved = list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? firm : x)) : [...list, firm];
      return { ...s, ...(a.kind === "partner" ? { partners: saved } : { buyers: saved }), audit: log(`${a.kind === "partner" ? "Partner lender" : "Loan buyer"} saved: ${a.name}`) };
    }
    case "advanceLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const stage = nextStage(deal, evaluate(deal.app), serviceDay(s));
      if (!stage || !canAdvance(stage)) return s;
      const funding = stage.to === "funded";
      const today = serviceDay(s);
      // Clearing conditions starts the title company's checklist.
      const docs = stage.to === "conditions" ? [...deal.docs, ...missingClosingItems(deal)] : deal.docs;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, status: stage.to, daysInStage: 0, docs, ...(funding ? { capitalStatus: "funded" as const, closingDate: today, nextPaymentDue: firstDueDate(today) } : {}) })), audit: log(`${deal.loanNumber}: moved to ${stage.to.replace(/_/g, " ")}`) };
    }
    case "repriceLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const to = currentPricing().version;
      if (deal.app.pricingVersion === to) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app: { ...d.app, pricingVersion: to } })), audit: log(`${deal.loanNumber}: repriced on ${to} by ${a.by}`) };
    }
    case "acceptTermSheet": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (deal.status !== "term_sheet_issued" || !a.signedName.trim()) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, status: "term_sheet_accepted", daysInStage: 0, termSheetSignedBy: a.signedName.trim(), termSheetSignedAt: now() })), audit: log(`${deal.loanNumber}: term sheet accepted by ${a.signedName.trim()}`) };
    }
    case "saveScope": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, scope: a.scope, scopeSummary: a.summary, docs: d.docs.map((x) => (x.id === "sow" && (x.status === "requested" || x.status === "rejected") ? { ...x, status: "in_review", fileName: "Scope of work (online)" } : x)) })), audit: log(`${deal.loanNumber}: scope of work submitted`) };
    }
    case "requestDraw": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const lines = a.lines.filter((line) => line.requested > 0);
      if (drawRequestError(deal, lines)) return s;
      const draw: DrawRequest = { id: `draw${uid()}`, dealId: a.dealId, requestedAt: now(), by: a.by, note: a.note, contact: a.contact, photos: a.photos, photoIds: a.photoIds, lines, status: "submitted", approvers: [] };
      return { ...s, draws: [draw, ...s.draws], audit: log(`${deal.loanNumber}: draw of $${lines.reduce((sum, line) => sum + line.requested, 0).toLocaleString()} requested`) };
    }
    case "askForPhotos": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const request: PhotoRequest = { id: a.requestId, dealId: a.dealId, drawId: a.drawId, to: a.to, email: a.email, who: a.who, scopeIds: a.scopeIds, sentBy: a.by, byTeam: a.byTeam, sentAt: now(), expiresAt: a.expiresAt, status: "open", photos: [] };
      return { ...s, photoRequests: [request, ...s.photoRequests], audit: log(`${deal.loanNumber}: photos requested from ${a.to}`) };
    }
    case "renewPhotoRequest": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, expiresAt: a.expiresAt, status: r.status === "off" ? (r.finishedAt ? "received" : "open") : r.status })), audit: log(`New photo link sent to ${requestOf(a.requestId).to}`) };
    case "turnOffPhotoRequest": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, status: "off" })), audit: log(`Photo link for ${requestOf(a.requestId).to} turned off`) };
    case "addRequestPhoto": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, photos: [...r.photos, a.photo] })) };
    case "removeRequestPhoto": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, photos: r.photos.filter((photo) => photo.id !== a.photoId) })) };
    case "finishPhotoRequest": {
      const request = requestOf(a.requestId); const deal = s.deals.find((d) => d.id === request.dealId)!;
      return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, status: "received", finishedAt: now(), finishedBy: a.by, note: a.note })), audit: log(`${deal.loanNumber}: ${request.photos.length} photos received from ${a.by}`) };
    }
    case "sendInspector": return { ...s, draws: s.draws.map((d) => (d.id === a.drawId && d.status === "submitted" ? { ...d, status: "inspecting" } : d)), audit: log("Draw inspection ordered") };
    case "recordInspection": return { ...s, draws: s.draws.map((d) => (d.id === a.drawId && d.status === "inspecting" ? { ...d, status: "inspected", lines: d.lines.map((line) => ({ ...line, observedPct: a.observed[line.scopeId] ?? 0 })) } : d)), audit: log("Draw inspection recorded") };
    case "approveDrawRequest": {
      const draw = s.draws.find((d) => d.id === a.drawId)!; const deal = s.deals.find((d) => d.id === draw.dealId)!;
      if (approvalError(deal, draw, a.by)) return s;
      const amount = reviewDraw(deal, draw).approved;
      const approvers = [...draw.approvers, a.by];
      const done = approvers.length >= approversNeeded(deal, amount);
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, approvers, status: done ? "approved" : d.status, approved: done ? amount : undefined } : d)), audit: log(`${deal.loanNumber}: draw approved by ${a.by}${done ? "" : "; second approver needed"}`) };
    }
    case "rejectDraw": return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, status: "rejected", reason: a.reason } : d)), audit: log(`Draw rejected: ${a.reason}`) };
    case "releaseDraw": {
      const draw = s.draws.find((d) => d.id === a.drawId)!; const deal = s.deals.find((d) => d.id === draw.dealId)!;
      // No money goes out to anyone not screened in the last few days.
      if (draw.status !== "approved" || !draw.approved || ofacBlocker(deal, serviceDay(s))) return s;
      return { ...s,
        draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, status: "funded", fundedAt: now() } : d)),
        // Brought up to today first, so the payments already due keep the amount they owed before this draw.
        deals: upd(deal.id, (d) => ({ ...settle(d, serviceDay(s)), disbursedDraws: (d.disbursedDraws ?? 0) + draw.approved!, scope: releaseToScope(d.scope ?? [], d, draw) })),
        audit: log(`${deal.loanNumber}: draw of $${draw.approved.toLocaleString()} released`) };
    }
    case "recordPayment": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const payment: LoanPayment = { id: `pay${uid()}`, amount: Math.round(a.amount * 100) / 100, receivedOn: a.receivedOn, method: a.method, reference: a.reference, by: a.by, at: now() };
      const day = a.receivedOn > serviceDay(s) ? a.receivedOn : serviceDay(s);
      return { ...s, deals: upd(a.dealId, (d) => settle({ ...d, payments: [...(d.payments ?? []), payment] }, day)), audit: log(`${deal.loanNumber}: payment of ${money(payment.amount)} received ${a.receivedOn}`) };
    }
    case "reversePayment": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const payment = deal.payments?.find((p) => p.id === a.paymentId);
      if (!payment || payment.reversed) return s;
      const reversed = { by: a.by, at: now(), reason: a.reason };
      return { ...s, deals: upd(a.dealId, (d) => settle({ ...d, payments: (d.payments ?? []).map((p) => (p.id === a.paymentId ? { ...p, reversed } : p)) }, serviceDay(s))), audit: log(`${deal.loanNumber}: payment of ${money(payment.amount)} reversed: ${a.reason}`) };
    }
    case "waiveLateFee": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (deal.waivedFees?.some((item) => item.due === a.due)) return s;
      const waiver = { due: a.due, by: a.by, at: now(), reason: a.reason };
      return { ...s, deals: upd(a.dealId, (d) => settle({ ...d, waivedFees: [...(d.waivedFees ?? []), waiver] }, serviceDay(s))), audit: log(`${deal.loanNumber}: late fee on the ${a.due} payment waived by ${a.by}`) };
    }
    case "settleLoans": {
      const entries: { at: string; text: string }[] = [];
      const deals = s.deals.map((d) => {
        const next = settle(d, a.asOf);
        if (next === d || JSON.stringify(next) === JSON.stringify(d)) return d;
        const before = ledger(d); const after = ledger(next);
        if (after.paymentsLate > before.paymentsLate) entries.push({ at: now(), text: `${d.loanNumber}: ${after.paymentsLate} payment${after.paymentsLate === 1 ? "" : "s"} past due` });
        if (next.status !== d.status) entries.push({ at: now(), text: `${d.loanNumber}: moved to ${next.status.replace(/_/g, " ")}` });
        return next;
      });
      if (deals.every((d, index) => d === s.deals[index])) return s;
      return { ...s, deals, audit: [...entries.reverse(), ...s.audit].slice(0, 50) };
    }
    case "requestPayoff": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const payoff: PayoffRequest = { id: `payoff${uid()}`, dealId: a.dealId, goodThrough: a.goodThrough, requestedAt: now(), by: a.by, status: "requested", ...payoffFor(deal, a.goodThrough) };
      return { ...s, payoffs: [payoff, ...s.payoffs], audit: log(`${deal.loanNumber}: payoff statement requested, good through ${a.goodThrough}`) };
    }
    case "sendPayoff": return { ...s, payoffs: s.payoffs.map((p) => (p.id === a.payoffId ? { ...p, status: "sent" } : p)), audit: log("Payoff statement sent") };
    case "recordPayoff": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, a.receivedOn > today ? a.receivedOn : today);
      if (payoffError(deal, a.amount, a.receivedOn, today)) return s;
      const paidOff = { amount: Math.round(a.amount * 100) / 100, receivedOn: a.receivedOn, method: a.method, reference: a.reference, by: a.by, at: now(), owed: payoffOn(deal, a.receivedOn).quote.total };
      const closing = new Set(s.sales.filter((x) => x.dealId === deal.id && x.status === "listed").map((x) => x.id));
      // The money is back, so the loan stops counting against capital, and nothing else can be drawn, sold or extended on it.
      return { ...s,
        deals: upd(deal.id, () => ({ ...deal, status: "paid_off", daysInStage: 0, paidOff, allocations: [], nextPaymentDue: undefined, paymentsLate: 0, extensions: deal.extensions?.map((x) => (x.status === "requested" || x.status === "approved" ? { ...x, status: "declined" as const, declined: { by: a.by, at: now(), reason: "The loan was paid off" } } : x)) })),
        payoffs: s.payoffs.map((p) => (p.dealId === deal.id && p.status !== "paid" ? { ...p, status: "paid" } : p)),
        draws: s.draws.map((d) => (d.dealId === deal.id && d.status !== "funded" && d.status !== "rejected" ? { ...d, status: "rejected", reason: "The loan was paid off" } : d)),
        sales: s.sales.map((x) => (closing.has(x.id) ? { ...x, status: "withdrawn" } : x)),
        offers: s.offers.map((o) => (closing.has(o.saleId) && o.status === "submitted" ? { ...o, status: "declined" } : o)),
        audit: log(`${deal.loanNumber}: paid off with ${money(paidOff.amount)} received ${a.receivedOn}`) };
    }
    case "recordLienRelease": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.paidOff) return s;
      const before = deal.paidOff.release;
      const release = a.step === "sent" ? { ...before, sentOn: a.on, reference: a.reference || before?.reference || "", by: a.by } : { ...before, sentOn: before?.sentOn ?? a.on, recordedOn: a.on, reference: a.reference, by: a.by };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, paidOff: { ...d.paidOff!, release } })), audit: log(`${deal.loanNumber}: satisfaction of mortgage ${a.step === "sent" ? "sent for recording" : "recorded"} ${a.on}`) };
    }
    case "closeApplication": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!PRE_FUNDING.includes(deal.status)) return s;
      const closure: Closure = { outcome: a.outcome, reason: a.reason, note: a.note, by: a.by, at: now(), from: deal.status };
      // Whatever capital was held for it goes back, open bids are turned down and its photo links stop working.
      return { ...s,
        deals: upd(deal.id, (d) => ({ ...d, status: a.outcome, daysInStage: 0, closure, allocations: [], capitalStatus: "not_started", fundingApprovers: undefined })),
        bids: s.bids.map((b) => (b.dealId === deal.id && b.status === "submitted" ? { ...b, status: "declined" } : b)),
        photoRequests: s.photoRequests.map((r) => (r.dealId === deal.id && r.status === "open" ? { ...r, status: "off" } : r)),
        audit: log(`${deal.loanNumber}: ${a.outcome} (${closureReason(closure)})`) };
    }
    case "reopenApplication": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.closure) return s;
      const to = reopenTo(deal.closure);
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, status: to, daysInStage: 0, closure: undefined })), audit: log(`${deal.loanNumber}: reopened by ${a.by} at ${to.replace(/_/g, " ")}`) };
    }
    case "declareDefault": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      if (defaultError(deal, a.kind, a.effectiveOn, today)) return s;
      const opened = { kind: a.kind, effectiveOn: a.effectiveOn, note: a.note, by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, () => ({ ...deal, status: "default", daysInStage: 0, defaults: [...(deal.defaults ?? []), opened] })), audit: log(`${deal.loanNumber}: default declared by ${a.by}, effective ${a.effectiveOn} (${DEFAULT_KINDS[a.kind]})`) };
    }
    case "cureDefault": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      if (cureError(deal, today)) return s;
      const cured = { by: a.by, at: now(), note: a.note };
      // Back to whatever the payments say it is.
      return { ...s, deals: upd(deal.id, () => settle({ ...deal, status: "servicing_current", defaults: deal.defaults?.map((x) => (x.cured ? x : { ...x, cured })) }, today)), audit: log(`${deal.loanNumber}: default cured by ${a.by}`) };
    }
    case "requestExtension": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (extensionRequestError(deal, a.months, serviceDay(s), a.byTeam)) return s;
      const extension: LoanExtension = { id: `ext${uid()}`, months: a.months, reason: a.reason, requestedBy: a.by, requestedAt: now(), fee: extensionFee(deal, a.months), fromMaturity: maturityOf(deal), status: "requested", approvers: [] };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, extensions: [...(d.extensions ?? []), extension] })), audit: log(`${deal.loanNumber}: ${a.months}-month extension requested by ${a.by}`) };
    }
    case "approveExtension": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const extension = deal.extensions?.find((x) => x.id === a.extensionId);
      if (extension?.status !== "requested" || extension.approvers.includes(a.by)) return s;
      const approvers = [...extension.approvers, a.by];
      const done = approvers.length >= 2;
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, extensions: d.extensions?.map((x) => (x.id === a.extensionId ? { ...x, approvers, status: done ? "approved" : x.status } : x)) })), audit: log(`${deal.loanNumber}: extension approved by ${a.by}${done ? "" : "; second approver needed"}`) };
    }
    case "declineExtension": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const extension = deal.extensions?.find((x) => x.id === a.extensionId);
      if (extension?.status !== "requested" && extension?.status !== "approved") return s;
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, extensions: d.extensions?.map((x) => (x.id === a.extensionId ? { ...x, status: "declined", declined: { by: a.by, at: now(), reason: a.reason } } : x)) })), audit: log(`${deal.loanNumber}: extension declined by ${a.by}: ${a.reason}`) };
    }
    case "executeExtension": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      const extension = deal.extensions?.find((x) => x.id === a.extensionId);
      if (!extension || executeError(deal, extension, a.on, today)) return s;
      const executed = { by: a.by, at: now(), on: a.on, method: a.method, reference: a.reference };
      // A signed extension ends a default on the loan: the borrower is current and the maturity has moved.
      const cured = { by: a.by, at: now(), note: "Cured by the extension" };
      const next: Deal = { ...deal, status: "servicing_current", maturityNotices: undefined, extensions: deal.extensions?.map((x) => (x.id === a.extensionId ? { ...x, status: "executed", executed } : x)), defaults: deal.defaults?.map((x) => (x.cured ? x : { ...x, cured })) };
      return { ...s, deals: upd(deal.id, () => settle(next, today)), audit: log(`${deal.loanNumber}: extended ${extension.months} months to ${maturityOf(next)}; fee of ${money(extension.fee)} received`) };
    }
    case "sendMessage": {
      const text = a.text.trim();
      if (!text) return s;
      return { ...s, messages: [...s.messages, { id: `msg${uid()}`, dealId: a.dealId, from: a.from, side: a.side, text, at: now() }] };
    }
    case "uploadDoc": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: d.docs.map((x) => (x.id === a.docId ? { ...x, status: "uploaded", fileName: a.fileName, documentId: a.documentId } : x)) })), audit: log(`Document uploaded: ${a.fileName}`) };
    case "docStatus": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: d.docs.map((x) => (x.id === a.docId ? { ...x, status: a.status } : x)) })), audit: log(`Document ${a.docId} → ${a.status}`) };
    case "route": {
      const deal = s.deals.find((d) => d.id === a.dealId)!; const L = evaluate(deal.app).noteAmount;
      const inH = a.route === "in_house" ? L : a.route === "partner" ? 0 : Math.min(L, Math.max(0, a.inHouseAmount));
      const allocations = inH > 0 ? [{ sourceId: "gt-main", amount: inH }] : [];
      const capitalStatus = a.route === "in_house" ? "reserved" : deal.teaserSentTo.length ? deal.capitalStatus : "recommended";
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, route: a.route, allocations, capitalStatus })), audit: log(`${deal.loanNumber}: route set to ${a.route}${a.route === "split" ? ` (in-house $${inH.toLocaleString()})` : ""}`) };
    }
    case "sendTeaser": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, teaserSentTo: Array.from(new Set([...d.teaserSentTo, ...a.partnerIds])), capitalStatus: d.capitalStatus === "not_started" || d.capitalStatus === "recommended" ? "teaser_out" : d.capitalStatus })), audit: log(`Blind teaser sent to ${a.partnerIds.length} partner(s)`) };
    case "bid": {
      const b: Bid = { ...a.bid, id: `bid${uid()}`, at: now(), status: "submitted" };
      return { ...s, bids: [b, ...s.bids], deals: upd(a.bid.dealId, (d) => ({ ...d, capitalStatus: d.capitalStatus === "teaser_out" ? "bids_in" : d.capitalStatus })), audit: log(`${a.bid.type === "accept_as_offered" ? "Accept-as-offered" : "Bid"} received from ${a.bid.partnerId}`) };
    }
    case "acceptBid": {
      const b = s.bids.find((x) => x.id === a.bidId)!; const deal = s.deals.find((d) => d.id === b.dealId)!; const L = evaluate(deal.app).noteAmount;
      const partnerAmt = Math.round((L * b.pct) / 100);
      const inHouse = L - partnerAmt;
      const allocations = [{ sourceId: `partner:${b.partnerId}`, amount: partnerAmt }, ...(inHouse > 0 ? [{ sourceId: "gt-main", amount: inHouse }] : [])];
      return { ...s,
        bids: s.bids.map((x) => (x.id === b.id ? { ...x, status: "accepted" } : x.dealId === b.dealId && x.status === "submitted" ? { ...x, status: "declined" } : x)),
        deals: upd(b.dealId, (d) => ({ ...d, allocations, route: inHouse > 0 ? "split" : "partner", capitalStatus: "reserved" })),
        audit: log(`${deal.loanNumber}: bid from ${b.partnerId} accepted; partner commitment issued; other bids declined`) };
    }
    case "commit": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, capitalStatus: "committed" })), audit: log(`Capital committed (required before clear to close)`) };
    case "signNda": return { ...s, partners: s.partners.map((p) => (p.id === a.partnerId ? { ...p, ndaSigned: true } : p)), audit: log(`NDA / Non-Circumvention e-signed by ${a.partnerId} (demo)`) };
    case "signBuyerNda": return { ...s, buyers: s.buyers.map((b) => (b.id === a.buyerId ? { ...b, ndaSigned: true } : b)), audit: log(`Loan buyer NDA e-signed by ${a.buyerId} (demo)`) };
    case "listLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // A loan can be listed again after a withdrawal, so the sale's id has to be new each time.
      const sale: LoanSale = { id: `s-${a.dealId}-${uid()}`, dealId: a.dealId, askPct: a.askPct, status: "listed", listedAt: now().slice(0, 10) };
      return { ...s, sales: [sale, ...s.sales], audit: log(`${deal.loanNumber}: listed for sale at ${a.askPct}% of balance`) };
    }
    case "unlistLoan": {
      const sale = s.sales.find((x) => x.id === a.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      return { ...s, sales: s.sales.map((x) => (x.id === a.saleId ? { ...x, status: "withdrawn" } : x)), offers: s.offers.map((o) => (o.saleId === a.saleId && o.status === "submitted" ? { ...o, status: "declined" } : o)), audit: log(`${deal.loanNumber}: sale withdrawn; open offers declined`) };
    }
    case "offerLoan": {
      const sale = s.sales.find((x) => x.id === a.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      const offer: LoanOffer = { id: `offer${uid()}`, saleId: a.saleId, buyerId: a.buyerId, pricePct: a.pricePct, note: a.note, atAsk: a.atAsk, status: "submitted", at: now() };
      return { ...s, offers: [offer, ...s.offers], audit: log(`${deal.loanNumber}: offer of ${a.pricePct}% from ${a.buyerId}`) };
    }
    case "decideOffer": {
      const offer = s.offers.find((o) => o.id === a.offerId)!; const sale = s.sales.find((x) => x.id === offer.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      if (!a.accept) return { ...s, offers: s.offers.map((o) => (o.id === offer.id ? { ...o, status: "declined" } : o)), audit: log(`${deal.loanNumber}: offer from ${offer.buyerId} declined`) };
      return { ...s,
        offers: s.offers.map((o) => (o.id === offer.id ? { ...o, status: "accepted" } : o.saleId === offer.saleId && o.status === "submitted" ? { ...o, status: "declined" } : o)),
        sales: s.sales.map((x) => (x.id === sale.id ? { ...x, status: "sold", soldTo: offer.buyerId, soldPct: offer.pricePct, soldAt: now().slice(0, 10) } : x)),
        // The note leaves LendHous's books, which frees that capital to lend again.
        deals: upd(deal.id, (d) => ({ ...d, allocations: [{ sourceId: `buyer:${offer.buyerId}`, amount: evaluate(d.app).noteAmount }] })),
        audit: log(`${deal.loanNumber}: sold to ${offer.buyerId} at ${offer.pricePct}% of balance; other offers declined`) };
    }
  }
}

