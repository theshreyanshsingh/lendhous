"use client";
import { useState } from "react";
import { executeError, extensionChecks, extensionFee, extensionRequestError, extensionsUsed, extensionTermsOf, maturityAfter, openExtension } from "@/lib/loan-exits";
import type { Deal, LoanExtension, PaymentMethod } from "@/lib/mockData";
import { ledgerOf, maturityOf, METHODS } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate, usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";

const statusTone = { requested: "amber", approved: "blue", declined: "slate", executed: "green" } as const;
const statusText = { requested: "Waiting for approval", approved: "Approved, not signed", declined: "Declined", executed: "Signed" } as const;

/** Asking for more time (Spec 8.4). Two people approve it; it takes effect once the agreement is signed and the fee is in. */
export function Extensions({ deal, side }: { deal: Deal; side: "team" | "borrower" }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const team = side === "team";
  const { maxCount, monthsEach } = extensionTermsOf(deal);
  const MONTHS = Array.from({ length: monthsEach }, (_, index) => index + 1);
  const [months, setMonths] = useState(monthsEach);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  if (!today) return null;
  const open = openExtension(deal);
  const used = extensionsUsed(deal);
  const refused = extensionRequestError(deal, months, today, team);
  const fee = extensionFee(deal, months);
  const history = [...(deal.extensions ?? [])].filter((item) => item !== open).reverse();
  const ask = async () => {
    if (await dispatch({ t: "requestExtension", dealId: deal.id, months, reason: reason.trim(), by: viewerName, byTeam: team })) { setAsking(false); setReason(""); }
  };
  const form = (
    <div className="space-y-3" data-testid="extension-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">More time</span><select className="desk-input" data-testid="extension-months" value={months} onChange={(event) => setMonths(Number(event.target.value))}>{MONTHS.map((item) => <option key={item} value={item}>{item} month{item === 1 ? "" : "s"}</option>)}</select></label>
        <div className="text-sm"><span className="label">Fee</span><p className="pt-2 font-semibold" data-testid="extension-fee">{usd(fee, 2)}</p></div>
      </div>
      <label className="block"><span className="label">{team ? "Why, and the borrower's exit plan" : "Why you need it, and your plan to pay off (sale, refinance)"}</span><textarea className="desk-input min-h-16" data-testid="extension-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">It needs two approvals. It takes effect once {team ? "the borrower and every guarantor sign" : "you and every guarantor sign"} the extension agreement and the fee is paid. The loan would then mature on {maturityOf({ ...deal, extensions: [...(deal.extensions ?? []), { id: "x", months, status: "executed" } as LoanExtension] })}.</p>
      {refused && <p className="text-xs text-warn" data-testid="extension-blocked">{refused}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" data-testid="request-extension" disabled={Boolean(refused) || !reason.trim()} onClick={ask}>Ask for {months} more month{months === 1 ? "" : "s"}</button>
        {team && <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>Cancel</button>}
      </div>
    </div>
  );
  return (
    <Section title="Extension" right={<span className="text-xs text-muted-foreground" data-testid="extensions-used">{used} of {maxCount} used · matures {maturityOf(deal)}</span>}>
      {open ? (team ? <OpenExtension deal={deal} extension={open} today={today} /> : <BorrowerOpen deal={deal} extension={open} />)
        : team ? (asking ? form : <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="file-extension" disabled={used >= maxCount} onClick={() => setAsking(true)}>{used >= maxCount ? `Extended ${maxCount} times already` : "File an extension request"}</button>)
        : refused ? <p className="text-sm text-muted-foreground" data-testid="extension-not-yet">{refused}</p>
        : form}
      {history.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground" data-testid="extension-history">
          {history.map((item) => <li key={item.id}>{item.months} month{item.months === 1 ? "" : "s"}, asked {shortDate(item.requestedAt)}: {item.status === "executed" ? `signed ${item.executed!.on}, ${usd(item.fee, 2)} fee received` : item.status === "declined" ? `declined${item.declined?.reason ? `: ${item.declined.reason}` : ""}` : statusText[item.status]}</li>)}
        </ul>
      )}
    </Section>
  );
}

