"use client";
import Link from "next/link";
import { useState } from "react";
import { closureReason, DECLINE_REASONS, isClosedApplication, PRE_FUNDING, reopenTo, WITHDRAW_REASONS } from "@/lib/loan-exits";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Reveal } from "@/components/motion";
import { AdverseActionPanel } from "./AdverseAction";
import { shortDate, statusLabel } from "@/components/ui";

/**
 * Ending an application before it funds: the team declines it or withdraws it on the borrower's word, and the borrower
 * can withdraw their own. Once closed it says why, and the team can reopen it.
 */
export function CloseApplication({ deal, side }: { deal: Deal; side: "team" | "borrower" }) {
  const { dispatch, viewerName, local } = useStore();
  const team = side === "team";
  const [revenue, setRevenue] = useState(deal.revenue ? String(deal.revenue.amount) : "");
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
            {declined && deal.adverseAction && <AdverseActionPanel deal={deal} />}
            <button type="button" className="btn-ghost mt-2 h-9! px-3! text-xs!" data-testid="reopen-application" onClick={() => dispatch({ t: "reopenApplication", dealId: deal.id, by: viewerName })}>Reopen at {statusLabel(reopenTo(closure)).toLowerCase()}</button>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {declined ? (deal.adverseAction?.notice ? <>LendHous couldn&apos;t offer this loan. We sent you a letter about our decision on {deal.adverseAction.notice.sentOn}: <a className="text-link underline" data-testid="my-notice" href={local ? "/api/adverse-action/demo" : `/api/adverse-action/${deal.id}?kind=notice`} target="_blank" rel="noreferrer">open the letter</a>{deal.adverseAction.statement ? <>, and the <a className="text-link underline" href={local ? "/api/adverse-action/demo" : `/api/adverse-action/${deal.id}?kind=statement`} target="_blank" rel="noreferrer">statement of reasons</a></> : null}.</> : "LendHous couldn't offer this loan. A letter explaining our decision will follow.") : `You withdrew this application${closure.reason ? ` (${closureReason(closure).toLowerCase()})` : ""}.`}{" "}
            <Link href="/admin/apply" className="text-link underline underline-offset-2">Start a new application</Link> any time.
          </p>
        )}
      </div>
    );
  }
  if (!PRE_FUNDING.includes(deal.status)) return null;

  const save = async () => {
    const amount = Number(revenue.replace(/[^0-9.]/g, ""));
    // Revenue last year decides which of Reg B's notice rules applies; the year before this one is the last full one.
    const withRevenue = team && outcome === "declined" && revenue.trim() && !(deal.revenue && deal.revenue.amount === amount) ? { revenue: { amount, year: new Date().getFullYear() - 1 } } : {};
    if (await dispatch({ t: "closeApplication", dealId: deal.id, outcome, reason, note: note.trim(), by: viewerName, byTeam: team, ...withRevenue })) setOpen(false);
  };
  return (
    <>
    {!open && <button type="button" className={team ? "btn-ghost h-9! px-3! text-xs!" : "text-sm text-link underline underline-offset-2"} data-testid="close-application" onClick={() => setOpen(true)}>{team ? "Decline or withdraw" : "Withdraw this application"}</button>}
    <Reveal open={open}>
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
      {team && outcome === "declined" && <label className="block"><span className="label">The business&apos;s gross revenue last year ($, optional)</span><input className="desk-input" inputMode="numeric" data-testid="close-revenue" value={revenue} onChange={(event) => setRevenue(event.target.value)} /><span className="mt-1 block text-[11px] text-faint">Over $1 million, Reg B&apos;s notice can come in a reasonable time with the reasons only if they ask. Left blank, the stricter 30-day rule applies.</span></label>}
      {outcome === "declined" && <p className="text-xs text-muted-foreground">The borrower and broker are told it was declined and that a letter will follow. The reasons go in the Reg B notice you send next.</p>}
      <p className="text-xs text-muted-foreground">Any capital held for it is released and open partner bids are turned down.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" data-testid="confirm-close" disabled={!reason} onClick={save}>{outcome === "declined" ? "Decline the application" : "Withdraw the application"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
    </Reveal>
    </>
  );
}
