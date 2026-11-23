"use client";
import { useState } from "react";
import { sendInsuranceLink, turnOffInsuranceLink } from "@/actions/insurance-links";
import { Reveal } from "@/components/motion";
import { Badge, Section, shortDate } from "@/components/ui";
import { INSURED } from "@/lib/insurance";
import { agentLinkState } from "@/lib/insurance-agent";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const STATE = { open: ["Open", "green"], expired: ["Expired", "amber"], off: ["Turned off", "slate"], closed: ["Closed", "slate"] } as const;
const small = "h-9! px-3! text-xs!";

/** Sending the link, where it stands, and turning it off: the same for the team and the borrower. */
function LinkControls({ deal, staff }: { deal: Deal; staff: boolean }) {
  const { applyReply, local } = useStore();
  const named = deal.agents?.insurance;
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState({ name: named?.name ?? "", email: named?.email ?? "" });
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const sent = deal.insuranceLink;
  const state = agentLinkState(deal);
  const send = async () => {
    setBusy(true); setError("");
    const reply = await sendInsuranceLink(deal.id, staff ? to : undefined).catch(() => ({ error: "That didn't go through. Try again." }));
    setBusy(false);
    if ("link" in reply && reply.link) { applyReply(reply); setLink(reply.link); setOpen(false); } else setError(reply.error ?? "That didn't go through.");
  };
  const off = async () => { const reply = await turnOffInsuranceLink(deal.id); applyReply(reply); setLink(""); };
  const copy = async () => { await navigator.clipboard.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  if (local) return <p className="text-xs text-muted-foreground">Demo loans can&apos;t send real links. <a href="/insurance/demo" target="_blank" rel="noreferrer" className="text-link underline" data-testid="insurance-link-preview">Preview what {staff ? "the agent" : "your agent"} sees</a>.</p>;
  return (
    <div className="space-y-2" data-testid="insurance-link">
      {sent && <p className="text-xs text-muted-foreground" data-testid="insurance-link-sent">Sent to {sent.sentTo} ({sent.email}) by {sent.sentBy} on {shortDate(sent.sentAt)}. {state === "open" ? `Works until ${shortDate(sent.expiresAt)}.` : STATE[state][0]}.</p>}
      {link && (
        <div className="space-y-1">
          <p className="text-xs text-good">Emailed to {sent?.email}. Copy it now if you want to send it another way: it isn&apos;t shown again.</p>
          <div className="flex min-w-0 items-center gap-2"><input readOnly className="desk-input min-w-0 flex-1 font-mono text-xs" data-testid="insurance-link-url" value={link} onFocus={(event) => event.target.select()} /><button type="button" className="btn-ghost h-10! shrink-0 px-3! text-xs!" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button></div>
        </div>
      )}
      {staff ? (
        <>
          {!open && <div className="flex flex-wrap gap-2"><button type="button" className={`btn-ghost ${small}`} data-testid="open-insurance-link" onClick={() => { setTo({ name: named?.name ?? "", email: named?.email ?? "" }); setOpen(true); }}>{sent ? "Send a new link" : "Send the insurance agent a link"}</button>{state === "open" && <button type="button" className={`btn-ghost ${small}`} data-testid="insurance-link-off" onClick={() => void off()}>Turn it off</button>}</div>}
          <Reveal open={open}>
            <div className="space-y-2 rounded-[2px] border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block min-w-0"><span className="label">Agent&apos;s name</span><input className="desk-input" data-testid="insurance-link-name" value={to.name} onChange={(event) => setTo({ ...to, name: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Their email</span><input className="desk-input" type="email" data-testid="insurance-link-email" value={to.email} onChange={(event) => setTo({ ...to, email: event.target.value })} /></label>
              </div>
              {sent && <p className="text-xs text-muted-foreground">The new link replaces the one sent before, which stops working.</p>}
              <div className="flex flex-wrap gap-2"><button type="button" className={`btn-primary ${small}`} data-testid="send-insurance-link" disabled={busy || !to.name.trim() || !to.email.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Send it"}</button><button type="button" className={`btn-ghost ${small}`} onClick={() => setOpen(false)}>Cancel</button></div>
            </div>
          </Reveal>
        </>
      ) : named?.email ? (
        <div className="flex flex-wrap gap-2"><button type="button" className={`btn-ghost ${small}`} data-testid="send-insurance-link" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : sent ? `Send ${named.name.split(" ")[0] || "them"} a new link` : `Send ${named.name.split(" ")[0] || "your agent"} a secure link`}</button>{state === "open" && <button type="button" className={`btn-ghost ${small}`} data-testid="insurance-link-off" onClick={() => void off()}>Turn it off</button>}</div>
      ) : (
        <p className="text-xs text-muted-foreground">Add your agent&apos;s email to send them a secure link.</p>
      )}
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The borrower's insurance agent's secure link (lib/insurance-agent.ts), on the team's insurance file: the agent sees the
 * mortgagee clause and what cover the loan needs, and sends each policy with its own checks.
 */
export function InsuranceLinkPanel({ deal }: { deal: Deal }) {
  if (!INSURED.includes(deal.status)) return null;
  const state = agentLinkState(deal);
  return (
    <Section title="Insurance agent's secure link" right={deal.insuranceLink ? <Badge tone={STATE[state][1]}>{STATE[state][0]}</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="insurance-link-panel">
        <p className="text-muted-foreground">The agent sees the exact mortgagee clause and the cover this loan needs, enters what each declarations page says and uploads it. The named insured, the clause, wind, flood, coverage and dates are checked as they type; you still open the file and accept it below.</p>
        <LinkControls deal={deal} staff />
      </div>
    </Section>
  );
}

/** The borrower's side, under their insurance agent: send them the link themselves. */
export function AgentLinkButton({ deal }: { deal: Deal }) {
  if (!INSURED.includes(deal.status) || !deal.agents?.insurance) return null;
  return (
    <div className="mt-2 space-y-1" data-testid="agent-link-card">
      <p className="text-xs text-muted-foreground">A secure page for them shows the mortgagee clause and the cover your loan needs, and checks each policy as they send it.</p>
      <LinkControls deal={deal} staff={false} />
    </div>
  );
}
