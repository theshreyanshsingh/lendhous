"use client";
import { useState } from "react";
import { inBankruptcy } from "@/lib/collections";
import { shortDay } from "@/lib/format";
import type { Deal, LoanModification } from "@/lib/mockData";
import { MODIFICATION, modificationPreview, modificationWords, openModification, proposalProblem, signProblem, type ModificationPreview, type ModificationTerms } from "@/lib/modifications";
import { ledgerOf, noteRateOn, SERVICED, signedModifications } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate, usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";

const statusTone = { proposed: "amber", approved: "blue", declined: "slate", executed: "green" } as const;
const statusText = { proposed: "Waiting for approval", approved: "Approved, to be signed", declined: "Declined", executed: "Signed" } as const;

/** Before and after, side by side: what the modification changes. */
function Changes({ preview }: { preview: ModificationPreview }) {
  const rows: [string, string, string][] = [
    ["Rate", `${preview.fromRate.toFixed(2)}%`, `${preview.toRate.toFixed(2)}%`],
    ["Principal", usd(preview.fromPrincipal, 2), usd(preview.toPrincipal, 2)],
    ["Monthly payment", usd(preview.fromPayment, 2), usd(preview.newPayment, 2)],
    ["Matures", shortDay(preview.fromMaturity), shortDay(preview.toMaturity)],
  ];
  return (
    <table className="w-full text-sm" data-testid="modification-changes">
      <thead><tr className="border-b border-rule text-xs text-muted-foreground"><th className="text-left font-normal">From {shortDay(preview.effectiveOn)}</th><th className="text-right font-normal">Now</th><th className="text-right font-normal">After</th></tr></thead>
      <tbody>{rows.map(([label, from, to]) => <tr key={label} className="border-b border-border last:border-0"><td className="py-1">{label}</td><td className="py-1 text-right tabular-nums">{from}</td><td className={`py-1 text-right tabular-nums ${from !== to ? "font-semibold" : ""}`}>{to}</td></tr>)}</tbody>
    </table>
  );
}

/**
 * Changing a loan's terms in a workout (lib/modifications.ts): a new rate, what's behind added to principal or the late
 * fees waived, more months. Two people approve it, then the borrower signs the agreement and the team records it. The
 * borrower sees the terms once it's approved, and the new ones once it's signed.
 */
export function Modifications({ deal, side }: { deal: Deal; side: "team" | "borrower" }) {
  const today = useServiceDay();
  if (!today || !SERVICED.includes(deal.status)) return null;
  return side === "team" ? <TeamModifications deal={deal} today={today} /> : <BorrowerModifications deal={deal} today={today} />;
}

function TeamModifications({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch, viewerName } = useStore();
  const [proposing, setProposing] = useState(false);
  const [rate, setRate] = useState("");
  const [capitalize, setCapitalize] = useState(false);
  const [waiveFees, setWaiveFees] = useState(false);
  const [months, setMonths] = useState(0);
  const [reason, setReason] = useState("");
  const open = openModification(deal);
  const l = ledgerOf(deal, today);
  const terms: ModificationTerms = { ...(rate.trim() ? { rate: Number(rate) } : {}), capitalize, waiveFees, ...(months ? { months } : {}) };
  const stayed = inBankruptcy(deal);
  const problem = proposalProblem(deal, terms, today, stayed);
  const preview = problem ? null : modificationPreview(deal, terms, today);
  const close = () => { setProposing(false); setRate(""); setCapitalize(false); setWaiveFees(false); setMonths(0); setReason(""); };
  const propose = async () => { if (await dispatch({ t: "proposeModification", dealId: deal.id, ...terms, reason: reason.trim(), by: viewerName })) close(); };
  const past = [...(deal.modifications ?? [])].filter((item) => item !== open).reverse();
  return (
    <Section title="Loan modification" right={signedModifications(deal).length ? <span className="text-xs text-muted-foreground">{signedModifications(deal).length} signed</span> : undefined}>
      <div className="space-y-3 text-sm" data-testid="modifications">
        {open ? <OpenModification deal={deal} modification={open} today={today} /> : !proposing ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 basis-60 text-muted-foreground">{l.amountDue > 0 ? `${usd(l.amountDue, 2)} is behind. A workout can add it to principal, waive the late fees, change the rate or add months.` : "Change the rate, the principal or the maturity in a workout. An extension is for a loan that's current."}</p>
            <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="propose-modification" disabled={stayed} onClick={() => setProposing(true)}>Propose a modification</button>
          </div>
        ) : (
          <div className="space-y-3" data-testid="modification-form">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block"><span className="label">New rate (%)</span><input className="desk-input" inputMode="decimal" data-testid="modification-rate" placeholder={`${noteRateOn(deal).toFixed(2)} now`} value={rate} onChange={(event) => setRate(event.target.value.replace(/[^0-9.]/g, ""))} /></label>
              {deal.app.product !== "dscr" && <label className="block"><span className="label">Months added</span><select className="desk-input" data-testid="modification-months" value={months} onChange={(event) => setMonths(Number(event.target.value))}><option value={0}>None</option>{Array.from({ length: MODIFICATION.maxMonths }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} month{count === 1 ? "" : "s"}</option>)}</select></label>}
            </div>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="modification-capitalize" checked={capitalize} onChange={(event) => setCapitalize(event.target.checked)} /><span>Add the {usd(l.pastDue, 2)} of payments behind{waiveFees ? "" : ` and ${usd(l.feesOwed, 2)} of late fees`} to principal</span></label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="modification-waive" checked={waiveFees} onChange={(event) => setWaiveFees(event.target.checked)} /><span>Waive the {usd(l.feesOwed, 2)} of late fees</span></label>
            <label className="block"><span className="label">Why, and what the borrower agreed to</span><textarea className="desk-input min-h-16" data-testid="modification-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            {preview && <Changes preview={preview} />}
            {preview && preview.stillOwed > 0 && <p className="text-xs text-warn">{usd(preview.stillOwed, 2)} would still be behind once it&apos;s signed.</p>}
            {problem && <p className="text-xs text-warn" data-testid="modification-problem">{problem}</p>}
            <p className="text-xs text-muted-foreground">It needs two approvers, then the borrower and every guarantor sign the modification agreement from the attorney&apos;s template. It takes effect from the 1st of the month it&apos;s signed. Partners&apos; and buyers&apos; rates move with the note&apos;s (PLACEHOLDER until their agreements say otherwise).</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" data-testid="save-modification" disabled={Boolean(problem) || !reason.trim()} onClick={() => void propose()}>Propose it</button>
              <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        )}
        {stayed && !open && <p className="text-xs text-muted-foreground">The borrower is in bankruptcy: a change to the loan goes through the court.</p>}
        {past.length > 0 && <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground" data-testid="modification-history">{past.map((item) => <li key={item.id} data-testid="modification-row">{item.executed ? `Signed ${shortDay(item.executed.on)} (${item.executed.reference}), from ${shortDay(item.executed.effectiveOn)}: ${modificationWords(item.executed)}` : `Proposed ${shortDate(item.proposedAt)}: ${statusText[item.status]}${item.declined?.reason ? `, ${item.declined.reason}` : ""}`}</li>)}</ul>}
      </div>
    </Section>
  );
}

