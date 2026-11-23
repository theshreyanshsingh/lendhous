"use client";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { addDays } from "@/lib/servicing";
import { answerDueOn, answerProblem, APPRAISAL_RULES, appraisalStage, appraised, belowPlan, currentValues, datesProblem, deliveredProblem, loanAt, needsArv, ORDER_STAGES, orderChecks, orderProblem, plannedValues, REUSE_POLICY, reviewProblem, STAGE_LABEL, TRACKED, valueToKeep, type AppraisalValues, type CompSale } from "@/lib/appraisals";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
const TONE = { not_ordered: "slate", ordered: "blue", late: "amber", in: "green", review: "amber" } as const;
const amount = (text: string) => { const value = Number(text.replace(/[$,\s]/g, "")); return text.trim() && Number.isFinite(value) ? value : NaN; };
const valuesLine = (values: AppraisalValues) => `${usd(values.asIs)} as it is${values.arv !== undefined ? `, ${usd(values.arv)} after the work` : ""}`;

/** What the appraisal has to come in at, in a sentence. */
function KeepLine({ deal, side }: { deal: Deal; side: "team" | "client" }) {
  const keep = valueToKeep(deal);
  return <p className="text-xs text-muted-foreground" data-testid="appraisal-keep">{side === "team" ? "The loan" : "Your loan"} stays at {usd(keep.loan)} as long as the appraisal comes in at {usd(keep.asIs)} or more as it is{keep.arv !== undefined ? ` and ${usd(keep.arv)} or more after the work` : ""}.</p>;
}

/** The report against the plan: it supports the loan, or what the loan can be at these values. */
function Outcome({ deal, side }: { deal: Deal; side: "team" | "client" }) {
  const values = currentValues(deal.appraisal);
  if (!values) return null;
  const now = evaluate(deal.app).noteAmount;
  const at = loanAt(deal, values);
  if (!belowPlan(deal)) return <p className="text-xs text-good" data-testid="appraisal-outcome">It supports {side === "team" ? "the loan" : "your loan"} as planned.</p>;
  // Under plan, but another limit (the cost, say) is what sizes the loan, so the amount doesn't move.
  if (at.noteAmount >= now - 0.5 && at.eligible) return <p className="text-xs text-muted-foreground" data-testid="appraisal-outcome">It came in under what the loan was sized on ({valuesLine(plannedValues(deal))}), but {side === "team" ? "the loan" : "your loan"} stays at {usd(now)}.</p>;
  return <p className="text-xs text-warn" data-testid="appraisal-outcome">It came in under what the loan was sized on ({valuesLine(plannedValues(deal))}). At these values {side === "team" ? "the loan" : "your loan"} can be up to {usd(at.noteAmount)}{at.eligible ? "" : ", and it no longer fits the pricing rules"}; it&apos;s {usd(now)} now. {side === "team" ? "A smaller loan is a change to the accepted terms: propose it on the Numbers tab, with a reason the borrower sees." : "Your loan team will talk you through the options."}</p>;
}

/** The steps so far, the same for the team and the borrower. */
function Steps({ deal, today }: { deal: Deal; today: string }) {
  const file = deal.appraisal!;
  const visitDone = file.inspectionOn && file.inspectionOn <= today;
  return (
    <ol className="space-y-1.5 text-sm" data-testid="appraisal-steps">
      <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-good" aria-hidden="true" /><span>Ordered {shortDay(file.ordered.on)} from {file.ordered.firm}{file.ordered.fee ? `, fee ${usd(file.ordered.fee)}` : ""}.</span></li>
      <li className="flex gap-2">{visitDone ? <Check size={15} className="mt-0.5 shrink-0 text-good" aria-hidden="true" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />}<span>{file.inspectionOn ? `${visitDone ? "The appraiser visited" : "The appraiser's visit is set for"} ${shortDay(file.inspectionOn)}.` : "The appraiser will call to set a time to see the property."}</span></li>
      <li className="flex gap-2">{file.delivered ? <Check size={15} className="mt-0.5 shrink-0 text-good" aria-hidden="true" /> : <span className={`mt-1.5 size-2 shrink-0 rounded-full ${file.ordered.dueOn < today ? "bg-warn" : "bg-muted-foreground/50"}`} aria-hidden="true" />}<span data-testid="appraisal-report">{file.delivered ? `The report came in ${shortDay(file.delivered.on)}: ${valuesLine(file.delivered)}.` : `The report is expected by ${shortDay(file.ordered.dueOn)}${file.ordered.dueOn < today ? ", and it's running late: we're chasing it" : ""}.`}</span></li>
      {file.moves?.map((move) => <li key={move.at} className="pl-6 text-xs text-muted-foreground" data-testid="appraisal-move">Moved from {shortDay(move.from)} to {shortDay(move.to)}: {move.reason}</li>)}
    </ol>
  );
}

