"use client";
import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { evaluate, capitalAvailable, type Application, type Estimate } from "./engine";
import { seedDeals, seedBids, capitalSources, partners as seedPartners, BORROWER_ID, DEMO_PARTNER_ID, type Deal, type Bid, type Partner, type DocStatus, type CapitalSource } from "./mockData";

interface State { partnerId: string; deals: Deal[]; bids: Bid[]; partners: Partner[]; sources: CapitalSource[]; audit: { at: string; text: string }[] }

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
  | { t: "reset" };

const now = () => new Date().toISOString();
// Demo seats share one demo book in the browser, so a bid placed as the partner seat shows up for the staff seats.
const KEY = "lendhous-demo-v1";
/** Fixed, not now(): /admin is prerendered, so a load-time stamp would not match the server HTML (hydration error). */
const SEED_AT = "2026-10-18T09:00:00-07:00";

function demoBook(): State {
  const deals = seedDeals.map((d) => {
    const e = evaluate(d.app);
    return { ...d, allocations: d.allocations.map((a) => ({ ...a, amount: a.amount || e.noteAmount })) };
  });
  return { partnerId: DEMO_PARTNER_ID, deals, bids: seedBids, partners: seedPartners, sources: capitalSources, audit: [{ at: SEED_AT, text: "Demo data loaded (all records are FAKE)" }] };
}

/** What a non-demo account sees until its records come from the database: nothing. */
const emptyBook = (): State => ({ partnerId: "", deals: [], bids: [], partners: [], sources: [], audit: [] });

function reducer(s: State, a: Action): State {
  const log = (text: string) => [{ at: now(), text }, ...s.audit].slice(0, 50);
  const upd = (id: string, f: (d: Deal) => Deal) => s.deals.map((d) => (d.id === id ? f(d) : d));
  switch (a.t) {
    case "reset": return demoBook();
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
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, route: a.route, allocations, capitalStatus })), audit: log(`${deal.loanNumber}: route set to ${a.route}${a.route === "split" ? ` (GT $${inH.toLocaleString()})` : ""}`) };
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
  }
}

const Ctx = createContext<{ s: State; dispatch: React.Dispatch<Action>; demo: boolean; viewerName: string } | null>(null);
type Outer = Action | { t: "hydrate"; state: State };
function outer(s: State, a: Outer): State { return a.t === "hydrate" ? a.state : reducer(s, a); }
export function StoreProvider({ demo, viewerName, children }: { demo: boolean; viewerName: string; children: React.ReactNode }) {
  const [s, dispatch] = useReducer(outer, demo, (isDemo: boolean) => (isDemo ? demoBook() : emptyBook()));
  const [hydrated, setHydrated] = React.useState(false);
  // Only demo seats read or write the saved demo book; any other account never sees it, even in the same browser.
  useEffect(() => {
    if (!demo) return;
    try { const raw = localStorage.getItem(KEY); if (raw) dispatch({ t: "hydrate", state: JSON.parse(raw) as State }); } catch {}
    setHydrated(true);
  }, [demo]);
  useEffect(() => { if (demo && hydrated) try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }, [s, demo, hydrated]);
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
