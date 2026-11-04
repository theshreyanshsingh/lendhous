"use client";
import { useRef, useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section, shortDate } from "@/components/ui";
import { addProblem, blockingConditions, CATEGORIES, CONDITION_STATUS, isDone, libraryOf, missingStandard, OWNERS, overdue, type ConditionInput } from "@/lib/conditions";
import type { ConditionCategory, ConditionOwner, Deal, LoanCondition } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";

const small = "h-9! px-3! text-xs!";
export const conditionTone = (status: LoanCondition["status"]) => (status === "cleared" ? "green" : status === "submitted" ? "blue" : status === "waived" ? "slate" : "amber") as "green";

/** Sends a file in for a condition, which marks it submitted. */
export function ConditionUpload({ dealId, condition, label = "Upload" }: { dealId: string; condition: LoanCondition; label?: string }) {
  const { uploadCondition } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  if (isDone(condition)) return null;
  return (
    <>
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" data-testid={`condition-file-${condition.id}`} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setSending(true);
        await uploadCondition(dealId, condition.id, file);
        setSending(false);
      }} />
      <button type="button" className={`btn-ghost ${small}`} data-testid="condition-upload" disabled={sending} onClick={() => input.current?.click()}>{sending ? "Uploading…" : label}</button>
    </>
  );
}

/** The files sent for a condition, each opened through the signed-in route (or named only, in the demo). */
export function ConditionFiles({ condition, local }: { condition: LoanCondition; local: boolean }) {
  if (!condition.files.length) return null;
  return <ul className="text-xs">{condition.files.map((file, n) => <li key={n}>{file.documentId && !local ? <a className="text-link underline" href={`/api/documents/${file.documentId}?view=1`} target="_blank" rel="noreferrer">{file.fileName}</a> : file.fileName}<span className="text-muted-foreground"> · {shortDate(file.at)}{file.by ? ` · ${file.by}` : ""}</span></li>)}</ul>;
}

type Draft = { templateId: string; title: string; detail: string; category: ConditionCategory; owner: ConditionOwner; needsUpload: boolean; dueOn: string };
const blank: Draft = { templateId: "", title: "", detail: "", category: "prior_to_funding", owner: "borrower", needsUpload: true, dueOn: "" };

/**
 * The loan's conditions for the team (Spec A10): what's needed before the loan documents, before funding and after
 * closing, who it's for and when it's due. Clearing and sending back take condition authority; waiving takes its own.
 */
