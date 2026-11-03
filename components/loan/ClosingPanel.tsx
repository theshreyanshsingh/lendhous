"use client";
import { useState } from "react";
import { activeWire, maskAccount, missingClosingItems, PHONE_SOURCES, verifyProblem, WIRE_SOURCES, wireProblem } from "@/lib/closing";
import { PRE_FUNDING } from "@/lib/loan-exits";
import type { ClosingAgent, Deal, WireInstruction } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate, statusLabel } from "@/components/ui";

const blankAgent: ClosingAgent = { company: "", contact: "", phone: "", email: "", fileNumber: "" };
const blankWire = { bankName: "", routing: "", account: "", confirmAccount: "", beneficiary: "", reference: "", source: "" };
const newId = () => `wire${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The staff Closing tab (Spec A13): who's closing it, the title company's checklist, and the wire instructions funding goes to. */
export function ClosingPanel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const open = PRE_FUNDING.includes(deal.status);
  const [editingAgent, setEditingAgent] = useState(false);
  const [agent, setAgent] = useState<ClosingAgent>(deal.closing ?? blankAgent);
  const wire = activeWire(deal);
  const closingDocs = deal.docs.filter((doc) => doc.category === "Closing");
  const missing = missingClosingItems(deal);
  const saveAgent = async () => { if (await dispatch({ t: "saveClosing", dealId: deal.id, closing: agent })) setEditingAgent(false); };
  const field = (key: keyof ClosingAgent, label: string, type = "text") => (
    <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" type={type} data-testid={`agent-${key}`} maxLength={160} value={agent[key]} onChange={(event) => setAgent({ ...agent, [key]: event.target.value })} /></label>
  );
  return (
    <div className="space-y-4" data-testid="closing-panel">
      <Section title="Closing agent" right={open && deal.closing && !editingAgent ? <button type="button" className="text-xs text-link underline" onClick={() => setEditingAgent(true)}>Change</button> : undefined}>
        {deal.closing && !editingAgent ? (
          <div className="text-sm" data-testid="closing-agent">
            <p className="font-medium">{deal.closing.company}</p>
            <p className="text-muted-foreground">{[deal.closing.contact, deal.closing.phone, deal.closing.email].filter(Boolean).join(" · ")}{deal.closing.fileNumber ? ` · file ${deal.closing.fileNumber}` : ""}</p>
          </div>
        ) : open ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">{field("company", "Title company or closing attorney")}{field("contact", "Closer")}{field("phone", "Phone", "tel")}{field("email", "Email", "email")}{field("fileNumber", "Their file number")}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" data-testid="save-agent" disabled={!agent.company.trim()} onClick={saveAgent}>Save</button>
              {deal.closing && <button type="button" className="btn-ghost" onClick={() => { setAgent(deal.closing!); setEditingAgent(false); }}>Cancel</button>}
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground">No closing agent was recorded.</p>}
      </Section>

      <Section title="Closing checklist">
        {closingDocs.length ? (
          <ul className="divide-y divide-border text-sm" data-testid="closing-checklist">
            {closingDocs.map((doc) => <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{doc.name}</span><Badge tone={doc.status === "accepted" || doc.status === "waived" ? "green" : doc.status === "rejected" ? "rose" : "amber"}>{statusLabel(doc.status)}</Badge></li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nothing on the checklist yet.</p>}
        {open && missing.length > 0 && <button type="button" className="btn-ghost mt-2 h-9! px-3! text-xs!" data-testid="add-closing-checklist" onClick={() => dispatch({ t: "addClosingChecklist", dealId: deal.id })}>Add the title company&apos;s checklist ({missing.length})</button>}
        <p className="mt-2 text-xs text-muted-foreground">Upload and accept these on the Documents tab. The loan can&apos;t clear to close while any is open.</p>
      </Section>

      <Section title="Wire instructions" right={wire ? wire.verification ? <Badge tone="green">Verified by call-back</Badge> : <Badge tone="rose">Not verified</Badge> : undefined}>
        <Wires deal={deal} wire={wire} open={open} viewerName={viewerName} />
      </Section>
    </div>
  );
}

function Wires({ deal, wire, open, viewerName }: { deal: Deal; wire?: WireInstruction; open: boolean; viewerName: string }) {
  const { dispatch } = useStore();
  const [entering, setEntering] = useState(!wire);
  const [draft, setDraft] = useState(blankWire);
  const [shown, setShown] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneSource, setPhoneSource] = useState("");
  const [spokeWith, setSpokeWith] = useState("");
  const [readBack, setReadBack] = useState(false);
  const input = { ...draft, routing: draft.routing.replace(/\s/g, ""), account: draft.account.replace(/\s/g, "") };
  const refused = draft.routing || draft.account || draft.bankName ? wireProblem(input) ?? (input.account !== draft.confirmAccount.replace(/\s/g, "") ? "The two account numbers don't match." : null) : null;
  const verifyRefused = wire ? verifyProblem(wire, viewerName, phone, phoneSource, spokeWith) : null;
  const old = (deal.wires ?? []).filter((item) => item.replaced).reverse();
  const save = async () => {
    if (await dispatch({ t: "enterWire", dealId: deal.id, wireId: newId(), bankName: input.bankName, routing: input.routing, account: input.account, beneficiary: input.beneficiary, reference: input.reference, source: input.source, by: viewerName })) { setEntering(false); setDraft(blankWire); }
  };
  const text = (key: keyof typeof blankWire, label: string, extra: { mode?: "numeric"; placeholder?: string } = {}) => (
    <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" data-testid={`wire-${key}`} inputMode={extra.mode} autoComplete="off" placeholder={extra.placeholder} maxLength={160} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>
  );
  return (
    <div className="space-y-3 text-sm">
      {wire && (
        <div className="space-y-1" data-testid="active-wire">
          <p><b className="font-medium">{wire.beneficiary}</b> at {wire.bankName}</p>
          <p className="text-muted-foreground">Routing {wire.routing} · account <span data-testid="wire-account">{shown ? wire.account : maskAccount(wire.account)}</span> <button type="button" className="text-xs text-link underline" onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>{wire.reference ? ` · reference ${wire.reference}` : ""}</p>
          <p className="text-xs text-muted-foreground">Entered by {wire.enteredBy} on {shortDate(wire.enteredAt)}, from: {wire.source.toLowerCase()}.</p>
          {wire.verification ? (
            <p className="text-xs text-good" data-testid="wire-verified">Verified by {wire.verification.by} on {shortDate(wire.verification.at)}: called {wire.verification.phone} ({wire.verification.phoneSource.toLowerCase()}) and spoke to {wire.verification.spokeWith}.</p>
          ) : open && (
            <div className="mt-2 space-y-3 rounded-[2px] border border-border p-3" data-testid="verify-wire-form">
              <p className="text-xs text-muted-foreground">Call the closing agent at a number you found yourself, not one on the instructions or in an email, and have them read the routing and account numbers back to you.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block min-w-0"><span className="label">Number you called</span><input className="desk-input" type="tel" data-testid="verify-phone" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                <label className="block min-w-0"><span className="label">Where the number came from</span><select className="desk-input" data-testid="verify-phone-source" value={phoneSource} onChange={(event) => setPhoneSource(event.target.value)}><option value="">Choose one</option>{PHONE_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label className="block min-w-0"><span className="label">Who you spoke to</span><input className="desk-input" data-testid="verify-spoke-with" value={spokeWith} onChange={(event) => setSpokeWith(event.target.value)} /></label>
              </div>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="verify-read-back" checked={readBack} onChange={(event) => setReadBack(event.target.checked)} />They read back routing {wire.routing} and account ending {wire.account.slice(-4)}, and both match.</label>
              {verifyRefused && (phone || phoneSource || spokeWith || wire.enteredBy === viewerName) && <p className="text-xs text-warn" data-testid="verify-blocked">{verifyRefused}</p>}
              <button type="button" className="btn-primary" data-testid="confirm-verify-wire" disabled={Boolean(verifyRefused) || !readBack} onClick={() => dispatch({ t: "verifyWire", dealId: deal.id, wireId: wire.id, phone, phoneSource, spokeWith, by: viewerName })}>Mark verified</button>
            </div>
          )}
        </div>
      )}
      {open && (entering ? (
        <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="wire-form">
          {wire && <p className="text-xs text-bad">New instructions replace these, clear any funding approvals, and need a new call-back. Changed instructions are the most common sign of wire fraud: confirm the change by phone before you enter it.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {text("bankName", "Bank")}{text("beneficiary", "Account name (beneficiary)")}
            {text("routing", "Routing number", { mode: "numeric" })}{text("reference", "Reference or file number")}
            {text("account", "Account number", { mode: "numeric" })}{text("confirmAccount", "Account number again", { mode: "numeric" })}
            <label className="block min-w-0"><span className="label">How they arrived</span><select className="desk-input" data-testid="wire-source" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}><option value="">Choose one</option>{WIRE_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <p className="text-xs text-muted-foreground">Never take instructions from an email, even one that looks like it&apos;s from the title company.</p>
          {refused && <p className="text-xs text-warn" data-testid="wire-blocked">{refused}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-testid="save-wire" disabled={Boolean(refused) || !input.routing || !input.account || !input.source} onClick={save}>Save instructions</button>
            {wire && <button type="button" className="btn-ghost" onClick={() => setEntering(false)}>Cancel</button>}
          </div>
        </div>
      ) : <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="change-wire" onClick={() => setEntering(true)}>Enter new instructions</button>)}
      {!wire && !open && <p className="text-muted-foreground">No wire instructions were recorded.</p>}
      {old.length > 0 && <ul className="space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground" data-testid="old-wires">{old.map((item) => <li key={item.id}>Replaced {shortDate(item.replaced!.at)} by {item.replaced!.by}: {item.bankName}, account {maskAccount(item.account)}{item.verification ? " (had been verified)" : ""}</li>)}</ul>}
    </div>
  );
}
