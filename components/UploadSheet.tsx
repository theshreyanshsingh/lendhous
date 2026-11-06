"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { docBadge, splitDocs, uploadLabel } from "@/lib/borrower-docs";
import { isClosedApplication } from "@/lib/loan-exits";
import { useStore } from "@/lib/store";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt";
/** Other screens open the sheet with this event, so it stays one sheet owned by the shell. */
export const OPEN_UPLOAD = "lendhous:upload";

/**
 * A borrower's phone: everything still needed across their open loans in one sheet, each one tap from the camera or
 * their files. What they send stays in the list as sent, so it doesn't just vanish.
 */
export function UploadSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { s, uploadDoc } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<{ dealId: string; docId: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [failed, setFailed] = useState("");
  // A fresh list each time it opens.
  useEffect(() => { if (open) { setSent([]); setFailed(""); } }, [open]);
  const key = (dealId: string, docId: string) => `${dealId}:${docId}`;
  const loans = s.deals
    .filter((deal) => deal.borrowerId === s.borrowerId && !isClosedApplication(deal.status) && deal.status !== "paid_off")
    .map((deal) => {
      const toDo = splitDocs(deal.docs).toDo;
      const done = deal.docs.filter((doc) => sent.includes(key(deal.id, doc.id)) && !toDo.includes(doc));
      return { deal, items: [...toDo, ...done] };
    })
    .filter((loan) => loan.items.length > 0);
  const send = async (file: File) => {
    if (!target) return;
    const id = key(target.dealId, target.docId);
    setBusy(id); setFailed("");
    const ok = await uploadDoc(target.dealId, target.docId, file);
    setBusy(null);
    // A short buzz where the phone allows it (Android), so "sent" is felt as well as seen.
    if (ok) { setSent((now) => [...now, id]); navigator.vibrate?.(12); }
    else setFailed("That file didn't go through. Check your connection and try again.");
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[14px] px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="upload-sheet">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule" aria-hidden="true" />
        <SheetTitle className="font-heading text-xl font-normal">Send a document</SheetTitle>
        <p className="mt-1 text-sm text-muted-foreground">Tap one to take a photo or choose a file.</p>
        <input ref={input} type="file" className="hidden" accept={ACCEPT} data-testid="upload-sheet-input" onChange={(event) => { const file = event.target.files?.[0]; if (file) void send(file); event.target.value = ""; }} />
        {failed && <p className="mt-3 rounded-[2px] bg-bad/10 p-2 text-sm text-bad" role="alert">{failed}</p>}
        {loans.length === 0 ? (
          <p className="mt-4 rounded-[2px] bg-good/10 p-3 text-sm text-good" data-testid="upload-sheet-empty">Nothing to send right now: everything we asked for is in.</p>
        ) : loans.map(({ deal, items }) => (
          <section key={deal.id} className="mt-4">
            <h3 className="mb-1.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground"><span className="min-w-0 truncate">{deal.loanNumber} · {deal.address}</span><Link href={`/admin/borrower/${deal.id}#documents`} className="shrink-0 text-link underline underline-offset-2" onClick={() => onOpenChange(false)}>Open loan</Link></h3>
            <ul className="divide-y divide-border rounded-[2px] border border-border">
              {items.map((doc) => {
                const id = key(deal.id, doc.id);
                const done = sent.includes(id) && doc.status !== "requested" && doc.status !== "rejected";
                const badge = docBadge(doc);
                return (
                  <li key={doc.id} data-testid="upload-item">
                    <button type="button" disabled={Boolean(busy) || done} onClick={() => { setTarget({ dealId: deal.id, docId: doc.id }); input.current?.click(); }}
                      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-hover disabled:cursor-default" aria-label={done ? `${doc.name}: sent` : `${uploadLabel(doc)}: ${doc.name}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{doc.name}</span>
                        {doc.status === "rejected" && doc.teamNote && <span className="block text-xs text-bad">Still needed: {doc.teamNote}</span>}
                      </span>
                      {busy === id ? <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Sending</span>
                        : done ? <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-good" data-testid="upload-sent"><Check className="size-4" aria-hidden="true" />Sent</span>
                        : <Badge tone={badge.tone}>{badge.label}</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}
