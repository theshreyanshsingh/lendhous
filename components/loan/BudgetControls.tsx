"use client";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { arvCheck, budgetBalance, changeOrderProblem, isContingency, openOverruns, projectHealth, reserveOf } from "@/lib/budget";
import { shortDay } from "@/lib/format";
import type { ChangeOrder, Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const pct = (value: number) => `${Math.round(value * 100)}%`;
const amountOf = (text: string) => Math.round((Number(text.replace(/[^0-9.]/g, "")) || 0) * 100) / 100;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** One change order: what moves where, why, and where it stands. The team decides it here. */
function ChangeOrderRow({ deal, order, team }: { deal: Deal; order: ChangeOrder; team: boolean }) {
  const { dispatch, viewerName } = useStore();
  const [note, setNote] = useState("");
  const line = (id: string) => deal.scope?.find((item) => item.id === id)?.division ?? "a line no longer on the budget";
  const to = order.to === "new" ? `a new line, ${order.newDivision}` : order.status === "approved" && order.newDivision ? order.newDivision : line(order.to);
  const refusal = order.status === "requested" ? changeOrderProblem(deal, order) : null;
  const check = order.arv ? arvCheck(deal, order.arv) : null;
  return (
    <li className="space-y-2 py-3 text-sm" data-testid="change-order">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 basis-60"><b>{usd(order.amount)}</b> from {line(order.from)} to {to}<span className="block text-xs text-muted-foreground">{order.reason} · asked {shortDay(order.at.slice(0, 10))} by {order.byTeam ? `${order.by} (team)` : order.by}{order.arv ? ` · new ARV ${usd(order.arv)}${check ? ` (${pct(check.ratio)} of it lent)` : ""}` : ""}</span></p>
        <Badge tone={order.status === "approved" ? "green" : order.status === "declined" ? "rose" : "amber"}>{order.status === "requested" ? "Waiting for the team" : order.status === "approved" ? "Approved" : "Declined"}</Badge>
      </div>
      {order.decided?.note && <p className="text-xs text-muted-foreground" data-testid="change-order-note">{order.decided.by}: {order.decided.note}</p>}
      {team && order.status === "requested" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-48"><span className="label">Note to the borrower (needed to decline)</span><input className="desk-input" maxLength={1000} data-testid="change-order-decision-note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className="btn-primary" data-testid="approve-change-order" disabled={Boolean(refusal)} title={refusal ?? undefined} onClick={() => void dispatch({ t: "decideChangeOrder", dealId: deal.id, orderId: order.id, approve: true, note, by: viewerName })}>Approve</button>
          <button type="button" className="btn-ghost" data-testid="decline-change-order" disabled={!note.trim()} onClick={() => void dispatch({ t: "decideChangeOrder", dealId: deal.id, orderId: order.id, approve: false, note, by: viewerName })}>Decline</button>
          {refusal && <p className="w-full text-xs text-warn" data-testid="change-order-refusal">{refusal}</p>}
        </div>
      )}
    </li>
  );
}

