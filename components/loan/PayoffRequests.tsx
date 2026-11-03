"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section, shortDate, usd } from "@/components/ui";
import type { Deal, PayoffLetter, PayoffRequest } from "@/lib/mockData";
import { CHANNELS, dueOf, goodThroughProblem, issueProblem, latestLetter, letterChanges, letterFigures, LOGGED_CHANNELS, MAX_GOOD_THROUGH_DAYS, receivedOf, receivedOnFor, letterDueBy, REQUESTERS, requesterLine, requestState, staleLetter, type RequesterKind } from "@/lib/payoffs";
import { addDays, daysBetween, SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";

/** Where a letter went, or why it didn't. */
function deliveryLine(letter: PayoffLetter, local: boolean) {
  if (local) return { text: "Demo letters aren't emailed.", tone: "text-muted-foreground" };
  const sent = letter.delivery;
  if (!sent) return { text: "Sending…", tone: "text-muted-foreground" };
  if (sent.result === "sent") return { text: `Emailed to ${sent.to.join(", ")} on ${shortDate(sent.at)}.`, tone: "text-good" };
  if (sent.result === "logged") return { text: "Mail isn't set up on this server, so it wasn't emailed. Download it and send it.", tone: "text-warn" };
  return { text: "It couldn't be emailed. Download it and send it today another way.", tone: "text-bad" };
}

/** The days left to send the letter, in words and a color. */
export function dueLine(request: PayoffRequest, today: string) {
  const due = dueOf(request);
  if (!today) return { text: `Letter due by ${due}`, tone: "text-warn" };
  const left = daysBetween(today, due);
  return { text: `Letter due by ${due} (${left < 0 ? `${-left} day${left === -1 ? "" : "s"} late` : left === 0 ? "today" : `${left} day${left === 1 ? "" : "s"} left`})`, tone: left <= 2 ? "text-bad" : "text-warn" };
}

/**
 * One payoff request, for the servicing team: who asked and how, the 10 days, checking their authority, and the
 * letters. A letter whose figures have moved since is flagged, with a corrected one a click away.
 */
export function PayoffRequestCard({ request, deal }: { request: PayoffRequest; deal: Deal }) {
  const { dispatch, viewerName, local } = useStore();
  const today = useServiceDay();
  const latest = latestLetter(request);
  const stale = today ? staleLetter(deal, request, today) : null;
  const [goodThrough, setGoodThrough] = useState("");
  const [reason, setReason] = useState("");
  const [refusing, setRefusing] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [checkNote, setCheckNote] = useState("");
  // Once a letter is out, a new one is only for a later date or a correction, so its form waits behind a button.
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  // The date asked for, unless it has passed; then the last letter's, or today.
  const wanted = goodThrough || (today && request.goodThrough >= today ? request.goodThrough : latest && today && latest.goodThrough >= today ? latest.goodThrough : today);
  const figures = today && wanted && !goodThroughProblem(wanted, today) && SERVICED.includes(deal.status) ? letterFigures(deal, wanted, today) : null;
  const problem = today ? issueProblem(deal, request, wanted, reason || (stale ? "x" : ""), today) : null;
  const open = request.status === "requested" || request.status === "sent";
  const state = requestState(request);
  const due = dueLine(request, today);
  const run = async (action: Parameters<typeof dispatch>[0]) => { setBusy(true); const done = await dispatch(action); setBusy(false); return done; };
  const issue = async () => { if (await run({ t: "issuePayoffLetter", payoffId: request.id, goodThrough: wanted, reason: reason.trim() || (stale ? `Corrected: ${letterChanges(stale.letter, stale.now).join("; ")}` : ""), by: viewerName })) { setReason(""); setGoodThrough(""); setAgain(false); } };
  const pdf = (letter: PayoffLetter) => (local ? "/payoff-letter/demo" : `/api/payoffs/${request.id}/letter?n=${letter.number}`);
  return (
    <div className="space-y-3 text-sm" data-testid="payoff-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium wrap-anywhere">{requesterLine(request)}</p>
          <p className="text-xs text-muted-foreground wrap-anywhere">{[request.requester?.email, request.requester?.phone, request.requester?.fileNumber && `file ${request.requester.fileNumber}`].filter(Boolean).join(" · ") || "From the borrower's portal"}</p>
          <p className="text-xs text-muted-foreground">{CHANNELS[request.channel ?? "portal"]} · received {receivedOf(request)}{request.loggedBy ? ` · logged by ${request.loggedBy}` : ""} · good through {request.goodThrough} asked</p>
        </div>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      {request.status === "requested" && <p className={`text-xs ${due.tone}`} data-testid="payoff-due">{due.text}</p>}
      {request.note && <p className="rounded-[2px] bg-muted/50 p-2 text-xs">“{request.note}”</p>}
      {request.refused && <p className="text-xs text-muted-foreground">Refused by {request.refused.by} on {shortDate(request.refused.at)}: {request.refused.reason}</p>}

      {request.check && (
        <div className="rounded-[2px] border border-border p-3" data-testid="payoff-check">
          <p className="text-xs font-medium">{request.requester?.kind === "borrower" ? "Is it the borrower?" : "The borrower's written authorization"}</p>
          <p className={`mt-1 text-xs ${request.check.status === "pending" ? "text-warn" : "text-good"}`}>{request.check.status === "accepted" ? `Checked${request.check.by ? ` by ${request.check.by}` : ""}. ` : ""}{request.check.note}</p>
          {request.check.fileName && (request.check.documentId && !local ? <a className="mt-1 inline-block text-xs text-link underline" href={`/api/documents/${request.check.documentId}?view=1`} target="_blank" rel="noreferrer" data-testid="payoff-authorization-file">Open {request.check.fileName}</a> : <p className="mt-1 text-xs text-muted-foreground">{request.check.fileName}</p>)}
          {request.check.status === "pending" && open && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 basis-48"><span className="label">{request.requester?.kind === "borrower" ? "How you confirmed it (optional)" : "What you checked (optional)"}</span><input className="desk-input" data-testid="payoff-check-note" maxLength={300} value={checkNote} placeholder={request.requester?.kind === "borrower" ? "Called the number on file" : "Signed by the managing member"} onChange={(event) => setCheckNote(event.target.value)} /></label>
              <button type="button" className={`btn-primary ${small}`} data-testid="payoff-check-accept" disabled={busy} onClick={() => void run({ t: "acceptPayoffCheck", payoffId: request.id, note: checkNote.trim(), by: viewerName })}>It checks out</button>
            </div>
          )}
        </div>
      )}

      {stale && (
        <div className="rounded-md bg-bad/10 p-3 text-xs text-bad" data-testid="payoff-stale">
          <p className="font-medium">Letter {stale.letter.number} is out of date: it says {usd(stale.letter.total, 2)}, and the payoff through {stale.letter.goodThrough} is now {usd(stale.now.total, 2)}.</p>
          <p className="mt-1">{letterChanges(stale.letter, stale.now).join(" · ")}</p>
          <p className="mt-1">We&apos;re held to a letter we sent. A correction only replaces it if they get it by 3 p.m. their time at least one business day before they pay, so send it now.</p>
        </div>
      )}

      {(request.letters ?? []).length > 0 && (
        <ul className="divide-y divide-border rounded-[2px] border border-border" data-testid="payoff-letters">
          {[...(request.letters ?? [])].reverse().map((letter) => {
            const delivery = deliveryLine(letter, local);
            return (
              <li key={letter.number} className="space-y-0.5 p-2" data-testid="letter-row">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Letter {letter.number}{letter.replaces ? " (corrected)" : ""}: {usd(letter.total, 2)} through {letter.goodThrough}</span><a className="text-xs text-link underline" href={pdf(letter)} target="_blank" rel="noreferrer" data-testid="letter-pdf-link">PDF</a></div>
                <p className="text-xs text-muted-foreground">Issued {letter.issuedOn}{letter.issuedBy ? ` by ${letter.issuedBy}` : ""} · {usd(letter.perDiem, 2)} a day after{letter.reason ? ` · ${letter.reason}` : ""}</p>
                <p className={`text-xs ${delivery.tone}`} data-testid="letter-delivery">{delivery.text}</p>
              </li>
            );
          })}
        </ul>
      )}

      {open && request.check?.status !== "pending" && SERVICED.includes(deal.status) && latest && !stale && !again && (
        <button type="button" className={`btn-ghost ${small}`} data-testid="payoff-new-letter" onClick={() => setAgain(true)}>Send a new letter</button>
      )}
      {open && request.check?.status !== "pending" && SERVICED.includes(deal.status) && (!latest || stale || again) && (
        <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="payoff-issue">
          <p className="text-xs font-medium">{latest ? (stale ? "Send a corrected letter" : "Send a new letter") : "Send the payoff letter"}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Good through</span><input className="desk-input" type="date" data-testid="payoff-good-through" min={today || undefined} max={today ? addDays(today, MAX_GOOD_THROUGH_DAYS) : undefined} value={wanted} onChange={(event) => setGoodThrough(event.target.value)} /></label>
            {latest && <label className="block min-w-0 flex-1 basis-48"><span className="label">Why a new letter{stale ? " (optional)" : ""}</span><input className="desk-input" data-testid="payoff-reason" maxLength={300} value={reason} placeholder={stale ? "Corrected: what changed is added for you" : "They asked for a later date"} onChange={(event) => setReason(event.target.value)} /></label>}
          </div>
          {figures && (
            <dl className="space-y-1 text-xs" data-testid="payoff-preview">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Principal</dt><dd>{usd(figures.principal, 2)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Interest, {figures.interestDays} days at {figures.rate.toFixed(2)}%</dt><dd>{usd(figures.accrued, 2)}</dd></div>
              {figures.defaultAccrued > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Default interest, {figures.defaultDays} days</dt><dd>{usd(figures.defaultAccrued, 2)}</dd></div>}
              {figures.fees > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Late fees</dt><dd>{usd(figures.fees, 2)}</dd></div>}
              {figures.credit > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Credit held</dt><dd>{usd(-figures.credit, 2)}</dd></div>}
              <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>Payoff through {wanted}</dt><dd data-testid="payoff-preview-total">{usd(figures.total, 2)}</dd></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><dt>Each day after</dt><dd>{usd(figures.perDiem, 2)}</dd></div>
            </dl>
          )}
          {problem && <p className="text-xs text-warn">{problem}</p>}
          <p className="text-xs text-muted-foreground">{request.requester?.email ? `It's emailed to ${request.requester.email} as a PDF with a link.` : "It's emailed to the borrower's sign-in address as a PDF with a link."}{latest && request.requester?.kind !== "borrower" && request.requester ? " A copy of a correction goes to the borrower too." : ""} No wire instructions are ever in it.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`btn-primary ${small}`} data-testid="issue-payoff-letter" disabled={busy || Boolean(problem)} onClick={() => void issue()}>{busy ? "Sending…" : latest ? (stale ? "Send the corrected letter" : "Send the new letter") : "Send the letter"}</button>
            {request.status === "requested" && !refusing && <button type="button" className={`btn-ghost ${small}`} data-testid="payoff-refuse" onClick={() => setRefusing(true)}>Can&apos;t send it</button>}
            {again && <button type="button" className={`btn-ghost ${small}`} onClick={() => { setAgain(false); setReason(""); setGoodThrough(""); }}>Cancel</button>}
          </div>
        </div>
      )}
      {request.status === "requested" && (refusing || request.check?.status === "pending") && (
        <div>
          {!refusing ? <button type="button" className={`btn-ghost ${small}`} data-testid="payoff-refuse" onClick={() => setRefusing(true)}>Can&apos;t send it</button> : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 basis-60"><span className="label">Why not (they&apos;re emailed this)</span><input className="desk-input" data-testid="payoff-refuse-reason" maxLength={500} value={refusal} placeholder="The authorization isn't signed by the borrower" onChange={(event) => setRefusal(event.target.value)} /></label>
              <button type="button" className={`btn-primary ${small}`} data-testid="payoff-refuse-confirm" disabled={busy || !refusal.trim()} onClick={() => void run({ t: "refusePayoff", payoffId: request.id, reason: refusal.trim(), by: viewerName }).then((done) => done && setRefusing(false))}>Refuse the request</button>
              <button type="button" className={`btn-ghost ${small}`} onClick={() => setRefusing(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type LogDraft = { kind: RequesterKind; name: string; company: string; email: string; phone: string; fileNumber: string; channel: (typeof LOGGED_CHANNELS)[number]; sentOn: string; goodThrough: string; authorized: boolean; note: string };
const blankLog: LogDraft = { kind: "title", name: "", company: "", email: "", phone: "", fileNumber: "", channel: "email", sentOn: "", goodThrough: "", authorized: false, note: "" };
const SENT_LABEL = { email: "Sent on", fax: "Sent on", mail: "Postmarked on", courier: "Delivered on" };

/** A request that came some other way, logged with the day it was sent, so its 10 days run from the right day. */
function LogPayoffRequest({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [draft, setDraft] = useState<LogDraft>(blankLog);
  const [busy, setBusy] = useState(false);
  const put = (changes: Partial<LogDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const sentOn = draft.sentOn || today;
  const received = sentOn ? receivedOnFor(draft.channel, sentOn) : "";
  const third = draft.kind !== "borrower";
  const problem = !draft.name.trim() ? "Add who asked." : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ? "Add the email the letter goes to." : draft.kind === "title" && !draft.company.trim() ? "Add the title company or law firm." : today ? goodThroughProblem(draft.goodThrough, today) : null;
  const save = async () => {
    setBusy(true);
    const requester = { kind: draft.kind, name: draft.name.trim(), email: draft.email.trim().toLowerCase(), ...(draft.company.trim() ? { company: draft.company.trim() } : {}), ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}), ...(draft.fileNumber.trim() ? { fileNumber: draft.fileNumber.trim() } : {}) };
    const done = await dispatch({ t: "logPayoffRequest", dealId: deal.id, goodThrough: draft.goodThrough, channel: draft.channel, sentOn, requester, authorized: third && draft.authorized, note: draft.note, by: viewerName });
    setBusy(false);
    if (done) { setDraft(blankLog); onDone(); }
  };
  const field = (label: string, key: "name" | "company" | "email" | "phone" | "fileNumber", type = "text") => <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" type={type} data-testid={`log-payoff-${key}`} maxLength={200} value={draft[key]} onChange={(event) => put({ [key]: event.target.value })} /></label>;
  return (
    <div className="space-y-2 rounded-[2px] border border-border p-3 text-sm" data-testid="log-payoff-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block min-w-0"><span className="label">Who asked</span><select className="desk-input" data-testid="log-payoff-kind" value={draft.kind} onChange={(event) => put({ kind: event.target.value as RequesterKind })}>{Object.entries(REQUESTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {field("Their name", "name")}
        {third && field(draft.kind === "title" ? "Title company or law firm" : "Company (optional)", "company")}
        {field("Email the letter goes to", "email", "email")}
        {field("Phone (optional)", "phone", "tel")}
        {draft.kind === "title" && field("Their file number (optional)", "fileNumber")}
        <label className="block min-w-0"><span className="label">How it came</span><select className="desk-input" data-testid="log-payoff-channel" value={draft.channel} onChange={(event) => put({ channel: event.target.value as LogDraft["channel"] })}>{LOGGED_CHANNELS.map((key) => <option key={key} value={key}>{CHANNELS[key]}</option>)}</select></label>
        <label className="block min-w-0"><span className="label">{SENT_LABEL[draft.channel]}</span><input className="desk-input" type="date" data-testid="log-payoff-sent-on" max={today || undefined} value={sentOn} onChange={(event) => put({ sentOn: event.target.value })} /></label>
        <label className="block min-w-0"><span className="label">Good through (asked for)</span><input className="desk-input" type="date" data-testid="log-payoff-good-through" min={today || undefined} max={today ? addDays(today, MAX_GOOD_THROUGH_DAYS) : undefined} value={draft.goodThrough} onChange={(event) => put({ goodThrough: event.target.value })} /></label>
      </div>
      {received && <p className="text-xs text-muted-foreground" data-testid="log-payoff-received">Counts as received {received}{draft.channel === "mail" ? " (five business days after the postmark)" : received !== sentOn ? " (the next business day)" : ""}; the letter is due by {letterDueBy(received)}.</p>}
      {third && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="log-payoff-authorized" checked={draft.authorized} onChange={(event) => put({ authorized: event.target.checked })} /><span>The borrower&apos;s signed authorization came with it. Upload it to the loan&apos;s Documents tab.</span></label>}
      <label className="block"><span className="label">Note (optional)</span><input className="desk-input" maxLength={1000} value={draft.note} onChange={(event) => put({ note: event.target.value })} /></label>
      {problem && draft.name && <p className="text-xs text-warn">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`btn-primary ${small}`} data-testid="save-log-payoff" disabled={busy || Boolean(problem)} onClick={() => void save()}>Log the request</button>
        <button type="button" className={`btn-ghost ${small}`} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/** The loan's payoff requests and letters, newest first, and a way to log one that came by email, fax, mail or courier. */
export function PayoffRequests({ deal }: { deal: Deal }) {
  const { s } = useStore();
  const [logging, setLogging] = useState(false);
  const requests = s.payoffs.filter((payoff) => payoff.dealId === deal.id);
  const serviced = SERVICED.includes(deal.status);
  if (!serviced && !requests.length) return null;
  return (
    <Section title={`Payoff letters (${requests.length})`}>
      <div className="space-y-4" data-testid="payoff-requests">
        <p className="text-xs text-muted-foreground">Florida gives 10 days from when a request is received to send the letter (Fla. Stat. 701.04). Someone other than the borrower needs the borrower&apos;s written authorization. Requests by email, fax, mail or courier are logged here with the day they were sent.</p>
        {requests.map((request) => <div key={request.id} className="border-t border-border pt-3 first:border-0 first:pt-0"><PayoffRequestCard request={request} deal={deal} /></div>)}
        {serviced && !logging && <button type="button" className={`btn-ghost ${small}`} data-testid="log-payoff" onClick={() => setLogging(true)}>Log a mailed or emailed request</button>}
        <Reveal open={logging}><LogPayoffRequest deal={deal} onDone={() => setLogging(false)} /></Reveal>
      </div>
    </Section>
  );
}
