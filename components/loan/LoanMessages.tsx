"use client";
import { useState } from "react";
import type { LoanMessage } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Section, shortDate } from "@/components/ui";
import { useNow } from "@/components/use-now";
import { awaitingReply, replyLine } from "@/lib/replies";
import { clockOf } from "@/lib/sla";

/** One conversation per loan, shared by the borrower, their broker and the team. */
export function LoanMessages({ dealId, side, from, title = "Messages", hint = "No messages yet. Questions about this loan go here." }: { dealId: string; side: LoanMessage["side"]; from?: string; title?: string; hint?: string }) {
  const { s, dispatch, viewerName, targets } = useStore();
  const now = useNow();
  // A borrower or broker waiting on an answer sees when it's promised; the team sees how long it's been (lib/replies.ts).
  const handledAt = s.deals.find((deal) => deal.id === dealId)?.replyHandled?.at;
  const waiting = side === "internal" ? null : awaitingReply(s.messages, dealId, handledAt);
  const [text, setText] = useState("");
  // Team notes are their own thread, and only staff ever receive them.
  const messages = s.messages.filter((message) => message.dealId === dealId && (side === "internal") === (message.side === "internal"));
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    dispatch({ t: "sendMessage", dealId, from: from ?? viewerName, side, text });
    setText("");
  };
  return (
    <Section title={title}>
      {messages.length === 0 && <p className="mb-3 text-sm text-muted-foreground">{hint}</p>}
      <ul className="mb-3 space-y-2" data-testid={side === "internal" ? "team-notes" : "loan-messages"}>
        {messages.map((message) => (
          <li key={message.id} className={`max-w-[90%] rounded-[2px] border border-border p-3 text-sm ${message.side === side ? "ml-auto bg-active" : "bg-card"}`} data-testid="loan-message">
            <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span className="min-w-0 font-medium">{message.from}</span><span>{shortDate(message.at)}</span></div>
            <p className="wrap-anywhere whitespace-pre-wrap">{message.text}</p>
          </li>
        ))}
      </ul>
      {waiting && now && (side === "team"
        ? <p className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${clockOf(waiting.since, now, targets.reply).state === "red" ? "text-bad" : "text-warn"}`} data-testid="reply-waiting"><span>{waiting.from} is waiting for a reply: {clockOf(waiting.since, now, targets.reply).text}.</span><button type="button" className="text-link underline" data-testid="no-reply-needed" onClick={() => void dispatch({ t: "noReplyNeeded", dealId, by: viewerName })}>No reply needed</button></p>
        : <p className="mb-3 text-xs text-muted-foreground" data-testid="reply-by">{replyLine(waiting.since, targets, now)}</p>)}
      <form onSubmit={send} className="space-y-2">
        <textarea data-testid={side === "internal" ? "note-text" : "message-text"} aria-label={side === "internal" ? "Write a team note" : "Write a message"} rows={2} className="desk-input h-auto! py-2" placeholder={side === "internal" ? "Write a note for the team" : "Write a message"} value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="btn-primary w-full sm:w-auto" data-testid={side === "internal" ? "send-note" : "send-message"} disabled={!text.trim()}>{side === "internal" ? "Save note" : "Send"}</button>
      </form>
    </Section>
  );
}
