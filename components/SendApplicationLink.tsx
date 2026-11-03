"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendApplicationLink } from "@/actions/application-links";
import { Reveal } from "@/components/motion";

/**
 * Sends the borrower the secure application link, for a lead or a loan. The link is emailed to them and shown here
 * once to copy; it isn't stored, so a lost one is replaced by sending again (which turns the old one off).
 */
export function SendApplicationLink({ leadId, dealId, name, email, compact }: { leadId?: string; dealId?: string; name: string; email: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState({ name, email });
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const send = async () => {
    setSending(true);
    setError("");
    const reply = await sendApplicationLink({ leadId, dealId, name: to.name, email: to.email }).catch(() => ({ error: "That didn't go through. Try again." }));
    setSending(false);
    if (reply.error || !("url" in reply) || !reply.url) return setError(reply.error ?? "That didn't go through.");
    setUrl(reply.url);
    router.refresh();
  };
  const copy = async () => { await navigator.clipboard.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="min-w-0" data-testid="send-application">
      {!open && <button type="button" className={compact ? "text-xs text-link underline underline-offset-2" : "btn-ghost h-9! px-3! text-xs!"} data-testid="open-application-link" onClick={() => setOpen(true)}>Send application link</button>}
      <Reveal open={open}>
        <div className="mt-2 space-y-2 rounded-[2px] border border-border p-3 text-left text-sm">
          {url ? (
            <>
              <p className="text-xs text-good">Sent to {to.email}. It works for 14 days and saves as they go. Copy it now if you want to text it: it isn&apos;t shown again.</p>
              <div className="flex min-w-0 items-center gap-2"><input readOnly className="desk-input min-w-0 flex-1 font-mono text-xs" data-testid="application-link-url" value={url} onFocus={(event) => event.target.select()} /><button type="button" className="btn-ghost h-10! shrink-0 px-3! text-xs!" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block min-w-0"><span className="label">Borrower&apos;s name</span><input className="desk-input" data-testid="application-link-name" value={to.name} onChange={(event) => setTo({ ...to, name: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Their email</span><input className="desk-input" type="email" data-testid="application-link-email" value={to.email} onChange={(event) => setTo({ ...to, email: event.target.value })} /></label>
              </div>
              <p className="text-xs text-muted-foreground">They get a secure link to a 5-step application, already filled in with what we know. Sending a new one turns off any earlier link.</p>
              {error && <p className="text-xs text-bad" role="alert">{error}</p>}
              <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="send-application-link" disabled={sending || !to.name.trim() || !to.email.trim()} onClick={send}>{sending ? "Sending…" : "Send it"}</button><button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setOpen(false)}>Cancel</button></div>
            </>
          )}
        </div>
      </Reveal>
    </div>
  );
}
