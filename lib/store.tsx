"use client";
import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { evaluate, capitalAvailable, type Application, type Estimate } from "./engine";
import { seedDeals, seedBids, seedLoanSales, seedLoanOffers, capitalSources, partners as seedPartners, loanBuyers, BORROWER_ID, DEMO_PARTNER_ID, DEMO_BUYER_ID, type Deal, type Bid, type Partner, type DocStatus, type CapitalSource, type LoanBuyer, type LoanOffer, type LoanSale } from "./mockData";

interface State { partnerId: string; buyerId: string; deals: Deal[]; bids: Bid[]; partners: Partner[]; buyers: LoanBuyer[]; sales: LoanSale[]; offers: LoanOffer[]; sources: CapitalSource[]; audit: { at: string; text: string }[]; sample?: boolean }

type Action =
  | { t: "submitApp"; app: Application; address: string; city: string; zip: string; entityName: string; exitStrategy: string }
  | { t: "uploadDoc"; dealId: string; docId: string; fileName: string }
  | { t: "docStatus"; dealId: string; docId: string; status: DocStatus }
  | { t: "route"; dealId: string; route: "in_house" | "partner" | "split"; inHouseAmount: number }
  | { t: "sendTeaser"; dealId: string; partnerIds: string[] }
  | { t: "bid"; bid: Omit<Bid, "id" | "at" | "status"> }
  | { t: "acceptBid"; bidId: string }
  | { t: "commit"; dealId: string }
  | { t: "signNda"; partnerId: string }
  | { t: "signBuyerNda"; buyerId: string }
  | { t: "listLoan"; dealId: string; askPct: number; paymentsMade: number }
  | { t: "unlistLoan"; saleId: string }
  | { t: "offerLoan"; saleId: string; buyerId: string; pricePct: number; note: string; atAsk: boolean }
  | { t: "decideOffer"; offerId: string; accept: boolean }
  | { t: "loadSample" }
  | { t: "clearSample" }
  | { t: "reset" };

const now = () => new Date().toISOString();
// Demo seats share one demo book in the browser, so a bid placed as the partner seat shows up for the staff seats.
const KEY = "lendhous-demo-v2";
// Any other account can load the same book for itself. It stays with that account, in that browser.
const sampleKey = (accountId: string) => `lendhous-sample-v1:${accountId}`;
/** Fixed, not now(): /admin is prerendered, so a load-time stamp would not match the server HTML (hydration error). */
const SEED_AT = "2026-10-18T09:00:00-07:00";

function demoBook(): State {
  const deals = seedDeals.map((d) => {
    const e = evaluate(d.app);
    return { ...d, allocations: d.allocations.map((a) => ({ ...a, amount: a.amount || e.noteAmount })) };
  });
  return { partnerId: DEMO_PARTNER_ID, buyerId: DEMO_BUYER_ID, deals, bids: seedBids, partners: seedPartners, buyers: loanBuyers, sales: seedLoanSales, offers: seedLoanOffers, sources: capitalSources, audit: [{ at: SEED_AT, text: "Demo data loaded (all records are FAKE)" }] };
}

/** What a non-demo account sees until its records come from the database, or it loads the sample book: nothing. */
const emptyBook = (): State => ({ partnerId: "", buyerId: "", deals: [], bids: [], partners: [], buyers: [], sales: [], offers: [], sources: [], audit: [] });