function BorrowerOpen({ deal, extension }: { deal: Deal; extension: LoanExtension }) {
  return (
    <div className="space-y-1 text-sm" data-testid="extension-open">
      <p className="flex flex-wrap items-center gap-2"><Badge tone={statusTone[extension.status]}>{statusText[extension.status]}</Badge>{extension.months} more month{extension.months === 1 ? "" : "s"}, asked {shortDate(extension.requestedAt)}</p>
      <p className="text-muted-foreground">{extension.status === "approved" ? `Approved. Sign the extension agreement and pay the ${usd(extension.fee, 2)} fee, and your loan will mature on ${maturityAfter(deal, extension)}. Your servicing team will send them.` : `The fee would be ${usd(extension.fee, 2)}. We'll tell you when it's decided.`}</p>
    </div>
  );
}

/** The team's view of an open request: what to check, the two approvals, and recording the signing. */
function OpenExtension({ deal, extension, today }: { deal: Deal; extension: LoanExtension; today: string }) {
  const { dispatch, viewerName } = useStore();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [on, setOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("wire");
  const [reference, setReference] = useState("");
  const [signed, setSigned] = useState(false);
  const after = maturityAfter(deal, extension);
  const l = ledgerOf(deal, today);
  const blocked = executeError(deal, extension, on, today);
  const mine = extension.approvers.includes(viewerName);
  return (
    <div className="space-y-3 text-sm" data-testid="extension-open">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0"><b>{extension.months} more month{extension.months === 1 ? "" : "s"}</b>: {extension.fromMaturity} to {after}. Fee {usd(extension.fee, 2)}.</p>
        <Badge tone={statusTone[extension.status]}>{statusText[extension.status]}</Badge>
      </div>
      <p className="text-muted-foreground">Asked by {extension.requestedBy} on {shortDate(extension.requestedAt)}: {extension.reason}</p>
      <ul className="space-y-0.5 text-xs" data-testid="extension-checks">
        {extensionChecks(deal, today).map((check) => <li key={check.label} className={check.ok ? "text-good" : "text-warn"}>{check.ok ? "✓" : "•"} {check.label}</li>)}
        {l.matured && <li className="text-warn">• Past maturity: the default interest since {l.maturity} stops counting once this is signed</li>}
      </ul>
      {extension.status === "requested" ? (
        <>
          <p className="text-xs text-muted-foreground" data-testid="extension-approvers">{extension.approvers.length ? `Approved by ${extension.approvers.join(" and ")} (${extension.approvers.length} of 2).` : "Needs two approvers."}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="approve-extension" disabled={mine} onClick={() => dispatch({ t: "approveExtension", dealId: deal.id, extensionId: extension.id, by: viewerName })}>{mine ? "You approved it" : "Approve"}</button>
            {!declining && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="decline-extension" onClick={() => setDeclining(true)}>Decline</button>}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="execute-extension-form">
          <p className="text-xs text-muted-foreground">Approved by {extension.approvers.join(" and ")}. Record it once the agreement is signed and the fee has arrived.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="label">Signed and paid on</span><input className="desk-input" data-testid="extension-signed-on" type="date" max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
            <label className="block"><span className="label">Fee paid by</span><select className="desk-input" data-testid="extension-fee-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="block"><span className="label">Reference (optional)</span><input className="desk-input" data-testid="extension-fee-reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="extension-signed" checked={signed} onChange={(event) => setSigned(event.target.checked)} />The borrower and every guarantor signed the extension agreement, and the {usd(extension.fee, 2)} fee is in.</label>
          {blocked && <p className="text-xs text-warn" data-testid="execute-blocked">{blocked}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-testid="execute-extension" disabled={!signed || Boolean(blocked)} onClick={() => dispatch({ t: "executeExtension", dealId: deal.id, extensionId: extension.id, on, method, reference, by: viewerName })}>Extend to {after}</button>
            {!declining && <button type="button" className="btn-ghost" data-testid="decline-extension" onClick={() => setDeclining(true)}>Decline</button>}
          </div>
        </div>
      )}
      {declining && (
        <span className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-48"><span className="label">Why it&apos;s declined (the borrower sees this)</span><input className="desk-input" data-testid="extension-decline-reason" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="confirm-decline-extension" disabled={!reason.trim()} onClick={async () => { if (await dispatch({ t: "declineExtension", dealId: deal.id, extensionId: extension.id, reason: reason.trim(), by: viewerName })) setDeclining(false); }}>Decline it</button>
          <button type="button" className="btn-ghost h-10! px-3! text-xs!" onClick={() => setDeclining(false)}>Cancel</button>
        </span>
      )}
    </div>
  );
}
