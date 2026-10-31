"use client";
import { useState } from "react";
import type { LoanMessage } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Section, shortDate } from "@/components/ui";

/** One conversation per loan, shared by the borrower, their broker and the team. */
export function LoanMessages({ dealId, side, from, title = "Messages", hint = "No messages yet. Questions about this loan go here." }: { dealId: string; side: LoanMessage["side"]; from?: string; title?: string; hint?: string }) {
  const { s, dispatch, viewerName } = useStore();
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
      <form onSubmit={send} className="space-y-2">
        <textarea data-testid={side === "internal" ? "note-text" : "message-text"} aria-label={side === "internal" ? "Write a team note" : "Write a message"} rows={2} className="desk-input h-auto! py-2" placeholder={side === "internal" ? "Write a note for the team" : "Write a message"} value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="btn-primary w-full sm:w-auto" data-testid={side === "internal" ? "send-note" : "send-message"} disabled={!text.trim()}>{side === "internal" ? "Save note" : "Send"}</button>
      </form>
    </Section>
  );
}
