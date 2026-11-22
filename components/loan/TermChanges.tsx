"use client";
import { useState } from "react";
import type { Application } from "@/lib/engine";
import type { Deal, TermChange } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate } from "@/components/ui";
import { openTermChange, termLines, termValue, type TermLine } from "@/lib/term-changes";

const small = "h-9! px-3! text-xs!";
const STATUS: Record<TermChange["status"], { label: string; tone: "amber" | "green" | "rose" | "slate" }> = {
  proposed: { label: "Waiting for the borrower", tone: "amber" }, agreed: { label: "Agreed", tone: "green" },
  declined: { label: "Turned down", tone: "rose" }, withdrawn: { label: "Withdrawn", tone: "slate" },
};

/** Each line that moves, from what was accepted to what's asked. */
function Lines({ lines }: { lines: TermLine[] }) {
  return (
    <dl className="divide-y divide-border rounded-[2px] border border-border text-sm" data-testid="term-change-lines">
      {lines.map((line) => (
        <div key={line.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
          <dt className="min-w-0 text-muted-foreground">{line.label}</dt>
          <dd className="tabular-nums"><span className="text-muted-foreground line-through decoration-1">{termValue(line.key, line.before)}</span> <span aria-hidden="true">→</span><span className="sr-only">to</span> <b className="font-semibold">{termValue(line.key, line.after)}</b></dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * On a loan whose borrower accepted its terms, numbers that move those terms can't just be saved: they go to the borrower
 * with a reason, and change only once they agree (lib/term-changes.ts).
 */
export function TermChangeForm({ deal, changes, onSent }: { deal: Deal; changes: Partial<Application>; onSent: () => void }) {
  const { dispatch, viewerName } = useStore();
  const [reason, setReason] = useState("");
  const lines = termLines(deal.app, changes);
  const waiting = openTermChange(deal);
  if (!lines.length) return null;
  const send = async () => {
    if (await dispatch({ t: "proposeTermChange", dealId: deal.id, changeId: `tc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, changes, reason, by: viewerName })) { setReason(""); onSent(); }
  };
  return (
    <div className="mt-4 space-y-3 rounded-[2px] border border-warn/40 bg-warn/5 p-3 text-sm" data-testid="term-change-form">
      <p className="font-medium">The borrower accepted this loan&apos;s terms, and these numbers change them.</p>
      <Lines lines={lines} />
      {waiting ? <p className="text-xs text-warn">A change is already waiting for the borrower. Withdraw it first to send this one.</p> : (
        <>
          <label className="block"><span className="label">Why the terms need to change (the borrower and their broker see this)</span><textarea className="desk-input h-auto! py-2" rows={2} maxLength={1000} data-testid="term-change-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Nothing changes until the borrower agrees. If they say no, the loan stays on the terms they accepted.</p>
          <button type="button" className={`btn-primary ${small}`} data-testid="term-change-send" disabled={!reason.trim()} onClick={() => void send()}>Send to the borrower to agree</button>
        </>
      )}
    </div>
  );
}

/** The changes asked for after acceptance: the one waiting, and what was agreed or turned down. */
export function TermChanges({ deal, side }: { deal: Deal; side: "team" | "borrower" | "broker" }) {
  const { dispatch, viewerName } = useStore();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const changes = deal.termChanges ?? [];
  if (!changes.length) return null;
  const open = openTermChange(deal);
  const answer = async (agree: boolean) => {
    if (!open) return;
    if (await dispatch({ t: "answerTermChange", dealId: deal.id, changeId: open.id, agree, signedName: name, note, by: viewerName })) { setName(""); setNote(""); setDeclining(false); }
  };
  const past = changes.filter((item) => item !== open).reverse();
  return (
    <Section title={side === "borrower" ? "Changes to your terms" : "Changes to the accepted terms"}>
      <div className="space-y-4 text-sm" data-testid="term-changes">
        {open && (
          <div className="space-y-3" data-testid="term-change-open">
            <p className={side === "borrower" ? "font-medium" : ""}>{side === "borrower" ? "LendHous asks to change the terms you accepted." : side === "broker" ? "LendHous asked your client to agree to a change to their terms." : `Sent to the borrower on ${shortDate(open.at)} by ${open.by}.`}</p>
            <p><span className="text-muted-foreground">Why: </span>{open.reason}</p>
            <Lines lines={open.lines} />
            {side === "borrower" && (
              <>
                <p className="text-xs text-muted-foreground">Nothing changes unless you agree. If you don&apos;t, your loan stays on the terms you accepted, and your loan officer will talk it through with you.</p>
                {!declining ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-0 flex-1 basis-56"><span className="label">Type your full name to agree</span><input className="desk-input" data-testid="term-change-name" maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
                    <button type="button" className={`btn-primary ${small}`} data-testid="term-change-agree" disabled={!name.trim()} onClick={() => void answer(true)}>I agree</button>
                    <button type="button" className={`btn-ghost ${small}`} data-testid="term-change-decline" onClick={() => setDeclining(true)}>I don&apos;t agree</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-0 flex-1 basis-56"><span className="label">Anything you&apos;d like your loan officer to know (optional)</span><input className="desk-input" data-testid="term-change-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
                    <button type="button" className={`btn-primary ${small}`} data-testid="term-change-decline-confirm" onClick={() => void answer(false)}>Keep my accepted terms</button>
                    <button type="button" className={`btn-ghost ${small}`} onClick={() => setDeclining(false)}>Back</button>
                  </div>
                )}
              </>
            )}
            {side === "team" && <button type="button" className={`btn-ghost ${small}`} data-testid="term-change-withdraw" onClick={() => void dispatch({ t: "withdrawTermChange", dealId: deal.id, changeId: open.id, by: viewerName })}>Withdraw it</button>}
          </div>
        )}
        {past.length > 0 && (
          <ul className="divide-y divide-border" data-testid="term-change-history">
            {past.map((change) => (
              <li key={change.id} className="space-y-1 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0">{change.lines.map((line) => line.label).join(", ")}</span><Badge tone={STATUS[change.status].tone}>{STATUS[change.status].label}</Badge></div>
                <p className="text-xs text-muted-foreground">Asked {shortDate(change.at)}: {change.reason}</p>
                {change.answer && change.status !== "withdrawn" && <p className="text-xs text-muted-foreground">{change.status === "agreed" ? `Agreed by ${change.answer.signedName}` : "Turned down"} on {shortDate(change.answer.at)}{change.answer.note ? `: ${change.answer.note}` : ""}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
