// The loan book's rules: one set of records and one reducer, with no React and no database. Demo seats and sample data
// run it in the browser; real accounts run it on the server (lib/book-store.ts), after lib/book-access.ts checks them.
import { evaluate, type Application, type BuyBox } from "./engine";
import { approversNeeded, approvalError, defaultScope, drawRequestError, releaseToScope, reviewDraw } from "./draws";
import { canAdvance, nextStage } from "./loan-stages";
import { seedDeals, seedBids, seedDraws, seedLoanSales, seedLoanOffers, seedMessages, capitalSources, partners as seedPartners, brokers as seedBrokers, loanBuyers, BORROWER_ID, DEMO_PARTNER_ID, DEMO_BUYER_ID, DEMO_BROKER_ID, type Broker, type Deal, type Bid, type DrawRequest, type DrawRequestLine, type LoanMessage, type Partner, type PayoffRequest, type DocStatus, type CapitalSource, type LoanBuyer, type LoanOffer, type LoanSale, type ScopeLine } from "./mockData";
import { afterPayment, firstDueDate, payoffFor } from "./servicing";

export interface Book { partnerId: string; buyerId: string; brokerId: string; borrowerId: string; loanPrefix: string; deals: Deal[]; bids: Bid[]; partners: Partner[]; buyers: LoanBuyer[]; brokers: Broker[]; sales: LoanSale[]; offers: LoanOffer[]; draws: DrawRequest[]; payoffs: PayoffRequest[]; messages: LoanMessage[]; sources: CapitalSource[]; audit: { at: string; text: string }[]; sample?: boolean }

export type BookAction =
  | { t: "submitApp"; app: Application; address: string; city: string; zip: string; entityName: string; exitStrategy: string; client?: { name: string; borrowerId?: string; brokerId?: string; brokerPoints?: number }; source?: string }
  | { t: "advanceLoan"; dealId: string }
  | { t: "approveFunding"; dealId: string; by: string }
  | { t: "updateDealNumbers"; dealId: string; changes: Partial<Application> }
  | { t: "addDocRequest"; dealId: string; name: string; category: string }
  | { t: "linkBorrower"; dealId: string; borrowerId: string; borrowerName: string }
  | { t: "saveSource"; source: CapitalSource }
  | { t: "removeSource"; id: string }
  | { t: "saveFirm"; kind: "partner" | "buyer"; id: string; name: string; buyBox: BuyBox }
  | { t: "acceptTermSheet"; dealId: string; signedName: string }
  | { t: "saveScope"; dealId: string; scope: ScopeLine[]; summary: string }
  | { t: "requestDraw"; dealId: string; by: string; note: string; contact: string; photos: string[]; photoIds?: string[]; lines: DrawRequestLine[] }
  | { t: "sendInspector"; drawId: string }
  | { t: "recordInspection"; drawId: string; observed: Record<string, number> }
  | { t: "approveDrawRequest"; drawId: string; by: string }
  | { t: "rejectDraw"; drawId: string; reason: string }
  | { t: "releaseDraw"; drawId: string }
  | { t: "recordPayment"; dealId: string }
  | { t: "requestPayoff"; dealId: string; goodThrough: string; by: string }
  | { t: "sendPayoff"; payoffId: string }
  | { t: "markPaidOff"; payoffId: string }
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

export function demoBook(): Book {
  const deals = seedDeals.map((d) => {
    const e = evaluate(d.app);
    return { ...d, scope: defaultScope(d.app.product, e.holdback, d.disbursedDraws ?? 0), allocations: d.allocations.map((a) => ({ ...a, amount: a.amount || e.noteAmount })) };
  });
  const quoted = payoffFor(deals.find((d) => d.id === "d11")!, "2026-11-15");
  const payoffs: PayoffRequest[] = [{ id: "payoff-1", dealId: "d11", goodThrough: "2026-11-15", requestedAt: "2026-10-22T10:00:00-07:00", by: "Avery Mock (FAKE)", status: "requested", ...quoted }];
  return { partnerId: DEMO_PARTNER_ID, buyerId: DEMO_BUYER_ID, brokerId: DEMO_BROKER_ID, borrowerId: BORROWER_ID, loanPrefix: "LH-DEMO-", deals, bids: seedBids, partners: seedPartners, buyers: loanBuyers, brokers: seedBrokers, sales: seedLoanSales, offers: seedLoanOffers, draws: seedDraws, payoffs, messages: seedMessages, sources: capitalSources, audit: [{ at: SEED_AT, text: "Demo data loaded (all records are FAKE)" }] };
}

/** A book with no records: a new database, or an account with nothing to see yet. */
export const emptyBook = (): Book => ({ partnerId: "", buyerId: "", brokerId: "", borrowerId: "", loanPrefix: "LH-", deals: [], bids: [], partners: [], buyers: [], brokers: [], sales: [], offers: [], draws: [], payoffs: [], messages: [], sources: [], audit: [] });

