"use client";
import { useState } from "react";
import { screenFirmNow } from "@/actions/book";
import { Badge, shortDate } from "@/components/ui";
import type { LoanBuyer, Partner, Screening } from "@/lib/mockData";
import { firmSubjects, OFAC } from "@/lib/ofac";
import { useStore } from "@/lib/store";

const STATUS = { clear: ["Clear", "green"], cleared: ["Cleared after review", "green"], review: ["Possible match", "rose"], match: ["Confirmed match", "rose"] } as const;

/** The review of a possible sanctions match on a firm: someone with clear_ofac compares the listing and decides, for the record. */
export function FirmMatchReview({ kind, firmId, screening }: { kind: "partner" | "buyer" | "broker"; firmId: string; screening: Screening }) {
  const { dispatch, viewerName } = useStore();
  const [decision, setDecision] = useState<"cleared" | "match" | "">("");
  const [reason, setReason] = useState("");
  const decide = async () => { if (decision && await dispatch({ t: "decideFirmScreening", kind, firmId, screeningId: screening.id, decision, reason: reason.trim(), by: viewerName })) { setDecision(""); setReason(""); } };
  return (
    <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="firm-ofac-review">
      <ul className="space-y-0.5 text-xs text-bad">{screening.subjects.flatMap((subject) => subject.hits.map((hit) => <li key={`${subject.name}-${hit.uid}`} data-testid="firm-ofac-hit">{subject.name} ~ {hit.name} · {hit.type} · {hit.program} · {Math.round(hit.score * 100)}% similar · entry {hit.uid}</li>))}</ul>
      <p className="text-xs text-muted-foreground">Compare the listed party with this firm: where it&apos;s registered, its owners, addresses and ID numbers. A shared name alone isn&apos;t a match. Don&apos;t tell the firm about the review.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="firm-ofac-clear" className={`rounded-[2px] border px-3 py-1.5 text-sm font-semibold ${decision === "cleared" ? "border-primary bg-active" : "border-border"}`} onClick={() => setDecision("cleared")}>Not the same party</button>
        <button type="button" data-testid="firm-ofac-confirm" className={`rounded-[2px] border px-3 py-1.5 text-sm font-semibold ${decision === "match" ? "border-bad bg-bad/10 text-bad" : "border-border"}`} onClick={() => setDecision("match")}>It&apos;s a match</button>
      </div>
      <label className="block"><span className="label">What you compared, for the record</span><textarea className="desk-input min-h-16" data-testid="firm-ofac-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Listed company registered in Panama in 2019; ours is a Florida LLC formed 2012, owners checked" /></label>
      <button type="button" className={decision === "match" ? "btn-primary bg-bad!" : "btn-primary"} data-testid="firm-ofac-decide" disabled={!decision || reason.trim().length < 10} onClick={() => void decide()}>{decision === "match" ? "Confirm the match and stop all money" : "Clear it"}</button>
    </div>
  );
}

/**
 * A partner lender's or loan buyer's sanctions screening: the firm, its owners and officers, the people who sign in for it
 * and the names on its tax form, checked when it's saved and every night. A possible match holds its teasers, bids,
 * sales and money until it's reviewed.
 */
export function FirmScreening({ kind, firm }: { kind: "partner" | "buyer"; firm: Partner | LoanBuyer }) {
  const { dispatch, applyReply, local, viewerName } = useStore();
  const [busy, setBusy] = useState(false);
  const screening = firm.screening;
  const screen = async () => {
    setBusy(true);
    // The demo has no list to check against, so its screening comes back clear.
    if (local) {
      const at = new Date().toISOString();
      await dispatch({ t: "firmScreened", kind, firmId: firm.id, screening: { id: `ofac${Date.now().toString(36)}`, at, by: viewerName, checkedAt: at, list: screening?.list ?? { fetchedAt: at, names: 0 }, subjects: firmSubjects(firm).map((subject) => ({ ...subject, hits: [] })), status: "clear" } });
    } else applyReply(await screenFirmNow(kind, firm.id));
    setBusy(false);
  };
  return (
    <div className="space-y-2 text-xs" data-testid="firm-ofac">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">OFAC</span>
        {screening ? <Badge tone={STATUS[screening.status][1]}>{STATUS[screening.status][0]}</Badge> : <Badge tone="amber">Not screened</Badge>}
        {screening && <span className="text-muted-foreground">checked {shortDate(screening.checkedAt)}: {screening.subjects.length} name{screening.subjects.length === 1 ? "" : "s"}</span>}
        <button type="button" className="min-h-9 text-link underline underline-offset-2" data-testid="firm-screen" disabled={busy} onClick={() => void screen()}>{busy ? "Screening…" : screening ? "Screen again" : "Screen now"}</button>
      </div>
      {!screening && <p className="text-warn">Its bids can&apos;t be accepted and its money can&apos;t be taken until it&apos;s screened. Money moves only on a check from the last {OFAC.freshDays} days.</p>}
      {screening?.status === "match" && <p className="rounded-[2px] bg-bad/10 p-2 text-bad" data-testid="firm-ofac-match">Confirmed sanctions match. Don&apos;t take, move or return any of its money, and call counsel: it&apos;s reported to OFAC within 10 business days.</p>}
      {screening?.status === "review" && <FirmMatchReview kind={kind} firmId={firm.id} screening={screening} />}
      {screening?.decided && <p className="text-muted-foreground" data-testid="firm-ofac-decided">Reviewed by {screening.decided.by} on {shortDate(screening.decided.at)}: {screening.decided.reason}</p>}
    </div>
  );
}
