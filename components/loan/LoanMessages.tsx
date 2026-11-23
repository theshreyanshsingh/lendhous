"use client";
import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import type { LoanMessage } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Reveal } from "@/components/motion";
import { Section, shortDate } from "@/components/ui";
import { useNow } from "@/components/use-now";
import { awaitingReply, replyLine } from "@/lib/replies";
import { clockOf } from "@/lib/sla";
import { BLANKS, fillReply, replyProblem } from "@/lib/staff-tools";

const small = "h-9! px-3! text-xs!";
const FILE_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt";

/** The team's saved replies (lib/staff-tools.ts): pick one to write it out for this loan, save what's typed, or tidy the list. */
function SavedReplies({ dealId, text, onPick }: { dealId: string; text: string; onPick: (filled: string) => void }) {
  const { s, dispatch, viewerName } = useStore();
  const replies = s.savedReplies ?? [];
  const deal = s.deals.find((item) => item.id === dealId);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const [title, setTitle] = useState("");
  if (!deal) return null;
  const draft = { replyId: `reply${Date.now().toString(36)}`, title, text };
  const refused = replyProblem(replies, draft);
  return (
    <div className="space-y-2" data-testid="saved-replies">
      <div className="flex flex-wrap items-center gap-2">
        {replies.length > 0 && (
          <select className="desk-input w-auto! max-w-full text-xs!" aria-label="Insert a saved reply" data-testid="saved-reply" value="" onChange={(event) => { const reply = replies.find((item) => item.id === event.target.value); if (reply) onPick(fillReply(reply.text, deal, viewerName)); }}>
            <option value="">Insert a saved reply…</option>
            {replies.map((reply) => <option key={reply.id} value={reply.id}>{reply.title}</option>)}
          </select>
        )}
        {text.trim() && !saving && <button type="button" className="min-h-9 text-xs text-link underline underline-offset-2" data-testid="save-as-reply" onClick={() => { setSaving(true); setTitle(""); }}>Save this as a reply</button>}
        {replies.length > 0 && <button type="button" className="min-h-9 text-xs text-link underline underline-offset-2" aria-expanded={managing} data-testid="manage-replies" onClick={() => setManaging(!managing)}>{managing ? "Done" : "Saved replies"}</button>}
      </div>
      <Reveal open={saving}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-48"><span className="label">Name it</span><input className="desk-input" data-testid="reply-title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <button type="button" className={`btn-primary ${small}`} data-testid="save-reply" disabled={Boolean(refused)} onClick={async () => { if (await dispatch({ t: "saveReply", ...draft, by: viewerName })) setSaving(false); }}>Save the reply</button>
          <button type="button" className={`btn-ghost ${small}`} onClick={() => setSaving(false)}>Cancel</button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Use {BLANKS.join(", ")} and they&apos;re filled in for each loan.{refused && title ? ` ${refused}` : ""}</p>
      </Reveal>
      <Reveal open={managing}>
        <ul className="divide-y divide-border rounded-[2px] border border-border text-xs" data-testid="reply-list">
          {replies.map((reply) => (
            <li key={reply.id} className="flex items-start justify-between gap-2 p-2">
              <span className="min-w-0"><b className="font-medium">{reply.title}</b><span className="line-clamp-2 block text-muted-foreground">{reply.text}</span><span className="text-faint">Saved by {reply.by}</span></span>
              <button type="button" className="min-h-9 shrink-0 text-link underline underline-offset-2" data-testid="delete-reply" onClick={() => void dispatch({ t: "deleteReply", replyId: reply.id })}>Delete</button>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

/** One conversation per loan, shared by the borrower, their broker and the team. Anyone on it can send a file with a message. */
export function LoanMessages({ dealId, side, from, title = "Messages", hint = "No messages yet. Questions about this loan go here." }: { dealId: string; side: LoanMessage["side"]; from?: string; title?: string; hint?: string }) {
  const { s, dispatch, sendFileMessage, viewerName, targets } = useStore();
  const now = useNow();
  // A borrower or broker waiting on an answer sees when it's promised; the team sees how long it's been (lib/replies.ts).
  const handledAt = s.deals.find((deal) => deal.id === dealId)?.replyHandled?.at;
  const waiting = side === "internal" ? null : awaitingReply(s.messages, dealId, handledAt);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Team notes are their own thread, and only staff ever receive them.
  const messages = s.messages.filter((message) => message.dealId === dealId && (side === "internal") === (message.side === "internal"));
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() && !file) return;
    setBusy(true);
    const sent = file ? await sendFileMessage(dealId, side, text, file) : await dispatch({ t: "sendMessage", dealId, from: from ?? viewerName, side, text });
    setBusy(false);
    if (sent) { setText(""); setFile(null); if (picker.current) picker.current.value = ""; }
  };
  return (
    <Section title={title}>
      {messages.length === 0 && <p className="mb-3 text-sm text-muted-foreground">{hint}</p>}
      <ul className="mb-3 space-y-2" data-testid={side === "internal" ? "team-notes" : "loan-messages"}>
        {messages.map((message) => (
          <li key={message.id} className={`max-w-[90%] rounded-[2px] border border-border p-3 text-sm ${message.side === side ? "ml-auto bg-active" : "bg-card"}`} data-testid="loan-message">
            <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span className="min-w-0 font-medium">{message.from}</span><span>{shortDate(message.at)}</span></div>
            {message.text && <p className="wrap-anywhere whitespace-pre-wrap">{message.text}</p>}
            {message.files?.length ? (
              <ul className="mt-1.5 space-y-1 text-xs" data-testid="message-files">
                {message.files.map((item) => <li key={item.documentId ?? item.name} className="flex min-w-0 items-center gap-1.5"><Paperclip size={12} className="shrink-0" aria-hidden="true" />{item.documentId ? <a className="min-w-0 wrap-anywhere text-link underline underline-offset-2" href={`/api/documents/${item.documentId}`} target="_blank" rel="noreferrer">{item.name}</a> : <span className="min-w-0 wrap-anywhere">{item.name}</span>}</li>)}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {waiting && now && (side === "team"
        ? <p className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${clockOf(waiting.since, now, targets.reply).state === "red" ? "text-bad" : "text-warn"}`} data-testid="reply-waiting"><span>{waiting.from} is waiting for a reply: {clockOf(waiting.since, now, targets.reply).text}.</span><button type="button" className="text-link underline" data-testid="no-reply-needed" onClick={() => void dispatch({ t: "noReplyNeeded", dealId, by: viewerName })}>No reply needed</button></p>
        : <p className="mb-3 text-xs text-muted-foreground" data-testid="reply-by">{replyLine(waiting.since, targets, now)}</p>)}
      <form onSubmit={(event) => void send(event)} className="space-y-2">
        {side === "team" && <SavedReplies dealId={dealId} text={text} onPick={(filled) => setText(text.trim() ? `${text.trimEnd()}\n\n${filled}` : filled)} />}
        <textarea data-testid={side === "internal" ? "note-text" : "message-text"} aria-label={side === "internal" ? "Write a team note" : "Write a message"} rows={side === "team" && text.length > 120 ? 5 : 2} className="desk-input h-auto! py-2" placeholder={side === "internal" ? "Write a note for the team" : "Write a message"} value={text} onChange={(event) => setText(event.target.value)} />
        <input ref={picker} type="file" className="sr-only" tabIndex={-1} accept={FILE_TYPES} data-testid={side === "internal" ? "note-file" : "message-file"} aria-label="Attach a file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary max-sm:flex-1" data-testid={side === "internal" ? "send-note" : "send-message"} disabled={busy || (!text.trim() && !file)}>{busy ? "Sending…" : side === "internal" ? "Save note" : "Send"}</button>
          {file ? (
            <span className="flex min-w-0 items-center gap-1 rounded-[2px] bg-muted px-2 py-1 text-xs" data-testid="attached-file"><Paperclip size={12} className="shrink-0" aria-hidden="true" /><span className="min-w-0 wrap-anywhere">{file.name}</span><button type="button" className="grid size-7 shrink-0 place-items-center text-muted-foreground hover:text-foreground" aria-label={`Remove ${file.name}`} onClick={() => { setFile(null); if (picker.current) picker.current.value = ""; }}><X size={13} aria-hidden="true" /></button></span>
          ) : (
            <button type="button" className="btn-ghost h-10! px-3! text-xs!" data-testid={side === "internal" ? "attach-note-file" : "attach-file"} onClick={() => picker.current?.click()}><Paperclip size={13} aria-hidden="true" /> Attach a file</button>
          )}
        </div>
      </form>
    </Section>
  );
}
