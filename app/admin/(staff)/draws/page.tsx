"use client";
import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DRAW_STATUS, drawTotal } from "@/components/loan/DrawPanel";
import { DrawLienChecklist } from "@/components/loan/DrawLienChecklist";
import { PhotoRequests } from "@/components/loan/PhotoRequests";
import { PageIntro } from "@/components/page-intro";
import { Badge, Section, Stat, k, shortDate, usd } from "@/components/ui";
import { approvalError, approversNeeded, freshInspectionNeeded, reviewDraw } from "@/lib/draws";
import { awaitingDecision, claimGap, decideBy } from "@/lib/draw-walk";
import { photosSummary, reusedSummary } from "@/lib/photo-checks";
import { PATH_LABEL, toSend } from "@/lib/draw-review";
import { clockOf, floridaTime } from "@/lib/sla";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { unreleasedHolds } from "@/lib/lien-law";
import { ofacBlocker } from "@/lib/ofac";
import { useStore } from "@/lib/store";
import { useServiceDay } from "@/components/loan/use-service-day";

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
      {open.length === 0 && <EmptyState>No draws waiting.</EmptyState>}
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

const CLOCK_TONE = { ok: "text-muted-foreground", amber: "text-warn", red: "text-bad" } as const;

function DrawCard({ draw, deal }: { draw: DrawRequest; deal: Deal }) {
  const { s, dispatch, viewerName, targets } = useStore();
  // The clock runs on the browser's time, set after the first render so the server's page matches.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const clock = now && awaitingDecision(draw) ? clockOf(draw.requestedAt, now, targets.drawDecision) : null;
  const linePhotos = draw.linePhotos ?? [];
  const checks = photosSummary(linePhotos, deal.geo);
  const fresh = freshInspectionNeeded(deal, draw);
  const [observed, setObserved] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  // A photo review: the team reads each line's progress from the borrower's photos, starting from what they claimed
  // (lib/draw-review.ts), or sends it on to an inspector with a reason the borrower is told.
  const desk = draw.path === "desk" && draw.status === "submitted";
  const reading = draw.status === "inspecting" || desk;
  const [why, setWhy] = useState("");
  const reused = reusedSummary(s, linePhotos);
  const review = reviewDraw(deal, draw);
  const needed = approversNeeded(deal, review.approved);
  const refusal = draw.status === "inspected" ? approvalError(deal, draw, viewerName) : null;
  const today = useServiceDay();
  // No money goes out to people not screened against the sanctions list in the last few days.
  const sanctions = draw.status === "approved" && today ? ofacBlocker(deal, today) : null;
  // Nor before Florida's lien law and the insurance are satisfied, unless an owner released it past them.
  const holds = draw.status === "approved" && today ? unreleasedHolds(deal, draw, today) : [];
  // On a phone a draw is its summary and its buttons; the lines, photos and lien waivers open on a tap. One waiting on
  // the inspection's numbers starts open, since they're typed in its lines.
  const [details, setDetails] = useState(draw.status === "inspecting" || (draw.path === "desk" && draw.status === "submitted"));
  return (
    <section className="glass min-w-0 p-4 sm:p-5" data-testid="draw-card">
      <h2 className="sr-only">{deal.loanNumber} draw</h2>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><Link href={`/admin/deals/${deal.id}`} className="font-medium text-link hover:underline">{deal.loanNumber}</Link> <span className="text-sm">· {deal.borrowerName}</span><div className="text-xs text-muted-foreground">{deal.address}, {deal.city} · requested {shortDate(draw.requestedAt)}</div></div>
        <Badge tone={DRAW_STATUS[draw.status].tone}>{DRAW_STATUS[draw.status].label}</Badge>
      </div>
      {draw.path && <p className="mt-1 text-xs text-muted-foreground" data-testid="draw-path-line">{PATH_LABEL[draw.path]}{draw.fee ? ` · ${usd(draw.fee)} fee, kept from the money released` : ""}{draw.inspection?.method === "desk" ? ` · reviewed from the photos by ${draw.inspection.by}` : ""}{draw.escalated ? ` · sent on to an inspector by ${draw.escalated.by}: ${draw.escalated.reason}` : ""}</p>}
      {clock && <p className={`mt-1 text-xs ${CLOCK_TONE[clock.state]}`} data-testid="draw-clock">Decide by {floridaTime(decideBy(draw, targets.drawDecision))} · {clock.text}</p>}
      {fresh && <p className="mt-2 rounded-md bg-warn/12 p-2 text-xs text-warn" data-testid="storm-hold">{fresh}</p>}
      {deal.contractorIsGtAffiliate && <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">Affiliated contractor: this needs an independent inspector and two approvers.</p>}
      {deal.paymentsLate ? <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">This loan has {deal.paymentsLate} payments past due. Nothing can be released until it&apos;s current.</p> : null}
      {draw.note && <p className="mt-2 text-sm">{draw.note}</p>}
      {draw.contractorSigned
        ? <p className="mt-2 text-xs text-good" data-testid="draw-contractor-signed">Signed off by the contractor, {draw.contractorSigned.name}, on {shortDate(draw.contractorSigned.at)}: the work on these lines is done as their photos show.</p>
        : draw.status !== "funded" && draw.status !== "rejected" && <p className="mt-2 text-xs text-muted-foreground" data-testid="draw-contractor-unsigned">The contractor hasn&apos;t signed off this draw. A photo link for it, sent to them from the loan, asks them to.</p>}
      <p className="mt-2 text-sm sm:hidden" data-testid="draw-summary"><b className="tabular-nums">{usd(drawTotal(draw))}</b> requested across {draw.lines.length} line{draw.lines.length === 1 ? "" : "s"}{holds.length ? ` · ${holds.length} held` : ""}</p>
      <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-between rounded-[2px] border border-border px-3 text-left text-sm sm:hidden" aria-expanded={details} data-testid="draw-details-toggle" onClick={() => setDetails(!details)}>
        <span>{details ? "Hide the lines, photos and lien waivers" : "Lines, photos and lien waivers"}</span><span aria-hidden="true">{details ? "−" : "+"}</span>
      </button>
      <div className={details ? "" : "max-sm:hidden"}>
      <p className="mt-1 text-xs text-muted-foreground">Inspection contact: {draw.contact || "none given"}{draw.photos.length && !draw.photoIds?.length && !linePhotos.length ? ` · ${draw.photos.length} photo${draw.photos.length > 1 ? "s" : ""}: ${draw.photos.join(", ")}` : ""}</p>
      {draw.photoIds?.length && !linePhotos.length ? <ul className="mt-1 flex flex-wrap gap-x-3 text-xs" data-testid="draw-photos">{draw.photoIds.map((id, index) => <li key={id}><a className="text-link underline underline-offset-2" href={`/api/documents/${id}`}>{draw.photos[index] ?? `Photo ${index + 1}`}</a></li>)}</ul> : null}
      {linePhotos.length > 0 && (
        <div className="mt-2 text-xs" data-testid="draw-line-photos">
          {checks && <p className={checks.flagged ? "text-warn" : "text-muted-foreground"} data-testid="draw-photo-checks">The borrower&apos;s photos: {checks.text}</p>}
          {reused && <p className="text-warn" data-testid="draw-photo-reused">{reused}</p>}
          <ul className="mt-1 space-y-0.5" data-testid="draw-photos">
            {draw.lines.filter((line) => linePhotos.some((photo) => photo.scopeId === line.scopeId)).map((line) => (
              <li key={line.scopeId} className="flex flex-wrap gap-x-2"><span className="text-muted-foreground">{deal.scope?.find((item) => item.id === line.scopeId)?.division ?? line.scopeId}:</span>
                {linePhotos.filter((photo) => photo.scopeId === line.scopeId).map((photo) => (photo.documentId ? <a key={photo.id} className="text-link underline underline-offset-2" href={`/api/documents/${photo.documentId}`}>{photo.name}</a> : <span key={photo.id}>{photo.name}</span>))}
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="stack-table mt-3 w-full">
        <thead><tr className="border-b border-rule"><th>Budget line</th><th className="text-right">Budget</th><th className="text-right">Released</th><th className="text-right">Requested</th><th className="text-right">Borrower says</th><th className="text-right">Work finished</th><th className="text-right">Supported</th></tr></thead>
        <tbody>
          {draw.lines.map((line, index) => {
            const item = deal.scope?.find((scope) => scope.id === line.scopeId);
            return (
              <tr key={line.scopeId} className="border-b border-border last:border-0">
                <td className="font-medium">{item?.division ?? line.scopeId}</td>
                <td data-label="Budget" className="text-right">{usd(item?.budget ?? 0)}</td>
                <td data-label="Released" className="text-right">{usd(item?.released ?? 0)}</td>
                <td data-label="Requested" className="text-right">{usd(line.requested)}</td>
                <td data-label="Borrower says" className={`text-right ${claimGap(line) ? "text-warn" : ""}`} data-testid="draw-claimed">{line.claimedPct === undefined ? "—" : `${Math.round(line.claimedPct * 100)}%`}{claimGap(line) ? " (more than found)" : ""}</td>
                <td data-label="Work finished" className="text-right">
                  {reading ? (
                    <input aria-label={`Percent finished for ${item?.division}`} data-testid={`observed-${line.scopeId}`} className="desk-input ml-auto w-24!" type="number" inputMode="numeric" min={0} max={100} placeholder="%" value={observed[line.scopeId] ?? (desk && line.claimedPct !== undefined ? Math.round(line.claimedPct * 100) : "")} onChange={(event) => setObserved({ ...observed, [line.scopeId]: Number(event.target.value) })} />
                  ) : line.observedPct === undefined ? "—" : `${Math.round(line.observedPct * 100)}%`}
                </td>
                <td data-label="Supported" className="text-right font-medium">{line.observedPct === undefined ? "—" : usd(review.lines[index].approved)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 border-t border-border pt-3"><PhotoRequests deal={deal} draw={draw} /></div>
      <DrawLienChecklist deal={deal} draw={draw} side="team" />
      </div>
      {draw.status === "inspected" && (
        <p className="mt-3 text-sm" data-testid="draw-review"><b>{usd(review.approved)}</b> supported of {usd(drawTotal(draw))} requested, after retainage.{needed > 1 ? ` Needs two approvers${draw.approvers.length ? `; ${draw.approvers[0]} has approved` : ""}.` : ""}{review.blocked ? ` ${review.blocked}.` : ""}</p>
      )}
      {draw.status === "approved" && <p className="mt-3 text-sm" data-testid="draw-approved"><b>{usd(draw.approved ?? 0)}</b> approved by {draw.approvers.join(" and ")}.{draw.fee ? ` Send ${usd(toSend(draw))}: the ${usd(draw.fee)} fee is kept.` : ""}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {desk && <button className="btn-primary" data-testid="record-desk-review" disabled={draw.lines.some((line) => (observed[line.scopeId] ?? (line.claimedPct !== undefined ? line.claimedPct * 100 : undefined)) === undefined)} onClick={() => dispatch({ t: "deskReview", drawId: draw.id, observed: Object.fromEntries(draw.lines.map((line) => [line.scopeId, Math.min(100, Math.max(0, observed[line.scopeId] ?? (line.claimedPct ?? 0) * 100)) / 100])), note: "", by: viewerName })}>Record the photo review</button>}
        {desk && (
          <span className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
            <input aria-label="Why it needs an inspector" data-testid="escalate-reason" className="desk-input min-w-0 flex-1" placeholder="Why it needs an inspector" value={why} onChange={(event) => setWhy(event.target.value)} />
            <button className="btn-ghost" data-testid="escalate-draw" disabled={!why.trim()} onClick={async () => { if (await dispatch({ t: "sendInspector", drawId: draw.id, reason: why.trim(), by: viewerName })) setWhy(""); }}>Send an inspector</button>
          </span>
        )}
        {((draw.status === "submitted" && !desk) || (draw.status === "inspected" && fresh)) && <button className="btn-primary" data-testid="send-inspector" onClick={() => dispatch({ t: "sendInspector", drawId: draw.id })}>{draw.status === "inspected" ? "Order a fresh inspection" : "Order inspection"}</button>}
        {draw.status === "inspecting" && <button className="btn-primary" data-testid="record-inspection" disabled={draw.lines.some((line) => observed[line.scopeId] === undefined)} onClick={() => dispatch({ t: "recordInspection", drawId: draw.id, observed: Object.fromEntries(Object.entries(observed).map(([id, percent]) => [id, Math.min(100, Math.max(0, percent)) / 100])) })}>Record inspection</button>}
        {draw.status === "inspected" && <button className="btn-primary" data-testid="approve-draw" disabled={Boolean(refusal)} onClick={() => dispatch({ t: "approveDrawRequest", drawId: draw.id, by: viewerName })}>Approve</button>}
        {draw.status === "approved" && <button className="btn-primary" data-testid="release-draw" disabled={Boolean(sanctions) || holds.length > 0} onClick={() => dispatch({ t: "releaseDraw", drawId: draw.id })}>Release funds</button>}
        {draw.status === "approved" && !sanctions && holds.length > 0 && <span className="text-xs text-warn" data-testid="release-held">Held: {holds.length} lien-law or insurance item{holds.length === 1 ? "" : "s"} above.</span>}
        {draw.status === "approved" && sanctions && <span className="text-xs text-bad" data-testid="release-blocked">{sanctions}. <Link href={`/admin/deals/${deal.id}`} className="underline">Screen on the loan&apos;s Credit review tab</Link>.</span>}
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
