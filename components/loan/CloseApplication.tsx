"use client";
import Link from "next/link";
import { useState } from "react";
import { closureReason, DECLINE_REASONS, isClosedApplication, PRE_FUNDING, reopenTo, WITHDRAW_REASONS } from "@/lib/loan-exits";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { shortDate, statusLabel } from "@/components/ui";

/**
 * Ending an application before it funds: the team declines it or withdraws it on the borrower's word, and the borrower
 * can withdraw their own. Once closed it says why, and the team can reopen it.
 */
export function CloseApplication({ deal, side }: { deal: Deal; side: "team" | "borrower" }) {
  const { dispatch, viewerName } = useStore();
  const team = side === "team";
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"declined" | "withdrawn">(team ? "declined" : "withdrawn");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const reasons = outcome === "declined" ? DECLINE_REASONS : WITHDRAW_REASONS;

  if (deal.closure && isClosedApplication(deal.status)) {
    const { closure } = deal;
    const declined = closure.outcome === "declined";
    return (
      <div className="mt-4 rounded-[2px] border border-border bg-muted/40 p-3 text-sm" data-testid="application-closed">
        <p className="font-medium">{declined ? "Declined" : "Withdrawn"} on {shortDate(closure.at)}</p>
        {team ? (
          <>
            <p className="mt-1 text-muted-foreground">{closureReason(closure)}{closure.by ? `, by ${closure.by}` : ""}, at {statusLabel(closure.from).toLowerCase()}.{closure.note ? ` ${closure.note}` : ""}</p>
            {declined && <p className="mt-1 text-xs text-warn">An adverse action notice may be required. Send the attorney-approved notice with the reasons.</p>}
            <button type="button" className="btn-ghost mt-2 h-9! px-3! text-xs!" data-testid="reopen-application" onClick={() => dispatch({ t: "reopenApplication", dealId: deal.id, by: viewerName })}>Reopen at {statusLabel(reopenTo(closure)).toLowerCase()}</button>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {declined ? "LendHous couldn't offer this loan. Your team will follow up." : `You withdrew this application${closure.reason ? ` (${closureReason(closure).toLowerCase()})` : ""}.`}{" "}
            <Link href="/admin/apply" className="text-link underline underline-offset-2">Start a new application</Link> any time.
          </p>
        )}
      </div>
    );
  }
  if (!PRE_FUNDING.includes(deal.status)) return null;

  const save = async () => {
    if (await dispatch({ t: "closeApplication", dealId: deal.id, outcome, reason, note: note.trim(), by: viewerName, byTeam: team })) setOpen(false);
  };
  if (!open) return <button type="button" className={team ? "btn-ghost h-9! px-3! text-xs!" : "text-sm text-link underline underline-offset-2"} data-testid="close-application" onClick={() => setOpen(true)}>{team ? "Decline or withdraw" : "Withdraw this application"}</button>;
  return (
    <div className="mt-3 w-full space-y-3 rounded-[2px] border border-border p-3" data-testid="close-application-form">
      {team && (
        <div className="flex flex-wrap gap-2">
          {(["declined", "withdrawn"] as const).map((item) => (
            <button key={item} type="button" data-testid={`outcome-${item}`} className={`rounded-[2px] border px-3 py-1.5 text-sm font-semibold ${outcome === item ? "border-primary bg-active" : "border-border"}`} onClick={() => { setOutcome(item); setReason(""); }}>{item === "declined" ? "We're declining it" : "The borrower withdrew"}</button>
          ))}
        </div>
      )}
      <label className="block"><span className="label">Reason</span>
        <select className="desk-input" data-testid="close-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">Choose one</option>
          {Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="block"><span className="label">{team ? "Notes for the file (the team only)" : "Anything you'd like us to know (optional)"}</span><textarea className="desk-input min-h-16" data-testid="close-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {outcome === "declined" && <p className="text-xs text-muted-foreground">The borrower and broker are told it was declined, not why. Send the reasons in the attorney-approved notice.</p>}
      <p className="text-xs text-muted-foreground">Any capital held for it is released and open partner bids are turned down.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" data-testid="confirm-close" disabled={!reason} onClick={save}>{outcome === "declined" ? "Decline the application" : "Withdraw the application"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
