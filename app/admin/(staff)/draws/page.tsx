"use client";
import Link from "next/link";
import { useState } from "react";
import { DRAW_STATUS, drawTotal } from "@/components/loan/DrawPanel";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, shortDate, usd } from "@/components/ui";
import { approvalError, approversNeeded, reviewDraw } from "@/lib/draws";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { useStore } from "@/lib/store";

export default function Draws() {
  const { s } = useStore();
  const open = s.draws.filter((draw) => draw.status !== "funded" && draw.status !== "rejected");
  const closed = s.draws.filter((draw) => draw.status === "funded" || draw.status === "rejected");
  const dealOf = (draw: DrawRequest) => s.deals.find((deal) => deal.id === draw.dealId)!;
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Servicing" title="Draws" lede="Requests from borrowers against their budgets. Order the inspection, record what was finished, approve, then release the funds." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4"><Stat label="Waiting" value={open.length} /></div>
        <div className="glass p-4"><Stat label="Requested" value={k(open.reduce((sum, draw) => sum + drawTotal(draw), 0))} /></div>
        <div className="glass p-4"><Stat label="Inspections open" value={s.draws.filter((draw) => draw.status === "inspecting").length} /></div>
        <div className="glass p-4"><Stat label="Released" value={k(s.draws.filter((draw) => draw.status === "funded").reduce((sum, draw) => sum + (draw.approved ?? 0), 0))} /></div>
      </div>
      {open.length === 0 && <div className="glass p-6 text-sm text-muted-foreground">No draws waiting.</div>}
      {open.map((draw) => <DrawCard key={draw.id} draw={draw} deal={dealOf(draw)} />)}
      {closed.length > 0 && (
        <Section title={`Finished (${closed.length})`}>
          <ul className="divide-y divide-border">
            {closed.map((draw) => <li key={draw.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="closed-draw"><span className="min-w-0">{dealOf(draw).loanNumber} · {draw.status === "funded" ? usd(draw.approved ?? 0) : usd(drawTotal(draw))}{draw.reason ? ` · ${draw.reason}` : ""}</span><Badge tone={DRAW_STATUS[draw.status].tone}>{DRAW_STATUS[draw.status].label}</Badge></li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function DrawCard({ draw, deal }: { draw: DrawRequest; deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [observed, setObserved] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const review = reviewDraw(deal, draw);
  const needed = approversNeeded(deal, review.approved);
  const refusal = draw.status === "inspected" ? approvalError(deal, draw, viewerName) : null;
  return (
    <section className="glass min-w-0 p-4 sm:p-5" data-testid="draw-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {deal.borrowerName}</span><div className="text-xs text-muted-foreground">{deal.address}, {deal.city} · requested {shortDate(draw.requestedAt)}</div></div>
        <Badge tone={DRAW_STATUS[draw.status].tone}>{DRAW_STATUS[draw.status].label}</Badge>
      </div>
      {deal.contractorIsGtAffiliate && <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">Affiliated contractor: this needs an independent inspector and two approvers.</p>}
      {deal.paymentsLate ? <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">This loan has {deal.paymentsLate} payments past due. Nothing can be released until it&apos;s current.</p> : null}
      {draw.note && <p className="mt-2 text-sm">{draw.note}</p>}
      <p className="mt-1 text-xs text-muted-foreground">Inspection contact: {draw.contact || "none given"}{draw.photos.length && !draw.photoIds?.length ? ` · ${draw.photos.length} photo${draw.photos.length > 1 ? "s" : ""}: ${draw.photos.join(", ")}` : ""}</p>
      {draw.photoIds?.length ? <ul className="mt-1 flex flex-wrap gap-x-3 text-xs" data-testid="draw-photos">{draw.photoIds.map((id, index) => <li key={id}><a className="text-link underline underline-offset-2" href={`/api/documents/${id}`}>{draw.photos[index] ?? `Photo ${index + 1}`}</a></li>)}</ul> : null}
      <table className="stack-table mt-3 w-full">
        <thead><tr className="border-b border-rule"><th>Budget line</th><th className="text-right">Budget</th><th className="text-right">Released</th><th className="text-right">Requested</th><th className="text-right">Work finished</th><th className="text-right">Supported</th></tr></thead>
        <tbody>
          {draw.lines.map((line, index) => {
            const item = deal.scope?.find((scope) => scope.id === line.scopeId);
            return (
              <tr key={line.scopeId} className="border-b border-border last:border-0">
                <td className="font-medium">{item?.division ?? line.scopeId}</td>
                <td data-label="Budget" className="text-right">{usd(item?.budget ?? 0)}</td>
                <td data-label="Released" className="text-right">{usd(item?.released ?? 0)}</td>
                <td data-label="Requested" className="text-right">{usd(line.requested)}</td>
                <td data-label="Work finished" className="text-right">
                  {draw.status === "inspecting" ? (
                    <input aria-label={`Percent finished for ${item?.division}`} data-testid={`observed-${line.scopeId}`} className="desk-input ml-auto w-24!" type="number" inputMode="numeric" min={0} max={100} placeholder="%" value={observed[line.scopeId] ?? ""} onChange={(event) => setObserved({ ...observed, [line.scopeId]: Number(event.target.value) })} />
                  ) : line.observedPct === undefined ? "—" : `${Math.round(line.observedPct * 100)}%`}
                </td>
                <td data-label="Supported" className="text-right font-medium">{line.observedPct === undefined ? "—" : usd(review.lines[index].approved)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {draw.status === "inspected" && (
        <p className="mt-3 text-sm" data-testid="draw-review"><b>{usd(review.approved)}</b> supported of {usd(drawTotal(draw))} requested, after retainage.{needed > 1 ? ` Needs two approvers${draw.approvers.length ? `; ${draw.approvers[0]} has approved` : ""}.` : ""}{review.blocked ? ` ${review.blocked}.` : ""}</p>
      )}
      {draw.status === "approved" && <p className="mt-3 text-sm" data-testid="draw-approved"><b>{usd(draw.approved ?? 0)}</b> approved by {draw.approvers.join(" and ")}.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {draw.status === "submitted" && <button className="btn-primary" data-testid="send-inspector" onClick={() => dispatch({ t: "sendInspector", drawId: draw.id })}>Order inspection</button>}
        {draw.status === "inspecting" && <button className="btn-primary" data-testid="record-inspection" disabled={draw.lines.some((line) => observed[line.scopeId] === undefined)} onClick={() => dispatch({ t: "recordInspection", drawId: draw.id, observed: Object.fromEntries(Object.entries(observed).map(([id, percent]) => [id, Math.min(100, Math.max(0, percent)) / 100])) })}>Record inspection</button>}
        {draw.status === "inspected" && <button className="btn-primary" data-testid="approve-draw" disabled={Boolean(refusal)} onClick={() => dispatch({ t: "approveDrawRequest", drawId: draw.id, by: viewerName })}>Approve</button>}
        {draw.status === "approved" && <button className="btn-primary" data-testid="release-draw" onClick={() => dispatch({ t: "releaseDraw", drawId: draw.id })}>Release funds</button>}
        {draw.status !== "approved" && (
          <span className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
            <input aria-label="Reason for not approving" className="desk-input min-w-0 flex-1" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            <button className="btn-ghost" data-testid="reject-draw" disabled={!reason.trim()} onClick={() => dispatch({ t: "rejectDraw", drawId: draw.id, reason: reason.trim() })}>Don&apos;t approve</button>
          </span>
        )}
      </div>
      {refusal && <p className="mt-2 text-xs text-warn" data-testid="draw-refusal">{refusal}</p>}
    </section>
  );
}
