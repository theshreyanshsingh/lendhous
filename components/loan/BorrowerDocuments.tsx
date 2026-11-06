"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge, Section } from "@/components/ui";
import { docBadge, OWN_DOC_ID, ownDocProblem, splitDocs, uploadLabel } from "@/lib/borrower-docs";
import type { Deal, Doc } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const newDocId = () => `own-${Math.random().toString(36).slice(2, 12)}`;

/**
 * The borrower's documents for a loan, as two lists: what's still to send (anything sent back first, with what the team
 * still needs) and what's in. Each can be dropped on or tapped to upload; on a phone the picker offers the camera too.
 * Anything the team didn't ask for can be added at the foot. Once the loan has funded (`settled`) and nothing is left to
 * send, the list folds to one line, since it's history by then.
 */
export function BorrowerDocuments({ deal, settled = false }: { deal: Deal; settled?: boolean }) {
  const { uploadDoc, dispatch, viewerName } = useStore();
  const { toDo, submitted } = splitDocs(deal.docs);
  const [tab, setTab] = useState<"todo" | "submitted">(toDo.length ? "todo" : "submitted");
  const [unfolded, setUnfolded] = useState(false);
  // A big file on a phone's connection takes a while: the button says so, and a line says when it's in.
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); }, [notice]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [ownName, setOwnName] = useState("");
  const [ownError, setOwnError] = useState("");
  const ownFile = useRef<HTMLInputElement>(null);
  const upload = async (docId: string, file: File, name = deal.docs.find((x) => x.id === docId)?.name ?? "Your document") => {
    setBusy(docId); setNotice("");
    const ok = await uploadDoc(deal.id, docId, file);
    setBusy(null);
    if (ok) { setNotice(`${name} sent. You'll find it under Submitted.`); navigator.vibrate?.(12); }
    return ok;
  };
  const addOwn = async (file: File | undefined) => {
    const problem = ownDocProblem(ownName) ?? (file ? null : "Choose the file.");
    if (problem) return setOwnError(problem);
    const docId = newDocId();
    if (!OWN_DOC_ID.test(docId) || !(await dispatch({ t: "addOwnDoc", dealId: deal.id, docId, name: ownName.trim(), by: viewerName }))) return setOwnError("That didn't go through. Try again.");
    await upload(docId, file!, ownName.trim());
    setOwnName(""); setOwnError(""); setAdding(false); setTab("submitted");
  };
  const card = (x: Doc) => {
    const badge = docBadge(x);
    return (
      <li key={x.id} id={`doc-${x.id}`} data-testid={`doc-${x.id}`}
        onDragOver={(event) => { event.preventDefault(); setDrag(x.id); }} onDragLeave={() => setDrag(null)}
        onDrop={(event) => { event.preventDefault(); setDrag(null); const file = event.dataTransfer.files?.[0]; if (file) void upload(x.id, file); }}
        className={`rounded-[2px] border border-border p-3 ${drag === x.id ? "bg-active" : "bg-card"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="text-sm font-medium">{x.name}</p>{x.note && x.status !== "accepted" && <p className="text-xs text-muted-foreground">{x.note}</p>}</div>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        {x.status === "rejected" && (
          <div className="mt-2 rounded-[2px] bg-bad/8 p-2 text-xs" data-testid="doc-team-note">
            <p className="font-medium text-bad">Your loan team still needs:</p>
            <p className="mt-0.5 text-foreground">{x.teamNote ?? "A clearer, complete copy of this document."}</p>
          </div>
        )}
        {x.fileName && (x.documentId ? <a href={`/api/documents/${x.documentId}`} className="mt-2 block truncate text-xs text-link underline underline-offset-2" data-testid="doc-file">📎 {x.fileName}</a> : <p className="mt-2 truncate text-xs text-muted-foreground">📎 {x.fileName}</p>)}
        {x.carriedFrom && <p className="mt-1 text-xs text-good" data-testid="doc-carried">On file from your loan {x.carriedFrom}</p>}
        {(x.status === "requested" || x.status === "rejected" || x.status === "uploaded") && <button type="button" disabled={Boolean(busy)} className={`${x.status === "uploaded" ? "btn-ghost" : "btn-primary"} mt-2 h-9! px-3! text-xs! max-sm:h-11! max-sm:w-full max-sm:text-sm!`} onClick={() => { setTarget(x.id); fileRef.current?.click(); }}>{busy === x.id ? <><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Sending…</> : uploadLabel(x)}</button>}
      </li>
    );
  };
  const accepted = deal.docs.filter((x) => x.status === "accepted").length;
  if (settled && !toDo.length && !unfolded) {
    return (
      <div id="documents">
        <Section title="Your documents">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="docs-settled">
            <p>{deal.docs.length ? <><span className="text-good" aria-hidden="true">✓</span> {accepted === deal.docs.length ? `All ${accepted} accepted` : `${accepted} of ${deal.docs.length} accepted, nothing left to send`}</> : "No documents on this loan."}</p>
            {deal.docs.length > 0 && <button type="button" className="min-h-11 text-sm text-link underline underline-offset-2" data-testid="docs-unfold" onClick={() => setUnfolded(true)}>Show them</button>}
          </div>
        </Section>
      </div>
    );
  }
  const tabButton = (key: "todo" | "submitted", label: string, count: number) => (
    <button type="button" role="tab" aria-selected={tab === key} data-testid={`docs-tab-${key}`} onClick={() => setTab(key)} className={`rounded-full px-3 py-1.5 text-xs font-medium max-sm:min-h-10 max-sm:flex-1 max-sm:text-sm ${tab === key ? "bg-primary text-primary-foreground" : "border border-rule text-muted-foreground hover:text-foreground"}`}>{label} ({count})</button>
  );
  return (
    <div id="documents">
      <Section title="Your documents" right={<span className="text-xs text-muted-foreground">{accepted}/{deal.docs.length} accepted</span>}>
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" data-testid="file-input"
          onChange={(event) => { const file = event.target.files?.[0]; if (file && target) void upload(target, file); event.target.value = ""; }} />
        {notice && <p className="mb-3 rounded-[2px] bg-good/10 p-2 text-sm text-good" role="status" data-testid="docs-notice">✓ {notice}</p>}
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Documents">{tabButton("todo", "To do", toDo.length)}{tabButton("submitted", "Submitted", submitted.length)}</div>
        {/* Both lists stay on the page, so a document just sent is still there to find; only the chosen one shows. */}
        <div className={tab === "todo" ? "" : "hidden"} role="tabpanel" data-testid="docs-todo">
          {toDo.length ? <ul className="space-y-2">{toDo.map(card)}</ul> : <p className="rounded-[2px] bg-good/10 p-3 text-sm text-good">Nothing to send right now: everything we asked for is in.</p>}
        </div>
        <div className={tab === "submitted" ? "" : "hidden"} role="tabpanel" data-testid="docs-submitted">
          {submitted.length ? <ul className="space-y-2">{submitted.map(card)}</ul> : <p className="text-sm text-muted-foreground">Nothing sent yet.</p>}
        </div>
        <div className="mt-4 rounded-[2px] border border-dashed border-rule p-3" data-testid="add-own-doc">
          <p className="text-sm font-medium">Have something we didn&apos;t ask for?</p>
          <p className="text-xs text-muted-foreground">Add it here and upload the file; your loan team will review it.</p>
          {adding ? (
            <div className="mt-2 space-y-2">
              <label className="block"><span className="label">What it is</span><input className="desk-input" data-testid="own-doc-name" maxLength={120} placeholder="e.g. Contractor's license" value={ownName} onChange={(event) => setOwnName(event.target.value)} /></label>
              <input ref={ownFile} type="file" className="block w-full text-sm" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" data-testid="own-doc-file" />
              {ownError && <p className="text-xs text-bad" role="alert" data-testid="own-doc-error">{ownError}</p>}
              <div className="flex gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="own-doc-send" onClick={() => void addOwn(ownFile.current?.files?.[0])}>Add and upload</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => { setAdding(false); setOwnError(""); }}>Cancel</button></div>
            </div>
          ) : <button type="button" className="btn-ghost mt-2 h-9! px-3! text-xs!" data-testid="own-doc-add" onClick={() => setAdding(true)}>+ Add a document</button>}
        </div>
        <p className="mt-3 text-xs text-faint">Drag and drop a file onto a document, or tap Upload (on a phone you can take a photo).</p>
      </Section>
    </div>
  );
}