function OpenModification({ deal, modification, today }: { deal: Deal; modification: LoanModification; today: string }) {
  const { dispatch, viewerName } = useStore();
  const [on, setOn] = useState("");
  const [reference, setReference] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const day = on || today;
  const preview = modificationPreview(deal, modification, day);
  const refused = signProblem(deal, modification, day, today, inBankruptcy(deal));
  const mine = modification.approvers.includes(viewerName);
  return (
    <div className="space-y-3" data-testid="open-modification">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1">Proposed by {modification.proposedBy || "the team"} on {shortDate(modification.proposedAt)}: {modification.reason}</p>
        <Badge tone={statusTone[modification.status]}>{statusText[modification.status]}</Badge>
      </div>
      <Changes preview={preview} />
      {modification.status === "proposed" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="modification-approvers">{modification.approvers.length ? `Approved by ${modification.approvers.join(", ")}; ${2 - modification.approvers.length} more needed` : "Two approvers needed"}</span>
          <button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="approve-modification" disabled={mine} onClick={() => void dispatch({ t: "approveModification", dealId: deal.id, modificationId: modification.id, by: viewerName })}>{mine ? "You approved it" : "Approve"}</button>
        </div>
      )}
      {modification.status === "approved" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="label">Signed on</span><input type="date" className="desk-input" data-testid="modification-signed-on" max={today} value={day} onChange={(event) => setOn(event.target.value)} /></label>
          <label className="block min-w-0 flex-1 basis-40"><span className="label">Signed agreement (reference)</span><input className="desk-input" data-testid="modification-reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <button type="button" className="btn-primary" data-testid="sign-modification" disabled={Boolean(refused) || !reference.trim()} onClick={() => void dispatch({ t: "signModification", dealId: deal.id, modificationId: modification.id, on: day, reference: reference.trim(), by: viewerName })}>Record it signed</button>
        </div>
      )}
      {modification.status === "approved" && refused && <p className="text-xs text-warn" data-testid="sign-blocked">{refused}</p>}
      {!declining ? <button type="button" className="text-xs text-link underline underline-offset-2" data-testid="decline-modification" onClick={() => setDeclining(true)}>Decline it</button> : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-48"><span className="label">Why</span><input className="desk-input" data-testid="modification-decline-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="confirm-decline-modification" disabled={!reason.trim()} onClick={async () => { if (await dispatch({ t: "declineModification", dealId: deal.id, modificationId: modification.id, reason: reason.trim(), by: viewerName })) setDeclining(false); }}>Decline</button>
          <button type="button" className="btn-ghost h-10! px-3! text-xs!" onClick={() => setDeclining(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/** The borrower's view: the terms to sign once they're approved, and what changed once it's signed. */
function BorrowerModifications({ deal, today }: { deal: Deal; today: string }) {
  const open = openModification(deal);
  const signed = signedModifications(deal);
  if (!open && !signed.length) return null;
  return (
    <Section title="Loan modification">
      <div className="space-y-3 text-sm" data-testid="borrower-modification">
        {open?.status === "approved" && (
          <>
            <p>We&apos;ve agreed new terms for your loan. Your LendHous team will send you the modification agreement to sign; they take effect from the 1st of the month you sign it.</p>
            <Changes preview={modificationPreview(deal, open, today)} />
          </>
        )}
        {signed.map((item) => <p key={item.id} className="text-muted-foreground" data-testid="borrower-modification-row">Modified {shortDay(item.executed.on)}, from {shortDay(item.executed.effectiveOn)}: {modificationWords(item.executed)}.</p>)}
      </div>
    </Section>
  );
}
