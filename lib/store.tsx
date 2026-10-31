"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { dispatchBook, refreshBook, uploadLoanFile } from "@/actions/book";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "./book";
import { evaluate, capitalAvailable, type Application, type Estimate } from "./engine";
import type { CapitalSource, Deal } from "./mockData";

// Demo seats share one demo book in the browser, so a bid placed as the partner seat shows up for the staff seats.
const KEY = "lendhous-demo-v3";
// Any other account can load the same book for itself. It stays with that account, in that browser.
const sampleKey = (accountId: string) => `lendhous-sample-v2:${accountId}`;

type Store = {
  s: Book;
  /** Resolves true when the action went through. Real accounts wait for the server; demo and sample data apply at once. */
  dispatch: (action: BookAction) => Promise<boolean>;
  /** Keeps a file with a loan document. Demo and sample data only remember its name. */
  uploadDoc: (dealId: string, docId: string, file: File) => Promise<boolean>;
  /** Stores one draw photo and gives back its id. Demo and sample data keep no file, so they get null. */
  uploadPhoto: (dealId: string, file: File) => Promise<string | null>;
  /** Takes in a reply from a server action that changed the book some other way, like starting a loan. */
  applyReply: (reply: { book?: Book; error?: string }) => void;
  /** Website briefs nobody has answered yet. They live outside the book. */
  newLeads: number;
  /** True when this data is only in the browser: a demo seat, or sample data. */
  local: boolean;
  demo: boolean;
  viewerName: string;
  error: string;
  clearError: () => void;
};

const Ctx = createContext<Store | null>(null);
type Outer = BookAction | { t: "hydrate"; state: Book };
function outer(s: Book, a: Outer): Book { return a.t === "hydrate" ? a.state : reducer(s, a); }

export function StoreProvider({ demo, accountId, viewerName, initialBook, newLeads = 0, children }: { demo: boolean; accountId: string; viewerName: string; initialBook?: Book; newLeads?: number; children: React.ReactNode }) {
  const [s, local] = useReducer(outer, demo, (isDemo: boolean) => (isDemo ? demoBook() : initialBook ?? emptyBook()));
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const isLocal = demo || Boolean(s.sample);
  // Demo seats share the saved demo book. Any other account never sees it, even in the same browser, and keeps only
  // the sample book it loaded for itself.
  const key = demo ? KEY : sampleKey(accountId);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw) local({ t: "hydrate", state: JSON.parse(raw) as Book }); } catch {}
    setHydrated(true);
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try { if (demo || s.sample) localStorage.setItem(key, JSON.stringify(s)); else localStorage.removeItem(key); } catch {}
  }, [s, demo, key, hydrated]);

  const pull = useCallback(async () => {
    const book = await refreshBook().catch(() => null);
    if (book) local({ t: "hydrate", state: book });
  }, []);
  // Real records change under other people's hands, so a page left open catches up.
  useEffect(() => {
    if (isLocal || !hydrated) return;
    const onFocus = () => { void pull(); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 30_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [isLocal, hydrated, pull]);

  const dispatch = useCallback(async (action: BookAction) => {
    if (action.t === "clearSample") { local(action); if (!demo) await pull(); return true; }
    if (isLocal || action.t === "loadSample") { local(action); return true; }
    if (busy.current) return false;
    busy.current = true;
    setError("");
    try {
      const result = await dispatchBook(action);
      if (result.book) local({ t: "hydrate", state: result.book });
      if (result.error) setError(result.error);
      return !result.error;
    } catch {
      setError("That didn't go through. Check your connection and try again.");
      return false;
    } finally {
      busy.current = false;
    }
  }, [isLocal, demo, pull]);

  const send = useCallback(async (form: FormData) => {
    setError("");
    try {
      const result = await uploadLoanFile(form);
      if (result.book) local({ t: "hydrate", state: result.book });
      if (result.error) setError(result.error);
      return result;
    } catch {
      setError("That file didn't upload. Check your connection and try again.");
      return { error: "failed" };
    }
  }, []);

  const uploadDoc = useCallback(async (dealId: string, docId: string, file: File) => {
    if (isLocal) { local({ t: "uploadDoc", dealId, docId, fileName: file.name }); return true; }
    const form = new FormData();
    form.set("dealId", dealId); form.set("docId", docId); form.set("file", file);
    return !(await send(form)).error;
  }, [isLocal, send]);

  const uploadPhoto = useCallback(async (dealId: string, file: File) => {
    if (isLocal) return null;
    const form = new FormData();
    form.set("dealId", dealId); form.set("file", file);
    return (await send(form)).documentId ?? null;
  }, [isLocal, send]);

  const applyReply = useCallback((reply: { book?: Book; error?: string }) => {
    if (reply.book) local({ t: "hydrate", state: reply.book });
    setError(reply.error ?? "");
  }, []);

  const value = useMemo(() => ({ s, dispatch, uploadDoc, uploadPhoto, applyReply, newLeads, local: isLocal, demo, viewerName, error, clearError: () => setError("") }), [s, dispatch, uploadDoc, uploadPhoto, applyReply, newLeads, isLocal, demo, viewerName, error]);
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
