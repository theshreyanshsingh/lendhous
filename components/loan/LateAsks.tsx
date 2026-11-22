"use client";
import { useState } from "react";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Section, shortDate } from "@/components/ui";
import { askTitle, LATE_DAYS, pendingAsks } from "@/lib/late-asks";
import { DEMO_TEAM } from "@/lib/mockData";

/**
 * A demo seat that could approve late asks on a real account (the owner and the underwriter). Demo books run in the
 * browser with no permissions, so the screen says it; a real account's server decides from the asker's permission.
 */
export const demoApproves = (email: string) => ["Owner", "Underwriter"].includes(DEMO_TEAM.find((member) => member.email === email)?.title ?? "");

const small = "h-9! px-3! text-xs!";

/**
 * Conditions or documents someone asked for close to closing, waiting for a manager (lib/late-asks.ts). Approving adds it
 * for the borrower with the reason given; turning it down tells whoever asked why.
 */
export function LateAsks({ deal, kind }: { deal: Deal; kind: "condition" | "doc" }) {
  const { dispatch, viewerName } = useStore();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const asks = pendingAsks(deal).filter((ask) => ask.kind === kind);
  if (!asks.length) return null;
  const decide = async (askId: string, approve: boolean) => { if (await dispatch({ t: "decideLateAsk", dealId: deal.id, askId, approve, note, by: viewerName })) { setDeciding(null); setNote(""); } };
  return (
    <Section title={`Asked for late: waiting for a manager (${asks.length})`}>
      <p className="mb-2 text-xs text-muted-foreground">Within {LATE_DAYS} days of closing, or once a loan clears to close, a new ask needs a manager&apos;s yes. The borrower sees nothing until then.</p>
      <ul className="divide-y divide-border text-sm" data-testid="late-asks">
        {asks.map((ask) => (
          <li key={ask.id} className="space-y-1.5 py-2.5" data-testid="late-ask">
            <p className="font-medium">{askTitle(ask)}</p>
            <p className="text-xs text-muted-foreground">Asked by {ask.by} on {shortDate(ask.at)}. Why now: {ask.reason}</p>
            {deciding !== ask.id ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`btn-primary ${small}`} data-testid="late-ask-approve" onClick={() => void decide(ask.id, true)}>Approve and ask the borrower</button>
                <button type="button" className={`btn-ghost ${small}`} data-testid="late-ask-decline" onClick={() => { setDeciding(ask.id); setNote(""); }}>Turn it down</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 flex-1 basis-56"><span className="label">Why not (for {ask.by})</span><input className="desk-input" data-testid="late-ask-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
                <button type="button" className={`btn-primary ${small}`} data-testid="late-ask-decline-confirm" disabled={!note.trim()} onClick={() => void decide(ask.id, false)}>Turn it down</button>
                <button type="button" className={`btn-ghost ${small}`} onClick={() => setDeciding(null)}>Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