export function reducer(s: Book, a: BookAction): Book {
  const log = (text: string) => [{ at: now(), text }, ...s.audit].slice(0, 50);
  const upd = (id: string, f: (d: Deal) => Deal) => s.deals.map((d) => (d.id === id ? f(d) : d));
  switch (a.t) {
    case "reset": return demoBook();
    case "loadSample": return { ...demoBook(), sample: true };
    case "clearSample": return emptyBook();
    case "submitApp": {
      // The highest number so far, not a count: a count could repeat if a record ever went away.
      const n = Math.max(1000, ...s.deals.map((item) => Number(item.loanNumber.match(/(\d+)$/)?.[1]) || 0)) + 1;
      const d: Deal = { id: `d${uid()}`, loanNumber: `${s.loanPrefix}${n}`, borrowerId: a.client?.borrowerId ?? (a.client ? `client-${uid()}` : s.borrowerId), borrowerName: a.client?.name || "Alex Sample (FAKE)", entityName: a.entityName || "Sample Flips LLC (FAKE)", address: a.address || "100 New Demo St", city: a.city || "Hollywood", zip: a.zip || "33020", app: a.app, status: "submitted", daysInStage: 0, capitalStatus: "not_started", allocations: [], teaserSentTo: [], source: a.source ?? (a.client?.brokerId ? "broker" : "web_quote"), brokerId: a.client?.brokerId, brokerPoints: a.client?.brokerPoints, scope: defaultScope(a.app.product, evaluate(a.app).holdback),
        docs: [
          { id: "id", name: "Government ID (each guarantor)", category: "Identity", status: "requested" },
          { id: "entity", name: "LLC Articles + Operating Agreement", category: "Entity", status: "requested" },
          { id: "contract", name: "Purchase contract (fully executed)", category: "Property", status: "requested" },
          { id: "sow", name: "Scope of work / rehab budget", category: "Property", status: a.app.rehab > 0 ? "requested" : "waived" },
          { id: "bank", name: "Bank statements (2 most recent months)", category: "Liquidity", status: "requested" },
        ], exitStrategy: a.exitStrategy, closingDate: "2026-11-30" };
      return { ...s, deals: [d, ...s.deals], audit: log(`Application ${d.loanNumber} submitted${a.client?.brokerId ? " by broker" : a.client ? " by staff" : " by borrower"}`) };
    }
    case "approveFunding": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (deal.status !== "closing" || deal.fundingApprovers?.includes(a.by)) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, fundingApprovers: [...(d.fundingApprovers ?? []), a.by] })), audit: log(`${deal.loanNumber}: funding approved by ${a.by}`) };
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
      const stage = nextStage(deal, evaluate(deal.app));
      if (!stage || !canAdvance(stage)) return s;
      const funding = stage.to === "funded";
      const today = now().slice(0, 10);
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, status: stage.to, daysInStage: 0, ...(funding ? { capitalStatus: "funded" as const, closingDate: today, nextPaymentDue: firstDueDate(today) } : {}) })), audit: log(`${deal.loanNumber}: moved to ${stage.to.replace(/_/g, " ")}`) };
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
      if (draw.status !== "approved" || !draw.approved) return s;
      return { ...s,
        draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, status: "funded", fundedAt: now() } : d)),
        deals: upd(deal.id, (d) => ({ ...d, disbursedDraws: (d.disbursedDraws ?? 0) + draw.approved!, scope: releaseToScope(d.scope ?? [], d, draw) })),
        audit: log(`${deal.loanNumber}: draw of $${draw.approved.toLocaleString()} released`) };
    }
    case "recordPayment": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, afterPayment), audit: log(`${deal.loanNumber}: payment recorded`) };
    }
    case "requestPayoff": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const payoff: PayoffRequest = { id: `payoff${uid()}`, dealId: a.dealId, goodThrough: a.goodThrough, requestedAt: now(), by: a.by, status: "requested", ...payoffFor(deal, a.goodThrough) };
      return { ...s, payoffs: [payoff, ...s.payoffs], audit: log(`${deal.loanNumber}: payoff statement requested, good through ${a.goodThrough}`) };
    }
    case "sendPayoff": return { ...s, payoffs: s.payoffs.map((p) => (p.id === a.payoffId ? { ...p, status: "sent" } : p)), audit: log("Payoff statement sent") };
    case "markPaidOff": {
      const payoff = s.payoffs.find((p) => p.id === a.payoffId)!; const deal = s.deals.find((d) => d.id === payoff.dealId)!;
      // The money is back, so the loan stops counting against capital.
      return { ...s, payoffs: s.payoffs.map((p) => (p.id === a.payoffId ? { ...p, status: "paid" } : p)), deals: upd(deal.id, (d) => ({ ...d, status: "paid_off", allocations: [], nextPaymentDue: undefined, paymentsLate: 0 })), sales: s.sales.map((x) => (x.dealId === deal.id && x.status === "listed" ? { ...x, status: "withdrawn" } : x)), audit: log(`${deal.loanNumber}: paid off`) };
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

