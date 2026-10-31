"use client";
import { useRef, useState } from "react";
import type { Doc } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/** Lets staff or a broker send in a document on the borrower's behalf. */
export function DocUpload({ dealId, doc }: { dealId: string; doc: Doc }) {
  const { uploadDoc } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  if (doc.status !== "requested" && doc.status !== "rejected") return null;
  return (
    <>
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" data-testid={`upload-input-${doc.id}`} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setSending(true);
        await uploadDoc(dealId, doc.id, file);
        setSending(false);
      }} />
      <button type="button" className="btn-ghost py-1 text-xs" data-testid={`upload-${doc.id}`} disabled={sending} onClick={() => input.current?.click()}>{sending ? "Uploading…" : "Upload"}</button>
    </>
  );
}
