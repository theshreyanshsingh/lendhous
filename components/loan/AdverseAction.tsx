"use client";
import { useState } from "react";
import { sendAdverseNotice } from "@/actions/adverse-action";
import { Badge, Section, shortDate, usd } from "@/components/ui";
import { isLarge, keepUntil, noticeOwed, REASON_TEXT, reasonsProblem, REQUEST_DAYS, requestProblem, REVENUE_LIMIT, revenueProblem } from "@/lib/adverse-action";
import type { Deal, NoticeSent } from "@/lib/mockData";
import { daysBetween } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
const sentLine = (label: string, sent: NoticeSent) => `${label} ${sent.method === "email" ? `emailed to ${sent.to.join(", ") || "the borrower"}${sent.result && sent.result !== "sent" ? (sent.result === "logged" ? " (mail isn't set up here, so it was only logged: mail it too)" : " (it couldn't be emailed: mail it)") : ""}` : "mailed"} on ${sent.sentOn}${sent.by ? ` by ${sent.by}` : ""}.`;

/**
 * When the application was complete and the business's revenue, which together set Reg B's notice deadline if it's
 * declined (12 CFR 1002.9(a)(1), (a)(3)). Signing off the credit review marks it complete if nobody has.
 */
export function ApplicationRecord({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [on, setOn] = useState("");
  const [amount, setAmount] = useState(deal.revenue ? String(deal.revenue.amount) : "");
  const [year, setYear] = useState(String(deal.revenue?.year ?? ""));
  const [editing, setEditing] = useState(!deal.revenue);
  const value = Number(amount.replace(/[^0-9.]/g, ""));
  const fiscal = Number(year) || (today ? Number(today.slice(0, 4)) - 1 : 0);
  const problem = today && amount ? revenueProblem(value, fiscal, today) : null;
  return (
    <Section title="Application record (Reg B)">
      <div className="space-y-3 text-sm" data-testid="application-record">
        <div>
          <p className="font-medium">Complete application</p>
          {deal.completed ? <p className="text-xs text-muted-foreground" data-testid="application-complete">Complete as of {deal.completed.on}{deal.completed.by ? `, marked by ${deal.completed.by}` : ""}. If it's declined, the notice is due 30 days from then.</p> : (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">Mark it once you have everything you normally need to decide: Reg B&apos;s 30 days to answer start then. Signing off the credit review marks it if nobody has.</p>
              <label className="block"><span className="label">Complete as of</span><input className="desk-input" type="date" data-testid="complete-on" max={today || undefined} value={on || today} onChange={(event) => setOn(event.target.value)} /></label>
              <button type="button" className={`btn-ghost ${small}`} data-testid="mark-complete" onClick={() => void dispatch({ t: "markApplicationComplete", dealId: deal.id, on: on || today, by: viewerName })}>Mark complete</button>
            </div>
          )}
        </div>
        <div className="border-t border-border pt-3">
          <p className="font-medium">Gross revenue last year</p>
          {deal.revenue && !editing ? (
            <p className="text-xs text-muted-foreground" data-testid="revenue-on-file">{usd(deal.revenue.amount)} for {deal.revenue.year}: {isLarge(deal.revenue) ? "over" : "not over"} $1 million. <button type="button" className="text-link underline" onClick={() => setEditing(true)}>Change it</button></p>
          ) : (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <label className="block w-40"><span className="label">The business&apos;s revenue ($)</span><input className="desk-input" inputMode="numeric" data-testid="revenue-amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
              <label className="block w-24"><span className="label">For year</span><input className="desk-input" inputMode="numeric" data-testid="revenue-year" value={year || (fiscal ? String(fiscal) : "")} onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, ""))} /></label>
              <button type="button" className={`btn-ghost ${small}`} data-testid="save-revenue" disabled={!amount || Boolean(problem)} onClick={async () => { if (await dispatch({ t: "saveRevenue", dealId: deal.id, amount: value, year: fiscal, by: viewerName })) setEditing(false); }}>Save</button>
              <p className="w-full text-xs text-muted-foreground">{problem ?? `Over ${usd(REVENUE_LIMIT)}, a decline notice can come in a reasonable time with the reasons only if they ask. Unknown counts as ${usd(REVENUE_LIMIT)} or less.`}</p>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

/**
 * The decline notice (12 CFR 1002.9): when it's due, the specific reasons, sending it by email or marking it mailed, a
 * larger business's written request for the reasons and the statement that answers it, how long the records are kept,
 * and a legal hold.
 */
export function AdverseActionPanel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName, local, applyReply } = useStore();
  const today = useServiceDay();
  const action = deal.adverseAction!;
  const owed = noticeOwed(deal);
  const editable = action.large ? !action.statement : !action.notice;
  const [reasons, setReasons] = useState(action.reasons.length ? [...action.reasons] : [""]);
  const [received, setReceived] = useState("");
  const [hold, setHold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const given = reasons.map((item) => item.trim()).filter(Boolean);
  const problem = reasonsProblem(reasons);
  const saved = JSON.stringify(given) === JSON.stringify(action.reasons);
  const needsReasons = owed?.kind === "statement" || (owed?.kind === "notice" && !action.large);
  const until = keepUntil(deal);
  const left = owed && today ? daysBetween(today, owed.dueOn) : null;
  // A loan started for a client who hasn't been linked to an account has no email to send to.
  const unlinked = !local && deal.borrowerId.startsWith("client-");
  const pdf = (kind: "notice" | "statement") => (local ? "/api/adverse-action/demo" : `/api/adverse-action/${deal.id}?kind=${kind}`);
  const send = async (kind: "notice" | "statement", method: "email" | "mail") => {
    setBusy(true); setError("");
    if (local) await dispatch({ t: "recordAdverseNotice", dealId: deal.id, kind, method, to: method === "email" ? ["(demo)"] : [], ...(method === "email" ? { result: "logged" as const } : {}), by: viewerName });
    else { const reply = await sendAdverseNotice(deal.id, kind, method).catch(() => ({ error: "That didn't go through. Try again." })); if (reply.error) setError(reply.error); else applyReply(reply); }
    setBusy(false);
  };
  return (
    <div className="mt-3 space-y-3 rounded-[2px] border border-border p-3 text-sm" data-testid="adverse-action">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Decline notice (Reg B)</p>
        <Badge tone={owed ? (left !== null && left < 0 ? "rose" : "amber") : "green"}>{owed ? (owed.kind === "notice" ? "Notice to send" : "Reasons to send") : "Sent"}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{action.large ? `The business had over ${usd(REVENUE_LIMIT)} in revenue, so the notice comes in a reasonable time and the specific reasons only if they ask in writing within ${REQUEST_DAYS} days (12 CFR 1002.9(a)(3)(ii)).` : `${deal.revenue ? `The business had ${usd(REVENUE_LIMIT)} or less in revenue` : "The business's revenue isn't recorded, so the stricter rule applies"}: a written notice with the specific reasons within 30 days of the completed application (12 CFR 1002.9(a)(1)).`}</p>
      {owed && <p className={`text-xs ${left !== null && left < 0 ? "text-bad" : "text-warn"}`} data-testid="notice-due">{owed.kind === "notice" ? "Notice" : "Statement of reasons"} due by {owed.dueOn}{left !== null ? ` (${left < 0 ? `${-left} days late` : left === 0 ? "today" : `${left} days left`})` : ""}.</p>}

      {editable && (
        <div className="space-y-2" data-testid="notice-reasons">
          <p className="text-xs font-medium">The principal reasons, specific to this application (at most four)</p>
          {reasons.map((reason, index) => (
            <div key={index} className="flex gap-2">
              <input className="desk-input min-w-0 flex-1" data-testid={`notice-reason-${index}`} maxLength={300} list="decline-reasons" value={reason} onChange={(event) => setReasons(reasons.map((item, at) => (at === index ? event.target.value : item)))} />
              {reasons.length > 1 && <button type="button" className={`btn-ghost ${small}`} aria-label="Remove this reason" onClick={() => setReasons(reasons.filter((_, at) => at !== index))}>×</button>}
            </div>
          ))}
          <datalist id="decline-reasons">{Object.values(REASON_TEXT).filter(Boolean).map((text) => <option key={text} value={text} />)}</datalist>
          <div className="flex flex-wrap gap-2">
            {reasons.length < 4 && <button type="button" className={`btn-ghost ${small}`} onClick={() => setReasons([...reasons, ""])}>Add a reason</button>}
            <button type="button" className={`btn-ghost ${small}`} data-testid="save-reasons" disabled={saved || Boolean(problem)} onClick={() => void dispatch({ t: "saveAdverseReasons", dealId: deal.id, reasons: given, by: viewerName })}>Save the reasons</button>
          </div>
          {problem && <p className="text-xs text-warn">{problem}</p>}
        </div>
      )}

      {owed && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <a className="text-xs text-link underline" href={pdf(owed.kind)} target="_blank" rel="noreferrer" data-testid="notice-preview">Preview the letter (PDF)</a>
            {!unlinked && <button type="button" className={`btn-primary ${small}`} data-testid="email-notice" disabled={busy || (needsReasons && (!saved || Boolean(reasonsProblem(action.reasons))))} onClick={() => void send(owed.kind, "email")}>{busy ? "Sending…" : "Email it to the borrower"}</button>}
            <button type="button" className={`btn-ghost ${small}`} data-testid="mail-notice" disabled={busy || (needsReasons && (!saved || Boolean(reasonsProblem(action.reasons))))} onClick={() => void send(owed.kind, "mail")}>I mailed it</button>
          </div>
          {unlinked && <p className="text-xs text-muted-foreground">The borrower has no portal account yet, so download the letter, mail it, and mark it mailed.</p>}
          {needsReasons && !saved && <p className="text-xs text-warn">Save the reasons first.</p>}
          {error && <p className="text-xs text-bad" role="alert">{error}</p>}
        </div>
      )}
      {action.notice && <p className="text-xs text-good" data-testid="notice-sent">{sentLine("Notice", action.notice)} <a className="text-link underline" href={pdf("notice")} target="_blank" rel="noreferrer">Open it</a></p>}

      {action.large && action.notice && !action.request && (
        <div className="flex flex-wrap items-end gap-2" data-testid="log-request">
          <label className="block"><span className="label">Their written request for the reasons came in on</span><input className="desk-input" type="date" data-testid="request-received" max={today || undefined} value={received} onChange={(event) => setReceived(event.target.value)} /></label>
          <button type="button" className={`btn-ghost ${small}`} data-testid="save-request" disabled={!received || Boolean(today && requestProblem(action, received, today))} onClick={() => void dispatch({ t: "recordReasonsRequest", dealId: deal.id, receivedOn: received, by: viewerName })}>Log the request</button>
          {received && today && requestProblem(action, received, today) && <p className="w-full text-xs text-warn">{requestProblem(action, received, today)}</p>}
        </div>
      )}
      {action.request && <p className="text-xs text-muted-foreground">They asked for the reasons in writing on {action.request.receivedOn}; the statement is due by {action.request.dueOn}.</p>}
      {action.statement && <p className="text-xs text-good">{sentLine("Statement of reasons", action.statement)}</p>}

      <div className="border-t border-border pt-2 text-xs">
        <p className="text-muted-foreground" data-testid="keep-until">{deal.legalHold ? `On legal hold since ${shortDate(deal.legalHold.at)} (${deal.legalHold.reason}): every record is kept until it's lifted (12 CFR 1002.12(b)(4)).` : until ? `Keep this application and the notice until at least ${until} (12 CFR 1002.12(b)). LendHous keeps loan files longer anyway.` : "Records are kept for 12 months from the notice (12 CFR 1002.12(b))."}</p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          {!deal.legalHold && <label className="block min-w-0 flex-1 basis-48"><span className="label">Legal hold: what's pending (owners)</span><input className="desk-input" data-testid="hold-reason" maxLength={1000} value={hold} onChange={(event) => setHold(event.target.value)} /></label>}
          <button type="button" className={`btn-ghost ${small}`} data-testid={deal.legalHold ? "lift-hold" : "place-hold"} disabled={!deal.legalHold && !hold.trim()} onClick={async () => { if (await dispatch({ t: "setLegalHold", dealId: deal.id, reason: deal.legalHold ? "" : hold.trim(), by: viewerName })) setHold(""); }}>{deal.legalHold ? "Lift the legal hold" : "Place a legal hold"}</button>
        </div>
      </div>
    </div>
  );
}
