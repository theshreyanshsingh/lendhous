"use client";
import { useState } from "react";
import { Badge, Section, Stat, shortDate, usd } from "@/components/ui";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { addDays } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { exceptionCovers, exceptionReasons, issueProblem, latestSheet, matrixOf, PREPAY, pricedApp, SHEET_STATUS, startingTerms, TERM_SHEET_DAYS, termsProblem, type Prepay, type TermsInput } from "@/lib/term-sheets";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";
import { usuryCheck, usuryWarning } from "@/lib/usury";
import { buyDownOptions } from "@/lib/buy-down";
import { concentrationWarnings } from "@/lib/risk";
import { ratePercent } from "@/lib/format";

const small = "h-9! px-3! text-xs!";
const TONE = { sent: "amber", accepted: "green", changes_requested: "blue", declined: "rose", expired: "slate", superseded: "slate" } as const;
const pct = ratePercent;

/** An owner's decision on an underwriter's request to price outside the matrix. Whoever asked can't decide it. */
function ExceptionPanel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [note, setNote] = useState("");
  const exception = deal.pricingException!;
  const mine = exception.requestedBy === viewerName;
  const decide = async (approve: boolean) => { if (await dispatch({ t: "decidePricingException", dealId: deal.id, approve, note: note.trim(), by: viewerName })) setNote(""); };
  return (
    <div className={`space-y-2 rounded-[2px] border p-3 text-sm ${exception.status === "pending" ? "border-warn/50 bg-warn/5" : "border-border"}`} data-testid="pricing-exception">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Pricing exception: {pct(exception.rate)} and {exception.points} points{deal.app.product === "dscr" ? "" : `, ${exception.termMonths} months`}</p><Badge tone={exception.status === "approved" ? "green" : exception.status === "declined" ? "rose" : "amber"}>{exception.status === "pending" ? "Waiting for an owner" : exception.status === "approved" ? "Approved" : "Declined"}</Badge></div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">{exception.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <p className="text-xs text-muted-foreground">Asked for by {exception.requestedBy} on {shortDate(exception.requestedAt)}: “{exception.note}”</p>
      {exception.decidedBy && <p className="text-xs text-muted-foreground" data-testid="exception-decision">{exception.status === "approved" ? "Approved" : "Declined"} by {exception.decidedBy} on {shortDate(exception.decidedAt!)}{exception.decision ? `: ${exception.decision}` : "."}</p>}
      {exception.status === "pending" && (mine ? <p className="text-xs text-warn">An owner other than you has to decide it.</p> : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-56"><span className="label">Note (needed to decline)</span><input className="desk-input" data-testid="exception-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className={`btn-primary ${small}`} data-testid="approve-exception" onClick={() => void decide(true)}>Approve</button>
          <button type="button" className={`btn-ghost ${small}`} data-testid="decline-exception" disabled={!note.trim()} onClick={() => void decide(false)}>Decline</button>
        </div>
      ))}
    </div>
  );
}

/**
 * The underwriter's term sheet (Spec A9): starts from the matrix, keeps rate and points inside its range unless an owner
 * approves an exception, and sends each term sheet as a numbered version that expires. Every version stays listed.
 */