/** Asking to move budget between lines: from any line with money left, contingency included, to another or a new one. */
function ChangeOrderForm({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const { dispatch, viewerName } = useStore();
  const scope = deal.scope ?? [];
  const sources = scope.filter((line) => line.budget - line.released > 0);
  const [draft, setDraft] = useState({ from: (sources.find(isContingency) ?? sources[0])?.id ?? "", to: "", newDivision: "", amount: "", reason: "", arv: "" });
  const input = { from: draft.from, to: draft.to, newDivision: draft.newDivision, amount: amountOf(draft.amount), reason: draft.reason, ...(draft.arv.trim() ? { arv: amountOf(draft.arv) } : {}) };
  const problem = draft.to ? changeOrderProblem(deal, input) : "Choose the line the money goes to.";
  const send = async () => {
    if (await dispatch({ t: "requestChangeOrder", dealId: deal.id, orderId: `co${newId()}`, ...input, by: viewerName, byTeam: false })) onDone();
  };
  return (
    <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="change-order-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Move money from</span><select className="desk-input" data-testid="change-from" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })}>{sources.map((line) => <option key={line.id} value={line.id}>{line.division} ({usd(line.budget - line.released)} left)</option>)}</select></label>
        <label className="block"><span className="label">To</span><select className="desk-input" data-testid="change-to" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })}><option value="" disabled>Choose a line</option>{scope.filter((line) => line.id !== draft.from && !isContingency(line)).map((line) => <option key={line.id} value={line.id}>{line.division}</option>)}<option value="new">A new line</option></select></label>
        {draft.to === "new" && <label className="block"><span className="label">The new line</span><input className="desk-input" maxLength={60} data-testid="change-new-line" placeholder="Like Pool resurfacing" value={draft.newDivision} onChange={(event) => setDraft({ ...draft, newDivision: event.target.value })} /></label>}
        <label className="block"><span className="label">Amount</span><input className="desk-input" inputMode="decimal" data-testid="change-amount" placeholder="$0" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
        <label className="block"><span className="label">New after-repair value, if it changes (optional)</span><input className="desk-input" inputMode="decimal" data-testid="change-arv" placeholder="Leave blank if it doesn't" value={draft.arv} onChange={(event) => setDraft({ ...draft, arv: event.target.value })} /></label>
      </div>
      <label className="block"><span className="label">What changed in the work, and why</span><textarea className="desk-input min-h-20" maxLength={1000} data-testid="change-reason" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      {problem && draft.amount && <p className="text-xs text-warn" data-testid="change-problem">{problem}</p>}
      <button type="button" className="btn-primary w-full sm:w-auto" data-testid="send-change-order" disabled={Boolean(problem)} onClick={() => void send()}>Ask for the change</button>
      <p className="text-xs text-muted-foreground">The total budget stays the same: this only moves money between lines. Your team checks it against the work and, if you give one, the new after-repair value.</p>
    </div>
  );
}

/**
 * A funded rehab or construction loan's budget (lib/budget.ts): whether what's left to draw still pays for the work left,
 * the interest reserve, overruns an inspection found, and change orders. The team also sees how far the work has got
 * against the money paid, records overruns and covers them.
 */
