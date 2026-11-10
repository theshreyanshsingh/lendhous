"use client";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { fileBatch } from "@/lib/doc-sorting";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const OTHER = "__other";
type Row = { key: string; file: File; docId: string; name: string; state: "ready" | "sending" | "sent" | "failed" };
const newDocId = () => `own-${Math.random().toString(36).slice(2, 12)}`;
const size = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/**
 * Several documents at once (lib/doc-sorting.ts): drop or pick a batch, see which checklist item each one's name points to,
 * change any, name the ones that don't fit as documents of their own, and send them all. For the borrower and their
 * broker alike.
 */
export function BulkUpload({ deal }: { deal: Deal }) {
  const { uploadDoc, dispatch, viewerName } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    // Filed against what's still open, leaving out items the batch already fills.
    const already = new Set(rows.map((row) => row.docId).filter((id) => id !== OTHER));
    const filings = fileBatch(list.map((file) => file.name), deal.docs.filter((doc) => !already.has(doc.id)));
    setRows((all) => [...all, ...list.map((file, index): Row => ({ key: `${Date.now()}-${index}-${file.name}`, file, docId: filings[index].docId ?? OTHER, name: filings[index].docId ? "" : file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120), state: "ready" }))]);
    setNote("");
  };
  const put = (key: string, change: Partial<Row>) => setRows((all) => all.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const twice = (docId: string) => docId !== OTHER && rows.filter((row) => row.docId === docId && row.state !== "sent").length > 1;
  const ready = rows.filter((row) => row.state !== "sent");
  const problem = ready.some((row) => twice(row.docId)) ? "Two files are going to the same item, and each item holds one file: move one, or send it as its own document." : ready.some((row) => row.docId === OTHER && !row.name.trim()) ? "Name each document that isn't on the list." : null;
  const send = async () => {
    setBusy(true); setNote("");
    let sent = 0;
    for (const row of ready) {
      put(row.key, { state: "sending" });
      let docId = row.docId;
      if (docId === OTHER) {
        docId = newDocId();
        if (!(await dispatch({ t: "addOwnDoc", dealId: deal.id, docId, name: row.name.trim(), by: viewerName }))) { put(row.key, { state: "failed" }); continue; }
      }
      const ok = await uploadDoc(deal.id, docId, row.file);
      put(row.key, { state: ok ? "sent" : "failed" });
      if (ok) sent++;
    }
    setBusy(false);
    setNote(sent ? `${sent} document${sent === 1 ? "" : "s"} sent. The team reviews each one.` : "Nothing went through. Try again.");
    if (sent) setRows((all) => all.filter((row) => row.state !== "sent"));
  };
  return (
    <div className="space-y-3" data-testid="bulk-upload">
      <div
        className={`flex flex-col items-center gap-2 rounded-[2px] border border-dashed p-4 text-center text-sm ${drag ? "border-link bg-active/60" : "border-border"}`}
        onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(event) => { event.preventDefault(); setDrag(false); add(event.dataTransfer.files); }}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden />
        <p><b className="font-medium">Send several at once.</b> Drop them here or pick them, and we&apos;ll file each one by its name: you can change any before they go.</p>
        <button type="button" className="btn-ghost h-10! px-4! text-[13px]!" data-testid="bulk-pick" onClick={() => input.current?.click()}>Choose files</button>
        <input ref={input} type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" className="sr-only" data-testid="bulk-input" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-border text-sm" data-testid="bulk-rows">
          {rows.map((row) => (
            <li key={row.key} className="space-y-1.5 py-2" data-testid="bulk-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{row.file.name} <small className="text-xs font-normal text-muted-foreground">{size(row.file.size)}</small></span>
                <span className="flex items-center gap-2 text-xs">
                  {row.state === "sending" && <Loader2 className="size-4 animate-spin" aria-label="Sending" />}
                  {row.state === "failed" && <span className="text-bad">Didn&apos;t send</span>}
                  {row.state === "ready" && !busy && <button type="button" className="text-link underline underline-offset-2" onClick={() => setRows((all) => all.filter((item) => item.key !== row.key))}>Remove</button>}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="block min-w-0 flex-1 basis-56"><span className="sr-only">Where {row.file.name} goes</span>
                  <select className="desk-input" data-testid="bulk-where" value={row.docId} disabled={busy} onChange={(event) => put(row.key, { docId: event.target.value })}>
                    {deal.docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}{doc.status === "requested" || doc.status === "rejected" ? "" : " (replaces the one sent)"}</option>)}
                    <option value={OTHER}>Something else: name it</option>
                  </select>
                </label>
                {row.docId === OTHER && <label className="block min-w-0 flex-1 basis-48"><span className="sr-only">What {row.file.name} is</span><input className="desk-input" data-testid="bulk-name" maxLength={120} placeholder="What it is" value={row.name} disabled={busy} onChange={(event) => put(row.key, { name: event.target.value })} /></label>}
              </div>
              {twice(row.docId) && <p className="text-xs text-warn">Another file is going to this item too.</p>}
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="text-xs text-warn" data-testid="bulk-problem">{problem}</p>}
      {ready.length > 0 && <button type="button" className="btn-primary h-11! w-full sm:w-auto" data-testid="bulk-send" disabled={busy || Boolean(problem)} onClick={() => void send()}>{busy ? "Sending…" : `Send ${ready.length} document${ready.length === 1 ? "" : "s"}`}</button>}
      {note && <p className="text-xs text-muted-foreground" role="status" data-testid="bulk-note">{note}</p>}
    </div>
  );
}
