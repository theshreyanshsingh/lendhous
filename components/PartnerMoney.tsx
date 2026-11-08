"use client";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import { useServiceDay } from "@/components/loan/use-service-day";
import { creditOf, ROLLOVER, rolloverOf } from "@/lib/capital-moves";
import { shortDay } from "@/lib/format";
import type { Deal, DrawCall, RolloverChoice } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/**
 * A partner's money moving between loans (lib/capital-moves.ts): what happens to it when a loan pays off, what's rolled
 * over and waiting for its next loan, what each payoff came to, and its share of draws to send in.
 */
export function PartnerMoney({ partnerId }: { partnerId: string }) {
  const { s, dispatch, viewerName } = useStore();
  const me = s.partners.find((partner) => partner.id === partnerId);
  const [choice, setChoice] = useState<RolloverChoice>(rolloverOf(me));
  const [saved, setSaved] = useState(false);
  if (!me) return null;
  const credit = creditOf(s, me.id);
  const proceeds = [...(me.proceeds ?? [])].sort((a, b) => b.on.localeCompare(a.on));
  const calls = s.deals.flatMap((deal) => (deal.drawCalls ?? []).filter((call) => call.partnerId === me.id).map((call) => ({ deal, call })));
  const save = async () => { if (await dispatch({ t: "setRollover", partnerId: me.id, choice, by: viewerName })) setSaved(true); };
  return (
    <>
      {calls.length > 0 && <DrawCalls calls={calls} />}
      <Section title="When a loan pays off">
        <div className="space-y-3 text-sm" data-testid="rollover">
          <fieldset className="space-y-2">
            <legend className="sr-only">What happens to your money when a loan pays off</legend>
            {(Object.keys(ROLLOVER) as RolloverChoice[]).map((key) => (
              <label key={key} className="flex items-start gap-2">
                <input type="radio" name="rollover" className="mt-1" data-testid={`rollover-${key}`} checked={choice === key} onChange={() => { setChoice(key); setSaved(false); }} />
                <span><span className="font-medium">{ROLLOVER[key].label}</span><small className="block text-xs text-muted-foreground">{ROLLOVER[key].detail}</small></span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" data-testid="save-rollover" disabled={choice === rolloverOf(me)} onClick={() => void save()}>Save</button>
            {saved && choice === rolloverOf(me) && <span className="text-xs text-good" role="status" data-testid="rollover-saved">Saved. It applies to every loan you hold that pays off from now on.</span>}
          </div>
          <p className="text-muted-foreground" data-testid="rollover-credit">{credit > 0 ? <>Rolled over and waiting for your next loan: <b className="text-foreground">{usd(credit, 2)}</b>. It goes toward your share of the next deal you win, so you wire less.</> : "Nothing rolled over is waiting for a loan."}</p>
          {proceeds.length > 0 && (
            <ul className="divide-y divide-border border-t border-border" data-testid="proceeds">
              {proceeds.map((item) => (
                <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2" data-testid="proceeds-row">
                  <span className="min-w-0">{item.loanNumber} paid off {shortDay(item.on)}<small className="block text-xs text-muted-foreground">{usd(item.principal, 2)} principal and {usd(item.interest, 2)} interest{item.rolled ? ` · ${usd(item.rolled, 2)} rolled over` : ""}</small></span>
                  {item.toSend > 0 ? (item.sent ? <Badge tone="green">{usd(item.toSend, 2)} sent {shortDay(item.sent.on)}</Badge> : <Badge tone="blue">{usd(item.toSend, 2)} on its way</Badge>) : <Badge tone="violet">All rolled over</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </>
  );
}

/** The partner's share of each released draw: how much, by when, where to send it, and saying it's sent. */
function DrawCalls({ calls }: { calls: { deal: Deal; call: DrawCall }[] }) {
  const { dispatch, viewerName, paymentInstructions } = useStore();
  const today = useServiceDay();
  const [sent, setSent] = useState<Record<string, { on: string; reference: string }>>({});
  const open = calls.filter(({ call }) => !call.received);
  return (
    <Section title="Your share of draws" right={open.length ? <Badge tone="amber">{open.length} to send</Badge> : <Badge tone="green">All in</Badge>}>
      <div className="space-y-3 text-sm" data-testid="draw-calls">
        <p className="text-muted-foreground">LendHous paid these draws to the borrower; your share comes to LendHous&apos;s own account.</p>
        {open.some(({ call }) => !call.sent) && (paymentInstructions
          ? <><pre className="rounded-[2px] border border-border p-3 font-sans text-sm whitespace-pre-wrap" data-testid="draw-call-send-to">{paymentInstructions}</pre><p className="rounded-md bg-bad/10 p-2 text-xs text-bad">Before you first send money, call LendHous on a number you already have to confirm these. LendHous never changes them by email.</p></>
          : <p className="text-xs text-muted-foreground" data-testid="draw-call-send-to">Call LendHous for where to send it, on a number you already have.</p>)}
        <ul className="divide-y divide-border">
          {calls.map(({ deal, call }) => {
            const draft = sent[call.id] ?? { on: "", reference: "" };
            return (
              <li key={call.id} className="py-2" data-testid="draw-call">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="min-w-0">{deal.loanNumber} · draw released {shortDay(call.calledOn)}</span><b className="tabular-nums">{usd(call.amount, 2)}</b></div>
                <p className={`text-xs ${!call.sent && !call.received && today && call.dueOn < today ? "text-bad" : "text-muted-foreground"}`}>{call.received ? `LendHous confirmed it arrived ${shortDay(call.received.on)}.` : call.sent ? `You sent it ${shortDay(call.sent.on)}${call.sent.reference ? ` (${call.sent.reference})` : ""}. LendHous will confirm it.` : `Due by ${shortDay(call.dueOn)}.`}</p>
                {!call.sent && !call.received && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block"><span className="label">Sent on</span><input type="date" className="desk-input w-auto!" data-testid="draw-call-on" max={today} value={draft.on || today} onChange={(event) => setSent({ ...sent, [call.id]: { ...draft, on: event.target.value } })} /></label>
                    <label className="block min-w-0 flex-1 basis-40"><span className="label">Wire reference (optional)</span><input className="desk-input" data-testid="draw-call-reference" maxLength={80} value={draft.reference} onChange={(event) => setSent({ ...sent, [call.id]: { ...draft, reference: event.target.value } })} /></label>
                    <button type="button" className="btn-primary" data-testid="draw-call-sent" onClick={() => void dispatch({ t: "drawCallSent", dealId: deal.id, callId: call.id, on: draft.on || today, reference: draft.reference, by: viewerName })}>We sent it</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