export function BudgetControls({ deal, side }: { deal: Deal; side: "client" | "team" }) {
  const { s, dispatch, viewerName } = useStore();
  const team = side === "team";
  const today = serviceDay(s);
  const [asking, setAsking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [overrun, setOverrun] = useState({ amount: "", scopeId: "", note: "" });
  const [cover, setCover] = useState<Record<string, string>>({});
  const balance = budgetBalance(deal);
  const reserve = reserveOf(deal, today);
  const health = team ? projectHealth(deal, s.draws) : null;
  const orders = [...(deal.changeOrders ?? [])].reverse();
  const overruns = deal.overruns ?? [];
  const hasBudget = (deal.scope?.length ?? 0) > 0;
  if (!hasBudget && !reserve) return null;
  return (
    <Section title="Budget and reserve" right={hasBudget ? <Badge tone={balance.inBalance ? "green" : "rose"}>{balance.inBalance ? "In balance" : "Out of balance"}</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="budget-controls">
        {hasBudget && (balance.inBalance
          ? <p data-testid="budget-balance">The {usd(balance.available)} left to draw pays for the {usd(balance.costToComplete)} of work left.</p>
          : <p className="rounded-md bg-bad/10 p-2 text-bad" role="alert" data-testid="budget-balance">Out of balance by {usd(balance.shortfall)}: the work left costs {usd(balance.costToComplete)} and only {usd(balance.available)} is left to draw. {team ? "No draw can be released until the overrun is covered." : "Draws are on hold until you cover the overrun below: pay the contractor the difference yourself, or ask to move money from another line."}</p>)}
        {health && <p className={health.ahead ? "text-warn" : "text-muted-foreground"} data-testid="project-health">Work done about {pct(health.done)} · money out {pct(health.paid)}{health.ahead ? ": the money is running ahead of the work." : "."}</p>}
        {reserve && <p className={reserve.runsShort ? "text-warn" : ""} data-testid="interest-reserve">Interest reserve: {usd(reserve.remaining, 2)} of {usd(reserve.funded, 2)} left, about {reserve.months} month{reserve.months === 1 ? "" : "s"} of interest at {usd(reserve.monthly, 2)}.{reserve.runsShort ? ` It runs out before the loan matures in ${reserve.toMaturity} months: ${team ? "the borrower pays the rest themselves." : "plan to pay the rest yourself."}` : ""}</p>}

        {overruns.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="font-medium">Overruns</p>
            <ul className="mt-1 divide-y divide-border">{overruns.map((item) => (
              <li key={item.id} className="space-y-1 py-2" data-testid="overrun">
                <p><b>{usd(item.amount)}</b>{item.scopeId ? ` on ${deal.scope?.find((line) => line.id === item.scopeId)?.division ?? "a line"}` : ""}: {item.note}<span className="block text-xs text-muted-foreground">Found {shortDay(item.at.slice(0, 10))}{item.covered ? ` · covered ${shortDay(item.covered.at.slice(0, 10))}: ${item.covered.how}` : " · not covered yet"}</span></p>
                {team && !item.covered && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-0 flex-1 basis-48"><span className="label">How it was covered</span><input className="desk-input" maxLength={300} data-testid="overrun-how" placeholder="Borrower paid the contractor directly (receipt on file)" value={cover[item.id] ?? ""} onChange={(event) => setCover({ ...cover, [item.id]: event.target.value })} /></label>
                    <button type="button" className="btn-ghost" data-testid="cover-overrun" disabled={!(cover[item.id] ?? "").trim()} onClick={() => void dispatch({ t: "coverOverrun", dealId: deal.id, overrunId: item.id, how: cover[item.id] ?? "", by: viewerName })}>Mark covered</button>
                  </div>
                )}
              </li>
            ))}</ul>
          </div>
        )}
        {team && hasBudget && (
          <div className="border-t border-border pt-3" data-testid="overrun-form">
            <button type="button" className="text-link underline underline-offset-2 max-sm:py-2.5" aria-expanded={recording} data-testid="overrun-open" onClick={() => setRecording(!recording)}>Record an overrun an inspection found</button>
            {recording && <><div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">How much more</span><input className="desk-input w-32!" inputMode="decimal" data-testid="overrun-amount" value={overrun.amount} onChange={(event) => setOverrun({ ...overrun, amount: event.target.value })} /></label>
              <label className="block"><span className="label">On</span><select className="desk-input w-auto!" data-testid="overrun-line" value={overrun.scopeId} onChange={(event) => setOverrun({ ...overrun, scopeId: event.target.value })}><option value="">The whole project</option>{(deal.scope ?? []).filter((line) => !isContingency(line)).map((line) => <option key={line.id} value={line.id}>{line.division}</option>)}</select></label>
              <label className="block min-w-0 flex-1 basis-48"><span className="label">What the inspection found</span><input className="desk-input" maxLength={1000} data-testid="overrun-note" value={overrun.note} onChange={(event) => setOverrun({ ...overrun, note: event.target.value })} /></label>
              <button type="button" className="btn-primary" data-testid="record-overrun" disabled={!amountOf(overrun.amount) || !overrun.note.trim()} onClick={async () => { if (await dispatch({ t: "recordOverrun", dealId: deal.id, overrunId: `ov${newId()}`, amount: amountOf(overrun.amount), ...(overrun.scopeId ? { scopeId: overrun.scopeId } : {}), note: overrun.note, by: viewerName })) { setOverrun({ amount: "", scopeId: "", note: "" }); setRecording(false); } }}>Record it</button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">The loan is out of balance until it&apos;s covered, which holds every draw. The borrower is told.</p></>}
          </div>
        )}

        {hasBudget && (
          <div className="border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Change orders</p>{!asking && <button type="button" className="btn-ghost h-9! text-xs!" data-testid="new-change-order" onClick={() => setAsking(true)}>{team ? "Move budget for the borrower" : "Ask to move budget"}</button>}</div>
            {asking && <div className="mt-2"><ChangeOrderForm deal={deal} onDone={() => setAsking(false)} /></div>}
            {orders.length ? <ul className="mt-1 divide-y divide-border">{orders.map((order) => <ChangeOrderRow key={order.id} deal={deal} order={order} team={team} />)}</ul> : <p className="mt-1 text-xs text-muted-foreground">{deal.scope?.some(isContingency) ? "Your contingency line is spent by moving it to the line the work is on." : "Move money between lines when the work changes: the total stays the same."}</p>}
          </div>
        )}
      </div>
    </Section>
  );
}