export function ConditionsPanel({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName, local } = useStore();
  const today = useServiceDay();
  const [acting, setActing] = useState<{ id: string; kind: "clear" | "return" | "waive" } | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const conditions = deal.conditions ?? [];
  const library = missingStandard(deal, libraryOf(s));
  const blocking = blockingConditions(deal).length;
  const input: ConditionInput = draft.templateId ? { ...(library.find((item) => item.id === draft.templateId) ?? blank), templateId: draft.templateId, ...(draft.dueOn ? { dueOn: draft.dueOn } : {}) } : { title: draft.title, detail: draft.detail, category: draft.category, owner: draft.owner, needsUpload: draft.needsUpload, ...(draft.dueOn ? { dueOn: draft.dueOn } : {}) };
  const problem = today ? addProblem(deal, input, today) : null;
  const close = () => { setActing(null); setText(""); };
  const act = async (condition: LoanCondition) => {
    if (!acting) return;
    const base = { dealId: deal.id, conditionId: condition.id, by: viewerName };
    const done = await dispatch(acting.kind === "clear" ? { t: "clearCondition", ...base, note: text } : acting.kind === "return" ? { t: "returnCondition", ...base, reason: text } : { t: "waiveCondition", ...base, reason: text });
    if (done) close();
  };
  const add = async () => { if (await dispatch({ t: "addCondition", dealId: deal.id, condition: input, by: viewerName })) { setDraft(blank); setAdding(false); } };
  return (
    <div className="space-y-4" data-testid="conditions-panel">
      <p className={`text-sm ${blocking ? "text-warn" : "text-muted-foreground"}`} data-testid="conditions-summary">{conditions.length === 0 ? "No conditions yet. The library's standard ones are added when the loan starts clearing conditions." : blocking ? `${blocking} condition${blocking === 1 ? "" : "s"} to clear or waive before the loan can clear to close.` : "Everything before closing is cleared or waived."}</p>
      {(Object.keys(CATEGORIES) as ConditionCategory[]).map((category) => {
        const rows = conditions.filter((item) => item.category === category);
        if (!rows.length) return null;
        return (
          <Section key={category} title={`${CATEGORIES[category]} (${rows.filter((item) => !isDone(item)).length} open of ${rows.length})`}>
            <ul className="divide-y divide-border text-sm">
              {rows.map((condition) => (
                <li key={condition.id} className="space-y-1 py-2.5" data-testid="condition-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-medium">{condition.title}</p>{condition.detail && <p className="text-xs text-muted-foreground">{condition.detail}</p>}</div>
                    <span className="flex flex-wrap items-center gap-1.5"><Badge>{OWNERS[condition.owner]}</Badge><Badge tone={conditionTone(condition.status)}>{CONDITION_STATUS[condition.status]}</Badge></span>
                  </div>
                  <p className={`text-xs ${today && overdue(condition, today) ? "text-bad" : "text-muted-foreground"}`}>{condition.dueOn ? `Due ${shortDay(condition.dueOn)}${today && overdue(condition, today) ? " (overdue)" : ""}` : "No due date"} · added by {condition.addedBy} on {shortDate(condition.addedAt)}{condition.needsUpload ? " · needs a file" : ""}</p>
                  <ConditionFiles condition={condition} local={local} />
                  {condition.returned && condition.status === "open" && <p className="text-xs text-warn">Sent back by {condition.returned.by}: {condition.returned.reason}</p>}
                  {condition.cleared && <p className="text-xs text-good">Cleared by {condition.cleared.by} on {shortDate(condition.cleared.at)}{condition.cleared.note ? `: ${condition.cleared.note}` : ""}</p>}
                  {condition.waived && <p className="text-xs text-muted-foreground">Waived by {condition.waived.by} on {shortDate(condition.waived.at)}: {condition.waived.reason}</p>}
                  {!isDone(condition) && acting?.id !== condition.id && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={`btn-primary ${small}`} data-testid="clear-condition" onClick={() => { close(); setActing({ id: condition.id, kind: "clear" }); }}>Clear</button>
                      {condition.status === "submitted" && <button type="button" className={`btn-ghost ${small}`} data-testid="return-condition" onClick={() => { close(); setActing({ id: condition.id, kind: "return" }); }}>Send back</button>}
                      <button type="button" className={`btn-ghost ${small}`} data-testid="waive-condition" onClick={() => { close(); setActing({ id: condition.id, kind: "waive" }); }}>Waive</button>
                      {condition.needsUpload && <ConditionUpload dealId={deal.id} condition={condition} label="Upload for them" />}
                    </div>
                  )}
                  {acting?.id === condition.id && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block min-w-0 flex-1 basis-56"><span className="label">{acting.kind === "clear" ? "Note (optional)" : acting.kind === "return" ? "What's wrong (they see this)" : "Why it's waived"}</span><input className="desk-input" data-testid="condition-text" maxLength={1000} value={text} onChange={(event) => setText(event.target.value)} /></label>
                      <button type="button" className={`btn-primary ${small}`} data-testid="confirm-condition" disabled={acting.kind !== "clear" && !text.trim()} onClick={() => void act(condition)}>{acting.kind === "clear" ? "Clear it" : acting.kind === "return" ? "Send it back" : "Waive it"}</button>
                      <button type="button" className={`btn-ghost ${small}`} onClick={close}>Cancel</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
      {!adding && <button type="button" className={`btn-ghost ${small}`} data-testid="add-condition" onClick={() => setAdding(true)}>Add a condition</button>}
      <Reveal open={adding}>
        <Section title="Add a condition">
          <div className="space-y-3 text-sm" data-testid="add-condition-form">
            <label className="block"><span className="label">From the library</span><select className="desk-input" data-testid="condition-template" value={draft.templateId} onChange={(event) => setDraft({ ...draft, templateId: event.target.value })}><option value="">A new one for this loan only</option>{library.map((item) => <option key={item.id} value={item.id}>{item.title} ({CATEGORIES[item.category].toLowerCase()})</option>)}</select></label>
            {!draft.templateId && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block min-w-0 sm:col-span-2"><span className="label">What's needed</span><input className="desk-input" data-testid="condition-title" maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                <label className="block min-w-0 sm:col-span-2"><span className="label">Details (the borrower sees these on theirs)</span><input className="desk-input" data-testid="condition-detail" maxLength={1000} value={draft.detail} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">When</span><select className="desk-input" data-testid="condition-category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ConditionCategory })}>{Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="block min-w-0"><span className="label">Who it&apos;s for</span><select className="desk-input" data-testid="condition-owner" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value as ConditionOwner, needsUpload: event.target.value === "borrower" })}>{Object.entries(OWNERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={draft.needsUpload} onChange={(event) => setDraft({ ...draft, needsUpload: event.target.checked })} /> It needs a file sent in</label>
              </div>
            )}
            <label className="block"><span className="label">Due (optional{draft.templateId ? "; the library sets one" : ""})</span><input className="desk-input" type="date" data-testid="condition-due" min={today || undefined} value={draft.dueOn} onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} /></label>
            {problem && (draft.templateId || draft.title) && <p className="text-xs text-warn">{problem}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn-primary ${small}`} data-testid="save-condition" disabled={Boolean(problem)} onClick={() => void add()}>Add it</button>
              <button type="button" className={`btn-ghost ${small}`} onClick={() => { setAdding(false); setDraft(blank); }}>Cancel</button>
            </div>
          </div>
        </Section>
      </Reveal>
    </div>
  );
}