function reducer(s: State, a: Action): State {
  const log = (text: string) => [{ at: now(), text }, ...s.audit].slice(0, 50);
  const upd = (id: string, f: (d: Deal) => Deal) => s.deals.map((d) => (d.id === id ? f(d) : d));
  switch (a.t) {
    case "reset": return demoBook();
    case "loadSample": return { ...demoBook(), sample: true };
    case "clearSample": return emptyBook();
    case "submitApp": {
      const n = s.deals.length + 1;
      const d: Deal = { id: `d${Date.now()}`, loanNumber: `LH-DEMO-${1000 + n}`, borrowerId: BORROWER_ID, borrowerName: "Alex Sample (FAKE)", entityName: a.entityName || "Sample Flips LLC (FAKE)", address: a.address || "100 New Demo St", city: a.city || "Hollywood", zip: a.zip || "33020", app: a.app, status: "submitted", daysInStage: 0, capitalStatus: "not_started", allocations: [], teaserSentTo: [], source: "web_quote",
        docs: [
          { id: "id", name: "Government ID (each guarantor)", category: "Identity", status: "requested" },
          { id: "entity", name: "LLC Articles + Operating Agreement", category: "Entity", status: "requested" },
          { id: "contract", name: "Purchase contract (fully executed)", category: "Property", status: "requested" },
          { id: "sow", name: "Scope of work / rehab budget", category: "Property", status: a.app.rehab > 0 ? "requested" : "waived" },
          { id: "bank", name: "Bank statements (2 most recent months)", category: "Liquidity", status: "requested" },
        ], exitStrategy: a.exitStrategy, closingDate: "2026-11-30" };
      return { ...s, deals: [d, ...s.deals], audit: log(`Application ${d.loanNumber} submitted by borrower`) };
    }
    case "uploadDoc": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: d.docs.map((x) => (x.id === a.docId ? { ...x, status: "uploaded", fileName: a.fileName } : x)) })), audit: log(`Document uploaded: ${a.fileName}`) };
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
      const b: Bid = { ...a.bid, id: `bid${Date.now()}`, at: now(), status: "submitted" };
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
      const sale: LoanSale = { id: `s-${a.dealId}-${Date.now()}`, dealId: a.dealId, askPct: a.askPct, paymentsMade: a.paymentsMade, status: "listed", listedAt: now().slice(0, 10) };
      return { ...s, sales: [sale, ...s.sales], audit: log(`${deal.loanNumber}: listed for sale at ${a.askPct}% of balance`) };
    }
    case "unlistLoan": {
      const sale = s.sales.find((x) => x.id === a.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      return { ...s, sales: s.sales.map((x) => (x.id === a.saleId ? { ...x, status: "withdrawn" } : x)), offers: s.offers.map((o) => (o.saleId === a.saleId && o.status === "submitted" ? { ...o, status: "declined" } : o)), audit: log(`${deal.loanNumber}: sale withdrawn; open offers declined`) };
    }
    case "offerLoan": {
      const sale = s.sales.find((x) => x.id === a.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      const offer: LoanOffer = { id: `offer${Date.now()}`, saleId: a.saleId, buyerId: a.buyerId, pricePct: a.pricePct, note: a.note, atAsk: a.atAsk, status: "submitted", at: now() };
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

const Ctx = createContext<{ s: State; dispatch: React.Dispatch<Action>; demo: boolean; viewerName: string } | null>(null);
type Outer = Action | { t: "hydrate"; state: State };
function outer(s: State, a: Outer): State { return a.t === "hydrate" ? a.state : reducer(s, a); }
export function StoreProvider({ demo, accountId, viewerName, children }: { demo: boolean; accountId: string; viewerName: string; children: React.ReactNode }) {
  const [s, dispatch] = useReducer(outer, demo, (isDemo: boolean) => (isDemo ? demoBook() : emptyBook()));
  const [hydrated, setHydrated] = React.useState(false);
  // Demo seats share the saved demo book. Any other account never sees it, even in the same browser, and keeps only
  // the sample book it loaded for itself.
  const key = demo ? KEY : sampleKey(accountId);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw) dispatch({ t: "hydrate", state: JSON.parse(raw) as State }); } catch {}
    setHydrated(true);
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try { if (demo || s.sample) localStorage.setItem(key, JSON.stringify(s)); else localStorage.removeItem(key); } catch {}
  }, [s, demo, key, hydrated]);
  const value = useMemo(() => ({ s, dispatch: dispatch as React.Dispatch<Action>, demo, viewerName }), [s, demo, viewerName]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore() { const c = useContext(Ctx); if (!c) throw new Error("no store"); return c; }

/* ---------- derived helpers ---------- */
const estCache = new WeakMap<Application, Estimate>();
export function est(app: Application) { let e = estCache.get(app); if (!e) { e = evaluate(app); estCache.set(app, e); } return e; }

export interface CapRow { source: CapitalSource; reserved: number; committed: number; deployed: number; unfunded: number; available: number }
export function capitalSummary(deals: Deal[], sources: CapitalSource[]): CapRow[] {
  return sources.map((src) => {
    let reserved = 0, committed = 0, deployed = src.baseDeployed, unfunded = src.baseUnfunded;
    for (const d of deals) {
      for (const al of d.allocations) {
        if (al.sourceId !== src.id) continue;
        const e = est(d.app); const share = e.noteAmount ? al.amount / e.noteAmount : 0;
        if (d.capitalStatus === "reserved") reserved += al.amount;
        else if (d.capitalStatus === "committed") committed += al.amount;
        else if (d.capitalStatus === "funded") {
          const drawn = d.disbursedDraws ?? 0;
          deployed += share * (e.initialAdvance + drawn);
          unfunded += share * (e.holdback - drawn + e.financedReserve);
        }
      }
    }
    const available = capitalAvailable({ commitment: src.commitment, reserved, committed, deployed, unfunded, lineUndrawn: src.lineUndrawn });
    return { source: src, reserved, committed, deployed, unfunded, available };
  });
}
export const inHouseAvailable = (deals: Deal[], sources: CapitalSource[], excludeDealId?: string) =>
  capitalSummary(deals.map((d) => (d.id === excludeDealId ? { ...d, allocations: [] } : d)), sources).find((r) => r.source.id === "gt-main")?.available ?? 0;
