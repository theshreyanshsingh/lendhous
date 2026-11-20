"use client";
import { useState } from "react";
import { Badge, Section } from "@/components/ui";
import type { Deal, Permit } from "@/lib/mockData";
import { LINE_STATE, lineState, PERMIT_STATUS, permitHoldsOn, permitLines, permitProblem, permitsMissing, permitWords, type LineState, type PermitInput } from "@/lib/permits";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
const TONE: Record<LineState, string> = { not_needed: "text-muted-foreground", missing: "text-warn", applied: "text-warn", issued: "text-good", finaled: "text-good", lapsed: "text-bad" };
type Draft = { id?: string; number: string; jurisdiction: string; scopeIds: string[]; status: Permit["status"]; issuedOn: string; expiresOn: string; finaledOn: string };
const draftOf = (permit?: Permit, scopeIds: string[] = []): Draft => ({ id: permit?.id, number: permit?.number ?? "", jurisdiction: permit?.jurisdiction ?? "", scopeIds: permit?.scopeIds ?? scopeIds, status: permit?.status ?? "issued", issuedOn: permit?.issuedOn ?? "", expiresOn: permit?.expiresOn ?? "", finaledOn: permit?.finaledOn ?? "" });

/**
 * Building permits by budget line (lib/permits.ts): which lines usually need one, the permits on file and where each
 * stands, and lines the team says need none. A line's draw waits for its permit, and the last draw for every permit to
 * be finaled, while an owner has the holds on in Settings.
 */
