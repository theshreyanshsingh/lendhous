"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { maturityDate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { daysBetween } from "@/lib/servicing";
import { est, useStore } from "@/lib/store";
import { latestSheet, respondProblem, sheetContent, SHEET_STATUS } from "@/lib/term-sheets";
import { Badge, Section, Stat, shortDate, usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";

const TONE = { sent: "amber", accepted: "green", changes_requested: "blue", declined: "rose", expired: "slate", superseded: "slate" } as const;

/** A loan whose term sheet went out before term sheets were kept as versions: the numbers as they stand. */
function LegacyTermSheet({ deal, canSign }: { deal: Deal; canSign: boolean }) {
  const e = est(deal.app);
  const waiting = deal.status === "term_sheet_issued";
  if (!waiting && !deal.termSheetSignedBy) return null;
  return (
    <Section title="Term sheet" right={waiting ? <Badge tone="amber">Waiting for acceptance</Badge> : <Badge tone="green">Accepted</Badge>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="term-sheet">
        <Stat label="Loan amount" value={usd(e.noteAmount)} />
        <Stat label="Rate" value={`${e.rate.toFixed(3)}%`} sub={deal.app.product === "dscr" ? "30-year amortizing" : "interest only"} />
        <Stat label="Points" value={usd(e.points)} sub={`${e.pointsPct}%`} />
        <Stat label="Term" value={`${e.termMonths} months`} sub={`matures ${maturityDate(deal.closingDate, e.termMonths)}`} />
        <Stat label="Cash to close" value={usd(e.cashToClose)} />
        <Stat label="Target closing" value={deal.closingDate} />
      </div>
      {deal.termSheetSignedBy && <p className="mt-3 text-sm text-muted-foreground" data-testid="term-sheet-signed">Accepted by {deal.termSheetSignedBy}{deal.termSheetSignedAt ? ` on ${shortDate(deal.termSheetSignedAt)}` : ""}.</p>}
      {waiting && canSign && <Respond deal={deal} />}
    </Section>
  );
}

/** The borrower's three answers (Spec B16): accept by typing their name, ask for changes, or decline. */
function Respond({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [mode, setMode] = useState<"accept" | "changes" | "decline">("accept");
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: Parameters<typeof dispatch>[0]) => { setBusy(true); await dispatch(action); setBusy(false); };
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap gap-2 text-sm" role="tablist">
        {(["accept", "changes", "decline"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={mode === key} data-testid={`term-sheet-mode-${key}`} className={`${mode === key ? "btn-primary" : "btn-ghost"} h-9! px-3! text-xs!`} onClick={() => setMode(key)}>{key === "accept" ? "Accept" : key === "changes" ? "Ask for changes" : "Decline"}</button>)}
      </div>
      <Reveal open={mode === "accept"}>
        <div className="space-y-3">
          <label className="block"><span className="label">Type your full name to accept</span><input data-testid="term-sheet-name" className="desk-input" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm"><input data-testid="term-sheet-agree" type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> I accept these terms. I understand this isn&apos;t a commitment to lend, and the loan depends on underwriting and the conditions listed.</label>
          <button className="btn-primary w-full sm:w-auto" data-testid="accept-term-sheet" disabled={busy || !agreed || !name.trim()} onClick={() => void run({ t: "acceptTermSheet", dealId: deal.id, signedName: name })}>Accept term sheet</button>
        </div>
      </Reveal>
      <Reveal open={mode !== "accept"}>
        <div className="space-y-3">
          <label className="block"><span className="label">{mode === "changes" ? "What would you like changed?" : "Why are you declining? (optional)"}</span><textarea className="desk-input min-h-20" data-testid="term-sheet-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          {mode === "changes"
            ? <button className="btn-primary w-full sm:w-auto" data-testid="request-term-sheet-changes" disabled={busy || !note.trim()} onClick={() => void run({ t: "requestTermSheetChanges", dealId: deal.id, note: note.trim(), by: viewerName })}>Send it back to my loan officer</button>
            : <button className="btn-ghost w-full sm:w-auto" data-testid="decline-term-sheet" disabled={busy} onClick={() => void run({ t: "closeApplication", dealId: deal.id, outcome: "withdrawn", reason: "terms", note: note.trim(), by: viewerName, byTeam: false })}>Decline and withdraw the application</button>}
          {mode === "decline" && <p className="text-xs text-muted-foreground">This withdraws your application. Your loan officer can reopen it if you change your mind.</p>}
        </div>
      </Reveal>
    </div>
  );
}

/**
 * The newest term sheet, in plain numbers (Spec B16). The borrower answers it here; anyone else only reads it. Earlier
 * versions stay with the team.
 */
export function TermSheetCard({ deal, canSign }: { deal: Deal; canSign: boolean }) {
  const { local } = useStore();
  const today = useServiceDay();
  const sheet = latestSheet(deal);
  if (!sheet) return <LegacyTermSheet deal={deal} canSign={canSign} />;
  // Once it's been replaced the team is working on a new one; until then the borrower sees where the last one stands.
  if (sheet.status === "superseded" || sheet.status === "declined") return null;
  const content = sheetContent(deal, sheet);
  const open = today ? !respondProblem(deal, today) : false;
  const left = today ? daysBetween(today, sheet.expiresOn) : 0;
  const expired = sheet.status === "expired" || (sheet.status === "sent" && Boolean(today) && today > sheet.expiresOn);
  return (
    <Section title={`Term sheet, version ${sheet.version}`} right={<Badge tone={expired ? "slate" : TONE[sheet.status]}>{expired ? "Expired" : sheet.status === "sent" ? "Waiting for acceptance" : SHEET_STATUS[sheet.status]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="term-sheet">
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[11rem_1fr]">
          {content.terms.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 wrap-anywhere">{value}</dd></div>)}
        </dl>
        {content.conditions.length > 0 && <div><p className="font-medium">Still needed before closing</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{content.conditions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <p className="text-xs text-muted-foreground">{content.paragraphs[0]}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a className="text-link underline" href={local ? "/api/term-sheets/demo" : `/api/term-sheets/${deal.id}`} target="_blank" rel="noreferrer" data-testid="term-sheet-download">Download the PDF</a>
          {sheet.status === "sent" && !expired && today && <span className={left <= 2 ? "text-warn" : "text-muted-foreground"} data-testid="term-sheet-expires">Open until {shortDay(sheet.expiresOn)} ({left === 0 ? "last day" : `${left} day${left === 1 ? "" : "s"} left`})</span>}
        </div>
        {sheet.status === "accepted" && <p className="text-muted-foreground" data-testid="term-sheet-signed">Accepted by {sheet.response?.signedName} on {shortDate(sheet.response!.at)}.</p>}
        {sheet.status === "changes_requested" && <p className="rounded-md bg-link/10 p-2 text-xs" data-testid="term-sheet-changes">You asked for changes: “{sheet.response?.note}”. Your loan officer will send a new term sheet.</p>}
        {expired && <p className="rounded-md bg-muted p-2 text-xs" data-testid="term-sheet-expired">This term sheet expired on {shortDay(sheet.expiresOn)}. Your loan officer can send a new one.</p>}
        {sheet.status === "sent" && !expired && !canSign && <p className="text-muted-foreground">Waiting for the borrower to answer it.</p>}
        {open && canSign && <Respond deal={deal} />}
      </div>
    </Section>
  );
}