/** A second look, as asked and as answered. */
function ReviewSummary({ deal }: { deal: Deal }) {
  const review = deal.appraisal?.review;
  if (!review) return null;
  return (
    <div className="space-y-1 rounded-[2px] border border-border p-3 text-xs" data-testid="value-review">
      <p><b className="font-medium">Second look asked {shortDay(review.at.slice(0, 10))}</b> by {review.by}: {review.reason}</p>
      <ul className="list-disc pl-4 text-muted-foreground">{review.sales.map((sale) => <li key={sale.address}>{sale.address}, {usd(sale.price)} on {shortDay(sale.soldOn)}{sale.note ? ` (${sale.note})` : ""}</li>)}</ul>
      {review.answer ? <p className="text-good" data-testid="value-review-answer">Answered {shortDay(review.answer.at.slice(0, 10))}: {valuesLine(review.answer)}. {review.answer.note}</p> : <p className="text-muted-foreground">The answer is promised by {shortDay(answerDueOn(review.at.slice(0, 10)))}.</p>}
    </div>
  );
}

/**
 * The appraisal on the team's Conditions tab (lib/appraisals.ts): what has to be true before anyone pays for one, the
 * order, the visit and the expected day, the report against the plan, and the answer to a second look.
 */
export function AppraisalPanel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const file = deal.appraisal;
  const [order, setOrder] = useState({ firm: "", on: "", fee: "", dueOn: "" });
  const [dates, setDates] = useState<{ inspectionOn: string; dueOn: string; reason: string } | null>(null);
  const [report, setReport] = useState({ on: "", asIs: "", arv: "" });
  const [answer, setAnswer] = useState({ asIs: "", arv: "", note: "" });
  if (!today || !appraised(deal) || (!TRACKED.includes(deal.status) && !file)) return null;
  const stage = appraisalStage(file, today);
  const orderInput = { firm: order.firm, on: order.on || today, fee: amount(order.fee || "0"), dueOn: order.dueOn || addDays(today, 10) };
  const orderRefused = orderProblem(deal, orderInput, today);
  const datesInput = dates && file ? { ...(dates.inspectionOn && dates.inspectionOn !== file.inspectionOn ? { inspectionOn: dates.inspectionOn } : {}), ...(dates.dueOn && dates.dueOn !== file.ordered.dueOn ? { dueOn: dates.dueOn } : {}), reason: dates.reason } : null;
  const datesRefused = datesInput ? datesProblem(deal, datesInput) : null;
  const reportInput = { on: report.on || today, asIs: amount(report.asIs), ...(needsArv(deal) ? { arv: amount(report.arv) } : {}) };
  const reportRefused = deliveredProblem(deal, reportInput, today);
  const answerInput = { asIs: amount(answer.asIs), ...(needsArv(deal) ? { arv: amount(answer.arv) } : {}), note: answer.note };
  const answerRefused = answerProblem(deal, answerInput);
  return (
    <Section title="Appraisal" right={<Badge tone={TONE[stage]}>{STAGE_LABEL[stage]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="appraisal-panel">
        {!file ? (
          <>
            <p className="text-muted-foreground">Nobody pays for an appraisal until the loan checks out:</p>
            <ul className="space-y-1 text-xs" data-testid="appraisal-checks">{orderChecks(deal).map((check) => <li key={check.key} className={`flex items-start gap-1.5 ${check.ok ? "text-good" : "text-bad"}`}>{check.ok ? <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> : <X size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}<span>{check.label}{check.note ? `: ${check.note}` : ""}</span></li>)}</ul>
            <KeepLine deal={deal} side="team" />
            {ORDER_STAGES.includes(deal.status) && (
              <div className="space-y-2 rounded-[2px] border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0"><span className="label">Appraisal firm</span><input className="desk-input" data-testid="appraisal-firm" maxLength={160} value={order.firm} onChange={(event) => setOrder({ ...order, firm: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Fee the borrower pays ($)</span><input className="desk-input" inputMode="decimal" data-testid="appraisal-fee" maxLength={10} value={order.fee} onChange={(event) => setOrder({ ...order, fee: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Ordered on</span><input type="date" className="desk-input" data-testid="appraisal-on" max={today} value={orderInput.on} onChange={(event) => setOrder({ ...order, on: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Report expected by</span><input type="date" className="desk-input" data-testid="appraisal-due" min={orderInput.on} value={orderInput.dueOn} onChange={(event) => setOrder({ ...order, dueOn: event.target.value })} /></label>
                </div>
                {orderRefused && order.firm && <p className="text-xs text-warn">{orderRefused}</p>}
                <button type="button" className={`btn-primary ${small}`} data-testid="order-appraisal" disabled={Boolean(orderRefused)} onClick={() => void dispatch({ t: "orderAppraisal", dealId: deal.id, ...orderInput, by: viewerName })}>Order it</button>
              </div>
            )}
          </>
        ) : (
          <>
            <Steps deal={deal} today={today} />
            {!file.delivered && (
              <div className="flex flex-wrap gap-2">
                {!dates && <button type="button" className={`btn-ghost ${small}`} data-testid="appraisal-dates" onClick={() => setDates({ inspectionOn: file.inspectionOn ?? "", dueOn: file.ordered.dueOn, reason: "" })}>Set the visit or move the report&apos;s day</button>}
              </div>
            )}
            <Reveal open={Boolean(dates) && !file.delivered}>
              {dates && (
                <div className="space-y-2 rounded-[2px] border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block min-w-0"><span className="label">Appraiser&apos;s visit</span><input type="date" className="desk-input" data-testid="appraisal-visit" min={file.ordered.on} value={dates.inspectionOn} onChange={(event) => setDates({ ...dates, inspectionOn: event.target.value })} /></label>
                    <label className="block min-w-0"><span className="label">Report expected by</span><input type="date" className="desk-input" data-testid="appraisal-new-due" min={file.ordered.on} value={dates.dueOn} onChange={(event) => setDates({ ...dates, dueOn: event.target.value })} /></label>
                  </div>
                  {dates.dueOn !== file.ordered.dueOn && <label className="block"><span className="label">Why it moved (the borrower sees this)</span><input className="desk-input" data-testid="appraisal-move-reason" maxLength={500} value={dates.reason} onChange={(event) => setDates({ ...dates, reason: event.target.value })} /></label>}
                  {datesRefused && <p className="text-xs text-warn">{datesRefused}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={`btn-primary ${small}`} data-testid="save-appraisal-dates" disabled={Boolean(datesRefused)} onClick={async () => { if (datesInput && (await dispatch({ t: "appraisalDates", dealId: deal.id, ...datesInput, by: viewerName }))) setDates(null); }}>Save</button>
                    <button type="button" className={`btn-ghost ${small}`} onClick={() => setDates(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </Reveal>
            {!file.delivered && (
              <div className="space-y-2 border-t border-border pt-3" data-testid="appraisal-report-form">
                <p className="font-medium">The report is in</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block min-w-0"><span className="label">Came in on</span><input type="date" className="desk-input" data-testid="report-on" min={file.ordered.on} max={today} value={reportInput.on} onChange={(event) => setReport({ ...report, on: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Value as it is ($)</span><input className="desk-input" inputMode="numeric" data-testid="report-as-is" maxLength={14} value={report.asIs} onChange={(event) => setReport({ ...report, asIs: event.target.value })} /></label>
                  {needsArv(deal) && <label className="block min-w-0"><span className="label">Value after the work ($)</span><input className="desk-input" inputMode="numeric" data-testid="report-arv" maxLength={14} value={report.arv} onChange={(event) => setReport({ ...report, arv: event.target.value })} /></label>}
                </div>
                <button type="button" className={`btn-primary ${small}`} data-testid="save-report" disabled={Boolean(reportRefused)} onClick={() => void dispatch({ t: "appraisalDelivered", dealId: deal.id, ...reportInput, by: viewerName })}>Record the report</button>
              </div>
            )}
            <Outcome deal={deal} side="team" />
            <ReviewSummary deal={deal} />
            {file.review && !file.review.answer && (
              <div className="space-y-2 border-t border-border pt-3" data-testid="value-review-answer-form">
                <p className="font-medium">After the appraiser looks again</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0"><span className="label">Value as it is ($)</span><input className="desk-input" inputMode="numeric" data-testid="answer-as-is" maxLength={14} value={answer.asIs} onChange={(event) => setAnswer({ ...answer, asIs: event.target.value })} /></label>
                  {needsArv(deal) && <label className="block min-w-0"><span className="label">Value after the work ($)</span><input className="desk-input" inputMode="numeric" data-testid="answer-arv" maxLength={14} value={answer.arv} onChange={(event) => setAnswer({ ...answer, arv: event.target.value })} /></label>}
                </div>
                <label className="block"><span className="label">What the appraiser said (the borrower sees this)</span><input className="desk-input" data-testid="answer-note" maxLength={1000} value={answer.note} onChange={(event) => setAnswer({ ...answer, note: event.target.value })} /></label>
                <button type="button" className={`btn-primary ${small}`} data-testid="save-value-review" disabled={Boolean(answerRefused)} onClick={() => void dispatch({ t: "answerValueReview", dealId: deal.id, ...answerInput, by: viewerName })}>Send the answer</button>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

type SaleDraft = { address: string; price: string; soldOn: string; note: string };
const blankSale = (): SaleDraft => ({ address: "", price: "", soldOn: "", note: "" });

/**
 * The borrower's (and their broker's) appraisal card: the reuse policy before anything is ordered, the steps and dates,
 * the report against the plan, and a second look at a low value with up to five sales.
 */
export function AppraisalTracker({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [sales, setSales] = useState<SaleDraft[]>([blankSale()]);
  const file = deal.appraisal;
  if (!today || !appraised(deal) || (!TRACKED.includes(deal.status) && !file)) return null;
  const stage = appraisalStage(file, today);
  const input = { reason, sales: sales.filter((sale) => sale.address.trim() || sale.price.trim()).map((sale): CompSale => ({ address: sale.address, price: amount(sale.price), soldOn: sale.soldOn, note: sale.note })) };
  const refused = reviewProblem(deal, input, today);
  const canAsk = Boolean(file?.delivered && !file.review && belowPlan(deal) && ORDER_STAGES.includes(deal.status));
  const putSale = (index: number, next: Partial<SaleDraft>) => setSales(sales.map((sale, at) => (at === index ? { ...sale, ...next } : sale)));
  return (
    <Section title="Your appraisal" right={<Badge tone={TONE[stage]}>{STAGE_LABEL[stage]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="appraisal-tracker">
        {!file ? (
          <>
            <p className="text-muted-foreground">We order the appraisal once you&apos;ve accepted the term sheet and the loan checks out, so you never pay for one on a loan we can&apos;t make. You&apos;ll see the visit and the day the report is due here.</p>
            <KeepLine deal={deal} side="client" />
            <div data-testid="reuse-policy"><p className="label">Reusing an appraisal</p><ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{REUSE_POLICY.map((line) => <li key={line}>{line}</li>)}</ul><p className="mt-1 text-xs text-faint">Placeholder wording until LendHous confirms its policy.</p></div>
          </>
        ) : (
          <>
            <Steps deal={deal} today={today} />
            <Outcome deal={deal} side="client" />
            <ReviewSummary deal={deal} />
            {canAsk && !asking && <button type="button" className={`btn-ghost ${small}`} data-testid="ask-value-review" onClick={() => setAsking(true)}>Think it&apos;s low? Ask for a second look</button>}
            <Reveal open={canAsk && asking}>
              <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="value-review-form">
                <p className="text-xs text-muted-foreground">We send it to the appraiser with up to {APPRAISAL_RULES.reviewSales} sales from the last {APPRAISAL_RULES.salesWithinMonths} months that they may have missed, and tell you the answer within {APPRAISAL_RULES.answerBusinessDays} business days. One second look per appraisal.</p>
                <label className="block"><span className="label">Why the value looks low</span><textarea className="desk-input h-auto! min-h-16 py-2" data-testid="review-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                {sales.map((sale, index) => (
                  <div key={index} className="grid gap-2 rounded-[2px] bg-muted/50 p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" data-testid="review-sale">
                    <label className="block min-w-0"><span className="label">Sale {index + 1}: address</span><input className="desk-input" data-testid="sale-address" maxLength={200} value={sale.address} onChange={(event) => putSale(index, { address: event.target.value })} /></label>
                    <label className="block min-w-0"><span className="label">Price ($)</span><input className="desk-input" inputMode="numeric" data-testid="sale-price" maxLength={14} value={sale.price} onChange={(event) => putSale(index, { price: event.target.value })} /></label>
                    <label className="block min-w-0"><span className="label">Sold on</span><input type="date" className="desk-input" data-testid="sale-on" max={today} value={sale.soldOn} onChange={(event) => putSale(index, { soldOn: event.target.value })} /></label>
                    <label className="block min-w-0 sm:col-span-3"><span className="label">Why it compares (optional)</span><input className="desk-input" data-testid="sale-note" maxLength={300} value={sale.note} onChange={(event) => putSale(index, { note: event.target.value })} /></label>
                  </div>
                ))}
                {sales.length < APPRAISAL_RULES.reviewSales && <button type="button" className="min-h-9 text-xs text-link underline underline-offset-2" data-testid="add-sale" onClick={() => setSales([...sales, blankSale()])}>+ Add another sale</button>}
                {refused && (reason || sales.some((sale) => sale.address)) && <p className="text-xs text-warn">{refused}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`btn-primary ${small}`} data-testid="send-value-review" disabled={Boolean(refused)} onClick={async () => { if (await dispatch({ t: "askValueReview", dealId: deal.id, ...input, by: viewerName })) setAsking(false); }}>Ask for a second look</button>
                  <button type="button" className={`btn-ghost ${small}`} onClick={() => setAsking(false)}>Cancel</button>
                </div>
              </div>
            </Reveal>
          </>
        )}
      </div>
    </Section>
  );
}