export function PermitsPanel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const lines = permitLines(deal);
  const permits = deal.permits ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [waiving, setWaiving] = useState<{ scopeId: string; reason: string } | null>(null);
  const missing = today ? permitsMissing(deal, today) : [];
  const division = (scopeId: string) => deal.scope?.find((line) => line.id === scopeId)?.division ?? scopeId;
  const input: PermitInput | null = draft ? { ...(draft.id ? { id: draft.id } : {}), number: draft.number, jurisdiction: draft.jurisdiction, scopeIds: draft.scopeIds, status: draft.status, ...(draft.issuedOn ? { issuedOn: draft.issuedOn } : {}), ...(draft.expiresOn ? { expiresOn: draft.expiresOn } : {}), ...(draft.finaledOn ? { finaledOn: draft.finaledOn } : {}) } : null;
  const problem = input && today ? permitProblem(deal, input, today) : null;
  const save = async () => { if (input && (await dispatch({ t: "savePermit", dealId: deal.id, permit: input, by: viewerName }))) setDraft(null); };
  const waive = async (scopeId: string, reason: string) => { if (await dispatch({ t: "permitNotNeeded", dealId: deal.id, scopeId, reason, by: viewerName })) setWaiving(null); };
  const put = (changes: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...changes } : current));

  if (!deal.scope?.length) return null;
  return (
    <Section title="Building permits" right={<Badge tone={missing.length ? "amber" : "green"}>{missing.length ? `${missing.length} line${missing.length === 1 ? "" : "s"} waiting` : "In order"}</Badge>}>
      <div className="space-y-4 text-sm" data-testid="permits-panel">
        <p className="text-xs text-muted-foreground">{permitHoldsOn() ? "A line that needs a permit gets no draw until its permit is issued, and the last draw waits until every permit is finaled." : "Draws aren't held for permits: an owner turned that off in Settings."} Look each one up on the city&apos;s or county&apos;s permit search.</p>
        {lines.length === 0 ? <p className="text-xs text-muted-foreground">No line in this budget usually needs a permit.</p> : (
          <ul className="divide-y divide-border text-xs" data-testid="permit-lines">
            {lines.map(({ line, needs, waived }) => {
              const state = today ? lineState(deal, line.id, today) : "missing";
              return (
                <li key={line.id} className="space-y-1 py-2" data-testid="permit-line">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium">{line.division}</span><span className={TONE[state]} data-testid="permit-line-state">{LINE_STATE[state]}</span></p>
                  <p className="text-muted-foreground">Usually needs {needs.join(", ")}.{waived ? ` Marked as needing none: ${waived.reason}` : ""}</p>
                  {waiving?.scopeId === line.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block min-w-0 flex-1 basis-56"><span className="label">Why it needs no permit</span><input className="desk-input" data-testid="permit-waive-reason" maxLength={300} placeholder="Cosmetic only: no roof deck or structure touched" value={waiving.reason} onChange={(event) => setWaiving({ ...waiving, reason: event.target.value })} /></label>
                      <button type="button" className={`btn-primary ${small}`} data-testid="permit-waive-save" disabled={!waiving.reason.trim()} onClick={() => void waive(line.id, waiving.reason)}>Save</button>
                      <button type="button" className={`btn-ghost ${small}`} onClick={() => setWaiving(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {state !== "finaled" && state !== "issued" && !waived && <button type="button" className={`btn-ghost ${small}`} data-testid="permit-add-for-line" onClick={() => setDraft(draftOf(undefined, [line.id]))}>Add its permit</button>}
                      {waived ? <button type="button" className={`btn-ghost ${small}`} data-testid="permit-unwaive" onClick={() => void waive(line.id, "")}>It needs one after all</button>
                        : state === "missing" && <button type="button" className={`btn-ghost ${small}`} data-testid="permit-waive" onClick={() => setWaiving({ scopeId: line.id, reason: "" })}>No permit needed</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">Permits on file ({permits.length})</p>
          {permits.length > 0 && (
            <ul className="divide-y divide-border text-xs" data-testid="permit-list">
              {permits.map((permit) => (
                <li key={permit.id} className="space-y-0.5 py-2" data-testid="permit-row">
                  <p><span className="font-medium">Permit {permit.number}</span> · {permit.jurisdiction} · {today ? permitWords(permit, today) : PERMIT_STATUS[permit.status]}</p>
                  <p className="text-muted-foreground">Covers {permit.scopeIds.map(division).join(", ")}</p>
                  <button type="button" className={`btn-ghost ${small} mt-1`} data-testid="permit-edit" onClick={() => setDraft(draftOf(permit))}>Update it</button>
                </li>
              ))}
            </ul>
          )}
          {!draft && <button type="button" className={`btn-ghost ${small}`} data-testid="permit-add" onClick={() => setDraft(draftOf(undefined, missing.map((item) => item.line.id)))}>Add a permit</button>}
          {draft && (
            <div className="space-y-2" data-testid="permit-form">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block min-w-0"><span className="label">Permit number</span><input className="desk-input" data-testid="permit-number" maxLength={80} value={draft.number} onChange={(event) => put({ number: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Issued by (city or county)</span><input className="desk-input" data-testid="permit-jurisdiction" maxLength={120} placeholder="City of Fort Lauderdale" value={draft.jurisdiction} onChange={(event) => put({ jurisdiction: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Where it stands</span><select className="desk-input" data-testid="permit-status" value={draft.status} onChange={(event) => put({ status: event.target.value as Permit["status"] })}>{Object.entries(PERMIT_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                {draft.status !== "applied" && <label className="block min-w-0"><span className="label">Issued on</span><input className="desk-input" type="date" data-testid="permit-issued" value={draft.issuedOn} onChange={(event) => put({ issuedOn: event.target.value })} /></label>}
                {(draft.status === "issued" || draft.status === "expired") && <label className="block min-w-0"><span className="label">Expires on (optional)</span><input className="desk-input" type="date" data-testid="permit-expires" value={draft.expiresOn} onChange={(event) => put({ expiresOn: event.target.value })} /></label>}
                {draft.status === "finaled" && <label className="block min-w-0"><span className="label">Final inspection passed on</span><input className="desk-input" type="date" data-testid="permit-finaled" value={draft.finaledOn} onChange={(event) => put({ finaledOn: event.target.value })} /></label>}
              </div>
              <fieldset className="space-y-1 text-xs"><legend className="label">Budget lines it covers</legend>
                {(deal.scope ?? []).map((line) => (
                  <label key={line.id} className="flex items-center gap-2"><input type="checkbox" data-testid={`permit-covers-${line.id}`} checked={draft.scopeIds.includes(line.id)} onChange={(event) => put({ scopeIds: event.target.checked ? [...draft.scopeIds, line.id] : draft.scopeIds.filter((id) => id !== line.id) })} />{line.division}</label>
                ))}
              </fieldset>
              {problem && draft.number.trim() && draft.jurisdiction.trim() && <p className="text-xs text-warn">{problem}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`btn-primary ${small}`} data-testid="permit-save" disabled={Boolean(problem)} onClick={() => void save()}>Save</button>
                <button type="button" className={`btn-ghost ${small}`} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