export function TermSheetBuilder({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName, local } = useStore();
  const today = useServiceDay();
  const [draft, setDraft] = useState<TermsInput>(() => startingTerms(deal));
  const [text, setText] = useState({ rate: String(draft.rate), points: String(draft.points), termMonths: String(draft.termMonths) });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const building = deal.status === "underwriting";
  const m = matrixOf(deal.app);
  const rental = deal.app.product === "dscr";
  const hard = termsProblem(deal.app, draft);
  const e = hard ? null : evaluate(pricedApp(deal.app, draft));
  const reasons = hard ? [] : exceptionReasons(deal.app, draft);
  const covered = exceptionCovers(deal.pricingException, draft);
  const pendingSame = deal.pricingException?.status === "pending";
  const problem = building ? issueProblem(deal, draft) : null;
  // The broker's points are counted the attorney's other way: whether an independent broker's fee is interest.
  const broker = (deal.brokerPoints ?? 0) > 0;
  const usuryFor = e ? usuryCheck({ amount: e.noteAmount, rate: draft.rate, points: draft.points, brokerPoints: deal.brokerPoints, termMonths: e.termMonths }) : null;
  const usury = usuryFor && !usuryFor.overLender ? usuryWarning(usuryFor, e!.termMonths, deal.brokerPoints) : null;
  const version = (deal.termSheets?.length ?? 0) + 1;
  // What the borrower will be offered besides these terms (lib/buy-down.ts); none for an exception.
  const choices = e && !reasons.length ? buyDownOptions(pricedApp(deal.app, draft), { rate: e.rate, points: e.pointsPct }, { rate: m.rate, points: m.points }) : [];
  const set = (key: "rate" | "points" | "termMonths", value: string) => { setText({ ...text, [key]: value }); setDraft({ ...draft, [key]: Number(value) }); };
  const run = async (action: Parameters<typeof dispatch>[0]) => { setBusy(true); const done = await dispatch(action); setBusy(false); return done; };
  const pdf = (v: number) => (local ? "/api/term-sheets/demo" : `/api/term-sheets/${deal.id}?v=${v}`);
  const sheets = [...(deal.termSheets ?? [])].reverse();
  return (
    <div className="space-y-4" data-testid="term-sheet-builder">
      {deal.pricingException && <ExceptionPanel deal={deal} />}
      {building ? (
        <Section title={`Term sheet, version ${version}`}>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">Starts from the matrix on pricing {deal.app.pricingVersion ?? "the original numbers"}. Rate and points inside its range go out on your authority; outside it, an owner approves first.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block min-w-0"><span className="label">Rate (%)</span><input className="desk-input" inputMode="decimal" data-testid="sheet-rate" value={text.rate} onChange={(event) => set("rate", event.target.value)} /><span className="text-[11px] text-muted-foreground">Matrix {pct(m.rate[0])} to {pct(m.rate[1])}</span></label>
              <label className="block min-w-0"><span className="label">Points (%)</span><input className="desk-input" inputMode="decimal" data-testid="sheet-points" value={text.points} onChange={(event) => set("points", event.target.value)} /><span className="text-[11px] text-muted-foreground">Matrix {m.points[0]} to {m.points[1]}</span></label>
              {!rental && <label className="block min-w-0"><span className="label">Term (months)</span><input className="desk-input" inputMode="numeric" data-testid="sheet-term" value={text.termMonths} onChange={(event) => set("termMonths", event.target.value)} /><span className="text-[11px] text-muted-foreground">Matrix {m.termMonths}</span></label>}
              <label className="block min-w-0"><span className="label">Prepayment</span><select className="desk-input" data-testid="sheet-prepay" value={draft.prepay} onChange={(event) => setDraft({ ...draft, prepay: event.target.value as Prepay })}>{(Object.keys(PREPAY) as Prepay[]).map((key) => <option key={key} value={key}>{PREPAY[key]}</option>)}</select></label>
            </div>
            {hard && <p className="text-xs text-bad" role="alert">{hard}</p>}
            {e && (
              <div className="grid grid-cols-2 gap-3 rounded-[2px] border border-border p-3 sm:grid-cols-4" data-testid="sheet-preview">
                <Stat label="Loan amount" value={usd(e.noteAmount)} sub={e.holdback ? `${usd(e.initialAdvance)} at closing` : undefined} />
                <Stat label="Points" value={usd(e.points)} sub={`${e.pointsPct}%`} />
                <Stat label={rental ? "Monthly payment" : "First payment"} value={usd(e.monthlyPayment, 2)} />
                <Stat label="Cash to close" value={usd(e.cashToClose)} sub={rental ? undefined : `all-in ${(e.allIn * 100).toFixed(2)}% a year`} />
              </div>
            )}
            {broker && e && <p className="text-xs text-muted-foreground" data-testid="sheet-broker-fee">The broker&apos;s fee of {deal.brokerPoints} points ({usd((e.noteAmount * (deal.brokerPoints ?? 0)) / 100)}) is shown on the term sheet as a cost the borrower pays.</p>}
            {usury && <p className="rounded-md bg-warn/10 p-3 text-xs text-warn" role="alert" data-testid="sheet-usury">{usury}</p>}
            {concentrationWarnings(s.deals, deal).map((item) => <p key={item} className="rounded-md bg-warn/10 p-3 text-xs text-warn" data-testid="sheet-concentration">{item}. Check with an owner before it goes out.</p>)}
            {choices.length > 1 && <p className="text-xs text-muted-foreground" data-testid="sheet-choices">The borrower can also accept at {choices.length - 1} other rate-and-points choice{choices.length === 2 ? "" : "s"} inside the matrix and the usury cap: {pct(choices[0].rate)} with {choices[0].points} points to {pct(choices[choices.length - 1].rate)} with {choices[choices.length - 1].points}.</p>}
            {reasons.length > 0 && (
              <div className={`rounded-md p-3 text-xs ${covered ? "bg-good/10 text-good" : "bg-warn/10"}`} data-testid="sheet-exception">
                <p className="font-medium">{covered ? `Outside the matrix, approved by ${deal.pricingException!.decidedBy}:` : "Outside the matrix:"}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                {!covered && !pendingSame && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block min-w-0 flex-1 basis-56"><span className="label">Why this loan should be priced this way</span><input className="desk-input" data-testid="exception-reason" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
                    <button type="button" className={`btn-primary ${small}`} data-testid="request-exception" disabled={busy || !note.trim()} onClick={async () => { if (await run({ t: "requestPricingException", dealId: deal.id, ...draft, note: note.trim(), by: viewerName })) setNote(""); }}>Ask an owner to approve it</button>
                  </div>
                )}
              </div>
            )}
            {problem && !hard && (reasons.length === 0 || covered) && <p className="text-xs text-warn">{problem}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" data-testid="issue-term-sheet" disabled={busy || Boolean(problem)} onClick={() => void run({ t: "issueTermSheet", dealId: deal.id, ...draft, by: viewerName })}>{busy ? "Sending…" : `Send term sheet version ${version}`}</button>
              {today && <span className="text-xs text-muted-foreground">The borrower has {TERM_SHEET_DAYS} days to accept it, until {addDays(today, TERM_SHEET_DAYS)}.</span>}
            </div>
          </div>
        </Section>
      ) : !sheets.length && <Section title="Term sheet"><p className="text-sm text-muted-foreground">A term sheet goes out once the loan is in underwriting.</p></Section>}

      {sheets.length > 0 && (
        <Section title={`Term sheets sent (${sheets.length})`}>
          <ul className="divide-y divide-border text-sm" data-testid="term-sheet-versions">
            {sheets.map((sheet) => (
              <li key={sheet.version} className="space-y-0.5 py-2.5" data-testid="term-sheet-version">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Version {sheet.version}: {usd(sheet.terms.noteAmount)} at {pct(sheet.terms.rate)}, {sheet.terms.pointsPct} points{rental ? "" : `, ${sheet.terms.termMonths} months`}</span><span className="flex items-center gap-2"><Badge tone={TONE[sheet.status]}>{SHEET_STATUS[sheet.status]}</Badge><a className="text-xs text-link underline" href={pdf(sheet.version)} target="_blank" rel="noreferrer" data-testid="term-sheet-pdf">PDF</a></span></div>
                <p className="text-xs text-muted-foreground">Sent {shortDay(sheet.issuedOn)}{sheet.issuedBy ? ` by ${sheet.issuedBy}` : ""} · open until {shortDay(sheet.expiresOn)} · pricing {sheet.pricingVersion}{sheet.exception ? ` · exception approved by ${sheet.exception.decidedBy}` : ""}</p>
                {sheet.response && <p className="text-xs" data-testid="term-sheet-response">{sheet.status === "accepted" ? `Accepted by ${sheet.response.signedName} on ${shortDate(sheet.response.at)}.` : sheet.status === "changes_requested" ? `${sheet.response.by} asked for changes: “${sheet.response.note}”` : `Declined by ${sheet.response.by}${sheet.response.note ? `: “${sheet.response.note}”` : "."}`}</p>}
              </li>
            ))}
          </ul>
          {latestSheet(deal)?.status === "accepted" && <p className="mt-2 text-xs text-muted-foreground">The rate and points are locked at what the borrower accepted.</p>}
        </Section>
      )}
    </div>
  );
}
