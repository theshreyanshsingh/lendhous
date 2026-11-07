"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section, shortDate } from "@/components/ui";
import { defaultNocExpiry, lienFileProblem, LIENOR_ROLES, mortgageRecordedOn, NOC_START_DAYS, nocProblems } from "@/lib/lien-law";
import { insuranceHold } from "@/lib/insurance";
import type { Deal, NoticeToOwner } from "@/lib/mockData";
import { addDays } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";

const small = "h-9! px-3! text-xs!";

/**
 * The loan's construction lien file (Fla. Stat. ch. 713), for the team: the contractor and the Notice of Commencement,
 * checked against the mortgage, its 90 days and its end date; the notices to owner, each of which needs a waiver with
 * every draw after it. The policies draws depend on are on the Insurance card (components/loan/InsurancePanel.tsx).
 */
export function LienProtection({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const lien = deal.lienFile;
  const noc = lien?.noc;
  const [editing, setEditing] = useState(!noc);
  const [form, setForm] = useState({ contractor: lien?.contractor ?? "", recordedOn: noc?.recordedOn ?? "", reference: noc?.reference ?? "", expiresOn: noc?.expiresOn ?? "", commencedOn: noc?.commencedOn ?? "", lenderNamed: noc?.lenderNamed ?? false, mortgageFirst: noc?.mortgageFirst ?? false, mortgageRecordedOn: lien?.mortgageRecordedOn ?? "" });
  const [notice, setNotice] = useState({ lienor: "", role: "subcontractor" as NoticeToOwner["role"], servedOn: "" });
  const [adding, setAdding] = useState(false);
  const put = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }));
  const fromTitle = Boolean(deal.closing?.recording?.on);
  const input = { contractor: form.contractor, ...(form.recordedOn ? { noc: { recordedOn: form.recordedOn, reference: form.reference, expiresOn: form.expiresOn || defaultNocExpiry(form.recordedOn), ...(form.commencedOn ? { commencedOn: form.commencedOn } : {}), lenderNamed: form.lenderNamed, mortgageFirst: form.mortgageFirst } } : {}) };
  const problem = today ? lienFileProblem(input, today) : null;
  const problems = today ? nocProblems(deal, today) : [];
  const insurance = today ? insuranceHold(deal, today) : null;
  const save = async () => { if (await dispatch({ t: "saveLienFile", dealId: deal.id, ...input, ...(!fromTitle && form.mortgageRecordedOn ? { mortgageRecordedOn: form.mortgageRecordedOn } : {}), by: viewerName })) setEditing(false); };
  return (
    <Section title="Lien protection (Florida construction lien law)" right={<Badge tone={problems.length || insurance ? "amber" : "green"}>{problems.length || insurance ? "Draws on hold" : "In place"}</Badge>}>
      <div className="space-y-4 text-sm" data-testid="lien-protection">
        <div className="space-y-2">
          <p className="font-medium">Contractor and Notice of Commencement</p>
          {!editing && noc ? (
            <div className="space-y-0.5 text-xs" data-testid="noc-summary">
              <p>Contractor: {lien?.contractor}</p>
              <p>Recorded {noc.recordedOn} ({noc.reference || "no reference"}) · ends {shortDay(noc.expiresOn)} · work started {noc.commencedOn ?? "not recorded yet"} · {noc.lenderNamed ? "names LendHous" : "doesn't name LendHous"}</p>
              <p className="text-muted-foreground">Mortgage recorded {mortgageRecordedOn(deal) ?? "date not on file"}{fromTitle ? " (from the title company)" : ""}.</p>
              <button type="button" className={`btn-ghost ${small} mt-1`} data-testid="edit-noc" onClick={() => setEditing(true)}>Change it</button>
            </div>
          ) : (
            <div className="space-y-2" data-testid="noc-form">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block min-w-0 sm:col-span-2"><span className="label">Contractor</span><input className="desk-input" data-testid="lien-contractor" maxLength={160} value={form.contractor} onChange={(event) => put({ contractor: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Notice recorded on</span><input className="desk-input" type="date" data-testid="noc-recorded" max={today || undefined} value={form.recordedOn} onChange={(event) => put({ recordedOn: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Book and page, or instrument number</span><input className="desk-input" data-testid="noc-reference" maxLength={200} value={form.reference} onChange={(event) => put({ reference: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Ends on (a year unless it says)</span><input className="desk-input" type="date" data-testid="noc-expires" value={form.expiresOn || (form.recordedOn ? defaultNocExpiry(form.recordedOn) : "")} onChange={(event) => put({ expiresOn: event.target.value })} /></label>
                <label className="block min-w-0"><span className="label">Work started on (optional)</span><input className="desk-input" type="date" data-testid="noc-commenced" max={today || undefined} value={form.commencedOn} onChange={(event) => put({ commencedOn: event.target.value })} /></label>
                {!fromTitle && <label className="block min-w-0"><span className="label">Mortgage recorded on</span><input className="desk-input" type="date" data-testid="mortgage-recorded" max={today || undefined} value={form.mortgageRecordedOn} onChange={(event) => put({ mortgageRecordedOn: event.target.value })} /></label>}
              </div>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="noc-lender-named" checked={form.lenderNamed} onChange={(event) => put({ lenderNamed: event.target.checked })} /><span>It names LendHous as the lender, and to receive copies of notices to owner (Fla. Stat. 713.13(1), (7)).</span></label>
              {form.recordedOn && form.recordedOn === (mortgageRecordedOn(deal) ?? form.mortgageRecordedOn) && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="noc-mortgage-first" checked={form.mortgageFirst} onChange={(event) => put({ mortgageFirst: event.target.checked })} /><span>Same day as the mortgage: the official records show the mortgage was recorded first.</span></label>}
              {form.recordedOn && <p className="text-xs text-muted-foreground">Work has to start by {addDays(form.recordedOn, NOC_START_DAYS)}, or the notice is void (713.13(2)).</p>}
              {problem && form.contractor && <p className="text-xs text-warn">{problem}</p>}
              <div className="flex flex-wrap gap-2"><button type="button" className={`btn-primary ${small}`} data-testid="save-noc" disabled={Boolean(problem)} onClick={() => void save()}>Save</button>{noc && <button type="button" className={`btn-ghost ${small}`} onClick={() => setEditing(false)}>Cancel</button>}</div>
            </div>
          )}
          {problems.length > 0 && <ul className="space-y-0.5 text-xs text-warn" data-testid="noc-problems">{problems.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">Notices to owner ({lien?.notices.length ?? 0})</p>
          <p className="text-xs text-muted-foreground">From subcontractors and suppliers the borrower didn&apos;t hire directly (713.06(2)). Every draw after one comes in needs that lienor&apos;s waiver too.</p>
          {lien?.notices.length ? <ul className="divide-y divide-border text-xs" data-testid="notices-to-owner">{lien.notices.map((item) => <li key={item.id} className="py-1.5">{item.lienor} · {LIENOR_ROLES[item.role]} · served {item.servedOn}<span className="text-muted-foreground"> · logged by {item.by} {shortDate(item.at)}</span></li>)}</ul> : null}
          {!adding && <button type="button" className={`btn-ghost ${small}`} data-testid="add-notice" onClick={() => setAdding(true)}>Log a notice to owner</button>}
          <Reveal open={adding}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 basis-48"><span className="label">Who served it</span><input className="desk-input" data-testid="notice-lienor" maxLength={160} value={notice.lienor} onChange={(event) => setNotice({ ...notice, lienor: event.target.value })} /></label>
              <label className="block"><span className="label">As</span><select className="desk-input" data-testid="notice-role" value={notice.role} onChange={(event) => setNotice({ ...notice, role: event.target.value as NoticeToOwner["role"] })}>{Object.entries(LIENOR_ROLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block"><span className="label">Served on</span><input className="desk-input" type="date" data-testid="notice-served" max={today || undefined} value={notice.servedOn} onChange={(event) => setNotice({ ...notice, servedOn: event.target.value })} /></label>
              <button type="button" className={`btn-primary ${small}`} data-testid="save-notice" disabled={!notice.lienor.trim() || !notice.servedOn} onClick={async () => { if (await dispatch({ t: "addNoticeToOwner", dealId: deal.id, ...notice, by: viewerName })) { setNotice({ lienor: "", role: "subcontractor", servedOn: "" }); setAdding(false); } }}>Log it</button>
              <button type="button" className={`btn-ghost ${small}`} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </Reveal>
        </div>

        {insurance && <p className="border-t border-border pt-3 text-xs text-warn" data-testid="lien-insurance-hold">{insurance} Draws are held until it&apos;s on the Insurance card.</p>}
      </div>
    </Section>
  );
}
