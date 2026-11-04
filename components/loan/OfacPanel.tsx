"use client";
import { useState } from "react";
import { screenLoan } from "@/actions/book";
import type { Deal } from "@/lib/mockData";
import { latestScreening, OFAC, screeningSubjects, unscreenedNames } from "@/lib/ofac";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate } from "@/components/ui";

const ROLE = { entity: "Borrowing company", borrower: "Borrower", guarantor: "Guarantor", principal: "Owner or officer" } as const;
const STATUS = { clear: ["Clear", "green"], cleared: ["Cleared after review", "green"], review: ["Possible match", "rose"], match: ["Confirmed match", "rose"] } as const;

/**
 * The loan's sanctions screening (Spec A7, 31 CFR 501): who was checked, against which list, what came close, and the
 * review of any possible match. Nothing moves on a loan with an open or confirmed match.
 */
export function OfacPanel({ deal }: { deal: Deal }) {
  const { dispatch, applyReply, local, viewerName } = useStore();
  const latest = latestScreening(deal);
  const missing = unscreenedNames(deal);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<"cleared" | "match" | "">("");
  const [reason, setReason] = useState("");
  const screen = async () => {
    setBusy(true);
    // The demo has no list to check against, so its screening comes back clear.
    if (local) {
      const at = new Date().toISOString();
      await dispatch({ t: "recordScreening", dealId: deal.id, screening: { id: `ofac${Date.now().toString(36)}`, at, by: viewerName, checkedAt: at, list: latest?.list ?? { fetchedAt: at, names: 0 }, subjects: screeningSubjects(deal).map((subject) => ({ ...subject, hits: [] })), status: "clear" } });
    } else applyReply(await screenLoan(deal.id));
    setBusy(false);
  };
  const decide = async () => {
    if (latest && decision && await dispatch({ t: "decideScreening", dealId: deal.id, screeningId: latest.id, decision, reason: reason.trim(), by: viewerName })) { setDecision(""); setReason(""); }
  };
  const earlier = (deal.screenings ?? []).slice(0, -1).reverse();
  return (
    <Section title="Sanctions screening (OFAC)" right={latest ? <Badge tone={STATUS[latest.status][1]}>{STATUS[latest.status][0]}</Badge> : <Badge tone="amber">Not screened</Badge>}>
      <div className="space-y-3 text-sm" data-testid="ofac-panel">
        {latest?.status === "match" && <p className="rounded-md bg-bad/10 p-2 text-bad" data-testid="ofac-match">Confirmed sanctions match. Don&apos;t move or return any money on this loan, and call counsel: a blocked or rejected transaction is reported to OFAC within 10 business days.</p>}
        {latest ? (
          <>
            <p className="text-muted-foreground" data-testid="ofac-checked">Last checked {shortDate(latest.checkedAt)} by {latest.by}, against Treasury&apos;s list downloaded {shortDate(latest.list.fetchedAt)}{latest.list.names ? ` (${latest.list.names.toLocaleString("en-US")} names)` : ""}. Money goes out only on a check from the last {OFAC.freshDays} days.</p>
            <ul className="divide-y divide-border" data-testid="ofac-subjects">
              {latest.subjects.map((subject) => (
                <li key={subject.name} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span>{subject.name} <span className="text-xs text-muted-foreground">· {ROLE[subject.role]}</span></span>{subject.hits.length ? <Badge tone="rose">{subject.hits.length} close name{subject.hits.length === 1 ? "" : "s"}</Badge> : <Badge tone="green">No match</Badge>}</div>
                  {subject.hits.map((hit) => <p key={hit.uid} className="mt-0.5 text-xs text-bad" data-testid="ofac-hit">{hit.name} · {hit.type} · {hit.program} · {Math.round(hit.score * 100)}% similar · entry {hit.uid}</p>)}
                </li>
              ))}
            </ul>
          </>
        ) : <p className="text-muted-foreground">The borrowing company, the borrower and each guarantor are checked against Treasury&apos;s sanctions list when the application arrives and every night after.</p>}
        {missing.length > 0 && <p className="text-xs text-warn" data-testid="ofac-missing">Not checked yet: {missing.join(", ")}.</p>}
        {latest?.status === "review" && (
          <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="ofac-review">
            <p className="text-xs text-muted-foreground">Compare the listed party with yours: date of birth, address, nationality, ID numbers, and for a company, its owners and where it&apos;s registered. A shared name alone isn&apos;t a match. Don&apos;t tell the borrower about the review.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="ofac-false-positive" className={`rounded-[2px] border px-3 py-1.5 text-sm font-semibold ${decision === "cleared" ? "border-primary bg-active" : "border-border"}`} onClick={() => setDecision("cleared")}>Not the same party</button>
              <button type="button" data-testid="ofac-confirm" className={`rounded-[2px] border px-3 py-1.5 text-sm font-semibold ${decision === "match" ? "border-bad bg-bad/10 text-bad" : "border-border"}`} onClick={() => setDecision("match")}>It&apos;s a match</button>
            </div>
            <label className="block"><span className="label">What you compared, for the record</span><textarea className="desk-input min-h-16" data-testid="ofac-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Listed person born 1961 in Tehran; our borrower born 1988 in Miami, US passport checked" /></label>
            <button type="button" className={decision === "match" ? "btn-primary bg-bad!" : "btn-primary"} data-testid="ofac-decide" disabled={!decision || reason.trim().length < 10} onClick={decide}>{decision === "match" ? "Confirm the match and stop the loan" : "Clear it"}</button>
          </div>
        )}
        <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="ofac-screen" disabled={busy} onClick={screen}>{busy ? "Screening…" : latest ? "Screen again now" : "Screen now"}</button>
        {earlier.length > 0 && <ul className="space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">{earlier.map((item) => <li key={item.id}>{shortDate(item.at)}: {STATUS[item.status][0].toLowerCase()}{item.decided ? `, by ${item.decided.by}: ${item.decided.reason}` : ""}</li>)}</ul>}
        {latest?.decided && <p className="text-xs text-muted-foreground" data-testid="ofac-decided">Reviewed by {latest.decided.by} on {shortDate(latest.decided.at)}: {latest.decided.reason}</p>}
      </div>
    </Section>
  );
}
