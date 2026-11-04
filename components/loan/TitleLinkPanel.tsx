"use client";
import { useState } from "react";
import { sendTitleLink, turnOffTitleLink } from "@/actions/title-links";
import { Reveal } from "@/components/motion";
import { titleLinkState } from "@/lib/closing";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";

const STATE = { open: ["Open", "green"], expired: ["Expired", "amber"], off: ["Turned off", "slate"], closed: ["Closed", "slate"] } as const;

/**
 * The title company's secure link, from the staff side: send it, see where it stands, turn it off, and what title has
 * confirmed (funds in escrow, the recording). The link itself is shown once when sent; sending again replaces it.
 */
export function TitleLinkPanel({ deal }: { deal: Deal }) {
  const { applyReply, local } = useStore();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState({ name: deal.closing?.contact ?? "", email: deal.closing?.email ?? "" });
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const sent = deal.titleLink;
  const state = titleLinkState(deal);
  const send = async () => {
    setBusy(true); setError("");
    const reply = await sendTitleLink(deal.id, to).catch(() => ({ error: "That didn't go through. Try again." }));
    setBusy(false);
    if ("link" in reply && reply.link) { applyReply(reply); setLink(reply.link); setOpen(false); } else setError(reply.error ?? "That didn't go through.");
  };
  const off = async () => { const reply = await turnOffTitleLink(deal.id); applyReply(reply); setLink(""); };
  const copy = async () => { await navigator.clipboard.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <Section title="Title company's secure link" right={sent ? <Badge tone={STATE[state][1]}>{STATE[state][0]}</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="title-link-panel">
        <p className="text-muted-foreground">The title company uploads the checklist, enters its own escrow wire instructions and confirms funding and recording through one link, so nobody here types their wire numbers. Every wire it enters still needs your call-back.</p>
        {local ? (
          <p className="text-xs text-muted-foreground">Demo loans can&apos;t send real links. <a href="/closing/demo" target="_blank" rel="noreferrer" className="text-link underline" data-testid="title-preview">Preview what the title company sees</a>.</p>
        ) : !deal.closing?.company ? (
          <p className="text-xs text-warn">Save the closing agent above first.</p>
        ) : (
          <>
            {sent && <p className="text-xs text-muted-foreground" data-testid="title-link-sent">Sent to {sent.sentTo} ({sent.email}) by {sent.sentBy} on {shortDate(sent.sentAt)}. {state === "open" ? `Works until ${shortDate(sent.expiresAt)}.` : ""}</p>}
            {link && (
              <div className="space-y-1">
                <p className="text-xs text-good">Emailed to {to.email}. Copy it now if you want to send it another way: it isn&apos;t shown again.</p>
                <div className="flex min-w-0 items-center gap-2"><input readOnly className="desk-input min-w-0 flex-1 font-mono text-xs" data-testid="title-link-url" value={link} onFocus={(event) => event.target.select()} /><button type="button" className="btn-ghost h-10! shrink-0 px-3! text-xs!" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
              </div>
            )}
            {!open && <div className="flex flex-wrap gap-2"><button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="open-title-link" onClick={() => { setTo({ name: deal.closing?.contact ?? "", email: deal.closing?.email ?? "" }); setOpen(true); }}>{sent ? "Send a new link" : "Send the title company a link"}</button>{state === "open" && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="title-link-off" onClick={() => void off()}>Turn it off</button>}</div>}
            <Reveal open={open}>
              <div className="space-y-2 rounded-[2px] border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0"><span className="label">Closer&apos;s name</span><input className="desk-input" data-testid="title-link-name" value={to.name} onChange={(event) => setTo({ ...to, name: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Their email</span><input className="desk-input" type="email" data-testid="title-link-email" value={to.email} onChange={(event) => setTo({ ...to, email: event.target.value })} /></label>
                </div>
                {sent && <p className="text-xs text-muted-foreground">The new link replaces the one sent before, which stops working.</p>}
                {error && <p className="text-xs text-bad" role="alert">{error}</p>}
                <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="send-title-link" disabled={busy || !to.name.trim() || !to.email.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Send it"}</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setOpen(false)}>Cancel</button></div>
              </div>
            </Reveal>
          </>
        )}
        {(deal.closing?.fundsReceived || deal.closing?.recording) && (
          <ul className="space-y-1 border-t border-border pt-2 text-xs" data-testid="title-confirmations">
            {deal.closing.fundsReceived && <li className="text-good">{deal.closing.fundsReceived.by} confirmed {usd(deal.closing.fundsReceived.amount, 2)} reached escrow on {shortDay(deal.closing.fundsReceived.on)}.</li>}
            {deal.closing.recording && <li className="text-good">Mortgage recorded {shortDay(deal.closing.recording.on)} ({deal.closing.recording.reference}), per {deal.closing.recording.by}.</li>}
          </ul>
        )}
      </div>
    </Section>
  );
}
