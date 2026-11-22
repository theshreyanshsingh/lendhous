"use client";
import { useState } from "react";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { shortDate } from "@/components/ui";
import { DELAY_PARTIES, MOVABLE, moveLine, moveProblem, movesOf, timesWord, type DelayParty } from "@/lib/closing-moves";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";

/** Every move of the target closing date, newest first, with why and what it waited on. The same list on every side. */
export function ClosingDateHistory({ deal, side = "client" }: { deal: Pick<Deal, "closingMoves">; side?: "team" | "client" }) {
  const moves = movesOf(deal);
  if (!moves.length) return null;
  return (
    <div className="text-sm" data-testid="closing-moves">
      <p className="text-xs text-muted-foreground">The closing date moved {timesWord(moves.length)}:</p>
      <ol className="mt-1 space-y-1">
        {[...moves].reverse().map((move) => (
          <li key={move.id} className="text-xs" data-testid="closing-move"><span className="wrap-anywhere">{moveLine(move)}</span> <span className="text-faint">({shortDate(move.at)}{side === "team" ? `, ${move.by}` : ""})</span></li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Moves the target closing date, with why and who or what it waits on (lib/closing-moves.ts). The borrower, their broker
 * and the title company hear about it and see the same record.
 */
export function MoveClosingDate({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [party, setParty] = useState<DelayParty>("borrower");
  const [reason, setReason] = useState("");
  if (!MOVABLE.includes(deal.status)) return null;
  const problem = today ? moveProblem(deal, to, party, reason, today) : "…";
  const save = async () => {
    if (await dispatch({ t: "moveClosingDate", dealId: deal.id, moveId: `mv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, to, party, reason, by: viewerName })) { setOpen(false); setTo(""); setReason(""); }
  };
  if (!open) return <button type="button" className="text-xs text-link underline" data-testid="move-closing" onClick={() => setOpen(true)}>Move it</button>;
  return (
    <div className="mt-2 space-y-2 rounded-[2px] border border-border p-3 text-sm text-foreground" data-testid="move-closing-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block min-w-0"><span className="label">New target closing</span><input type="date" className="desk-input" data-testid="move-closing-to" min={today || undefined} value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="block min-w-0"><span className="label">Waiting on</span><select className="desk-input" data-testid="move-closing-party" value={party} onChange={(event) => setParty(event.target.value as DelayParty)}>{(Object.keys(DELAY_PARTIES) as DelayParty[]).map((key) => <option key={key} value={key}>{DELAY_PARTIES[key][0].toUpperCase() + DELAY_PARTIES[key].slice(1)}</option>)}</select></label>
      </div>
      <label className="block"><span className="label">Why (the borrower, their broker and the title company see this)</span><input className="desk-input" data-testid="move-closing-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {to && problem && <p className="text-xs text-warn">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`btn-primary ${small}`} data-testid="move-closing-save" disabled={Boolean(problem)} onClick={() => void save()}>Move the date</button>
        <button type="button" className={`btn-ghost ${small}`} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
