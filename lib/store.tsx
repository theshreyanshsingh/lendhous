"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { dispatchBook, refreshBook, uploadLoanFile } from "@/actions/book";
import { demoBook, emptyBook, reducer, type Book, type BookAction } from "./book";
import { adoptPricing, type PricingPayload } from "./pricing-versions";

// Demo seats share one demo book in the browser, so a bid placed as the partner seat shows up for the staff seats.
const KEY = "lendhous-demo-v4";
// Any other account can load the same book for itself. It stays with that account, in that browser.
const sampleKey = (accountId: string) => `lendhous-sample-v3:${accountId}`;

type Store = {
  s: Book;
  /** Resolves true when the action went through. Real accounts wait for the server; demo and sample data apply at once. */
  dispatch: (action: BookAction) => Promise<boolean>;
  /** Keeps a file with a loan document. Demo and sample data only remember its name. */
  uploadDoc: (dealId: string, docId: string, file: File) => Promise<boolean>;
  uploadCondition: (dealId: string, conditionId: string, file: File) => Promise<boolean>;
  uploadLienFile: (dealId: string, drawId: string, party: { key: string; kind: "progress" | "final" } | "affidavit", file: File) => Promise<boolean>;
  uploadPropertyPhoto: (dealId: string, file: File) => Promise<boolean>;
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
  /** Who's signed in, to tell their own loans apart. */
  viewer: { id: string; email: string };
  error: string;
  clearError: () => void;
};

const Ctx = createContext<Store | null>(null);
type Outer = BookAction | { t: "hydrate"; state: Book };
function outer(s: Book, a: Outer): Book {
  if (a.t !== "hydrate") return reducer(s, a);
  // Learn the pricing a book from the server uses before anything on the page prices its loans.
  adoptPricing(a.state.pricing);
  return a.state;
}

export function StoreProvider({ demo, accountId, viewerName, viewerEmail = "", initialBook, pricing, newLeads = 0, children }: { demo: boolean; accountId: string; viewerName: string; viewerEmail?: string; initialBook?: Book; pricing?: PricingPayload; newLeads?: number; children: React.ReactNode }) {
  const [s, local] = useReducer(outer, demo, (isDemo: boolean) => { adoptPricing(pricing); adoptPricing(initialBook?.pricing); return isDemo ? demoBook() : initialBook ?? emptyBook(); });
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

  /** A file for one of a loan's conditions, which marks it sent in. Demo seats keep the name only. */
  const uploadCondition = useCallback(async (dealId: string, conditionId: string, file: File) => {
    if (isLocal) { local({ t: "conditionFile", dealId, conditionId, fileName: file.name, by: viewerName }); return true; }
    const form = new FormData();
    form.set("dealId", dealId); form.set("conditionId", conditionId); form.set("file", file);
    return !(await send(form)).error;
  }, [isLocal, send, viewerName]);

  /** A lien waiver from one party, or the contractor's final affidavit, for a draw. Demo seats keep the name only. */
  const uploadLienFile = useCallback(async (dealId: string, drawId: string, party: { key: string; kind: "progress" | "final" } | "affidavit", file: File) => {
    if (isLocal) { local(party === "affidavit" ? { t: "affidavitReceived", drawId, fileName: file.name, by: viewerName } : { t: "lienWaiverReceived", drawId, partyKey: party.key, kind: party.kind, fileName: file.name, by: viewerName }); return true; }
    const form = new FormData();
    form.set("dealId", dealId); form.set("drawId", drawId); form.set("file", file);
    if (party === "affidavit") form.set("affidavit", "1"); else form.set("waiverParty", party.key);
    return !(await send(form)).error;
  }, [isLocal, send, viewerName]);

  /** A photo of the property, listed on the loan. Demo seats keep the name only. */
  const uploadPropertyPhoto = useCallback(async (dealId: string, file: File) => {
    if (isLocal) { local({ t: "addPropertyPhotos", dealId, photos: [{ id: `demo-photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: file.name, at: new Date().toISOString() }], by: viewerName }); return true; }
    const form = new FormData();
    form.set("dealId", dealId); form.set("propertyPhoto", "1"); form.set("file", file);
    return !(await send(form)).error;
  }, [isLocal, send, viewerName]);

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

  const viewer = useMemo(() => ({ id: accountId, email: viewerEmail }), [accountId, viewerEmail]);
  const value = useMemo(() => ({ s, dispatch, uploadDoc, uploadCondition, uploadLienFile, uploadPropertyPhoto, uploadPhoto, applyReply, newLeads, local: isLocal, demo, viewerName, viewer, error, clearError: () => setError("") }), [s, dispatch, uploadDoc, uploadCondition, uploadLienFile, uploadPropertyPhoto, uploadPhoto, applyReply, newLeads, isLocal, demo, viewerName, viewer, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore() { const c = useContext(Ctx); if (!c) throw new Error("no store"); return c; }

/* ---------- derived helpers ---------- */
// Kept in lib/capital.ts, which the server's reports use too.
export { capitalSummary, est, inHouseAvailable, type CapRow } from "./capital";
