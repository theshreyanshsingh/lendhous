"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge, Section } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { coverageShort, coverNeeds, insuranceGaps, kindsFor, lapsedPolicies, openRenewals, policiesOf, POLICY_KINDS } from "@/lib/insurance";
import { insuranceWarnings, isCitizens } from "@/lib/florida-insurance";
import { pricingFor } from "@/lib/pricing-versions";
import type { Deal, InsurancePolicy, InsuranceRenewal, PolicyKind } from "@/lib/mockData";
import { daysBetween, SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { FloodMapLine } from "./FloodMapLine";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
type Draft = { kind: PolicyKind; carrier: string; policy: string; expiresOn: string; coverage: string; windIncluded: boolean; mortgagee: boolean; citizens?: boolean; program: "" | "nfip" | "private" };
const draftOf = (kind: PolicyKind, policy?: InsurancePolicy): Draft => ({ kind, carrier: policy?.carrier ?? "", policy: policy?.policy ?? "", expiresOn: policy?.expiresOn ?? "", coverage: policy?.coverage !== undefined ? String(policy.coverage) : "", windIncluded: policy?.windIncluded ?? false, mortgagee: policy?.mortgagee ?? false, citizens: policy?.citizens, program: policy?.program ?? "" });
const insuresBuilding = (kind: PolicyKind) => kind === "hazard" || kind === "builders_risk";

/**
 * The property's insurance, for the team, on every loan from the accepted term sheet: what Florida's risks call for
 * (the building, wind, and flood in a special flood hazard area), each policy and whether it names LendHous, and the
 * renewals the borrower sends in. A loan can't fund with anything missing, and a lapsed policy holds draws.
 */
export function InsurancePanel({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const policies = policiesOf(deal);
  const needs = coverNeeds(deal);
  const gaps = today ? insuranceGaps(deal, today) : [];
  const lapsed = today ? lapsedPolicies(deal, today) : [];
  const flood = deal.insurance?.flood;
  const kinds = kindsFor(deal);
  const firstMissing = (): PolicyKind => (needs.find((need) => !need.met && need.key === "property") ? kinds[0] : needs.find((need) => !need.met && need.key === "wind") ? "windstorm" : needs.find((need) => !need.met && need.key === "flood" && flood) ? "flood" : kinds[0]);
  const [draft, setDraft] = useState<Draft | null>(policies.length ? null : draftOf(firstMissing()));
  const [floodOpen, setFloodOpen] = useState(!flood);
  const [floodDraft, setFloodDraft] = useState({ sfha: flood ? (flood.sfha ? "yes" : "no") : "", zone: flood?.zone ?? "" });
  const put = (changes: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...changes } : current));
  const edit = (kind: PolicyKind) => setDraft(draftOf(kind, policies.find((item) => item.kind === kind)));
  const save = async () => {
    if (!draft) return;
    const coverage = draft.coverage.trim() ? Number(draft.coverage.replace(/[$,\s]/g, "")) : undefined;
    if (await dispatch({ t: "saveInsurance", dealId: deal.id, kind: draft.kind, carrier: draft.carrier, policy: draft.policy, expiresOn: draft.expiresOn, ...(coverage !== undefined ? { coverage } : {}), ...(insuresBuilding(draft.kind) ? { windIncluded: draft.windIncluded } : {}), mortgagee: draft.mortgagee, ...(draft.kind !== "flood" ? { citizens: isCitizens({ carrier: draft.carrier, citizens: draft.citizens }) } : {}), ...(draft.kind === "flood" && draft.program ? { program: draft.program } : {}), by: viewerName })) setDraft(null);
  };
  const saveFlood = async () => { if (await dispatch({ t: "setFloodZone", dealId: deal.id, sfha: floodDraft.sfha === "yes", zone: floodDraft.zone, by: viewerName })) setFloodOpen(false); };
  const tone = lapsed.length ? "rose" : gaps.length ? "amber" : "green";
  // What's coming under Florida's insurance rules: Citizens' flood requirement, the NFIP's date, a rental's coverage
  // after the biggest Citizens rise, and a condo association moving to surplus lines (lib/florida-insurance.ts).
  const warnings = today ? insuranceWarnings(deal, policies, today, pricingFor(deal.app.pricingVersion).minDscr) : [];
  const [association, setAssociation] = useState({ carrier: deal.insurance?.association?.carrier ?? "", citizens: deal.insurance?.association?.citizens ?? false });
  const saveAssociation = () => void dispatch({ t: "saveAssociationPolicy", dealId: deal.id, carrier: association.carrier.trim(), citizens: association.citizens, by: viewerName });
  const funded = SERVICED.includes(deal.status);
  return (
    <Section title="Insurance" right={<Badge tone={tone}>{lapsed.length ? "Lapsed" : gaps.length ? `${gaps.length} to sort out` : "In place"}</Badge>}>
      <div className="space-y-4 text-sm" data-testid="insurance-panel">
        <p className="text-xs text-muted-foreground">{funded ? "A lapsed policy holds every draw, and the borrower and the team hear 30 days before any policy ends." : "The loan can't fund until the property is covered for its building, wind and (in a special flood hazard area) flood, with LendHous named as mortgagee."}</p>

        <ul className="space-y-1.5" data-testid="insurance-needs">
          {needs.map((need) => (
            <li key={need.key} className="flex items-start gap-2" data-testid="insurance-need">
              <span aria-hidden className={`mt-0.5 font-semibold ${need.met ? "text-good" : "text-warn"}`}>{need.met ? "✓" : "•"}</span>
              <span className="min-w-0"><span className="font-medium">{need.label}</span><span className="text-muted-foreground"> · {need.note}</span><span className="sr-only">{need.met ? " (covered)" : " (still needed)"}</span></span>
            </li>
          ))}
        </ul>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">Flood zone</p>
          <FloodMapLine deal={deal} />
          {flood && !floodOpen ? (
            <div className="text-xs" data-testid="flood-zone">
              <p>{flood.zone ? `Zone ${flood.zone}` : "Zone not given"} · {flood.sfha ? "in a special flood hazard area" : "not in a special flood hazard area"}{flood.source === "fema" ? " · from FEMA's map" : ""}</p>
              <button type="button" className={`btn-ghost ${small} mt-1`} data-testid="edit-flood" onClick={() => setFloodOpen(true)}>Change it</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2" data-testid="flood-form">
              <label className="block min-w-0 basis-60"><span className="label">From FEMA&apos;s flood map or the flood certificate</span>
                <select className="desk-input" data-testid="flood-sfha" value={floodDraft.sfha} onChange={(event) => setFloodDraft({ ...floodDraft, sfha: event.target.value })}>
                  <option value="">Choose one</option>
                  <option value="yes">In a special flood hazard area (zones A or V)</option>
                  <option value="no">Not in one (zones X, B, C or D)</option>
                </select>
              </label>
              <label className="block basis-24"><span className="label">Zone (optional)</span><input className="desk-input" data-testid="flood-zone-code" maxLength={12} placeholder="AE" value={floodDraft.zone} onChange={(event) => setFloodDraft({ ...floodDraft, zone: event.target.value })} /></label>
              <button type="button" className={`btn-primary ${small}`} data-testid="save-flood" disabled={!floodDraft.sfha} onClick={() => void saveFlood()}>Save</button>
              {flood && <button type="button" className={`btn-ghost ${small}`} onClick={() => setFloodOpen(false)}>Cancel</button>}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">Policies ({policies.length})</p>
          {policies.length > 0 && (
            <ul className="divide-y divide-border text-xs" data-testid="insurance-summary">
              {policies.map((policy) => {
                const days = today ? daysBetween(today, policy.expiresOn) : null;
                return (
                  <li key={policy.kind} className="space-y-0.5 py-2" data-testid="insurance-policy-row">
                    <p><span className="font-medium">{POLICY_KINDS[policy.kind]}</span> · {policy.carrier}{policy.policy ? ` · policy ${policy.policy}` : ""} · ends {shortDay(policy.expiresOn)}</p>
                    <p className="text-muted-foreground">{[policy.coverage !== undefined ? `$${policy.coverage.toLocaleString("en-US")} coverage` : "", insuresBuilding(policy.kind) ? (policy.windIncluded ? "wind included" : "no wind in this policy") : "", policy.kind !== "flood" && isCitizens(policy) ? "Citizens" : "", policy.kind === "flood" ? (policy.program === "private" ? "private flood" : policy.program === "nfip" ? "NFIP" : "NFIP or private not said") : "", policy.mortgagee === true ? "names LendHous as mortgagee" : policy.mortgagee === false ? "doesn't name LendHous yet" : "mortgagee not checked"].filter(Boolean).join(" · ")}{policy.documentId ? <> · <a className="text-link underline underline-offset-2" href={`/api/documents/${policy.documentId}`} target="_blank" rel="noreferrer">{policy.fileName ?? "the policy"}</a></> : null}</p>
                    {days !== null && <p className={days < 0 ? "text-bad" : days <= 30 ? "text-warn" : "text-muted-foreground"}>{days < 0 ? `Lapsed ${-days} day${days === -1 ? "" : "s"} ago.` : `${days} day${days === 1 ? "" : "s"} left.`}{funded && days <= 30 ? " Draws stop if it lapses." : ""}</p>}
                    <button type="button" className={`btn-ghost ${small} mt-1`} data-testid={`edit-policy-${policy.kind}`} onClick={() => edit(policy.kind)}>Update it</button>
                  </li>
                );
              })}
            </ul>
          )}
          {coverageShort(deal).map((line) => <p key={line} className="text-xs text-warn">{line}</p>)}
          {!draft && <button type="button" className={`btn-ghost ${small}`} data-testid="add-policy" onClick={() => setDraft(draftOf(firstMissing()))}>Add a policy</button>}
          <Reveal open={Boolean(draft)}>
            {draft && (
              <div className="space-y-2" data-testid="insurance-form">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0"><span className="label">Policy</span><select className="desk-input" data-testid="insurance-kind" value={draft.kind} onChange={(event) => setDraft(draftOf(event.target.value as PolicyKind, policies.find((item) => item.kind === event.target.value)))}>{kinds.map((kind) => <option key={kind} value={kind}>{POLICY_KINDS[kind]}</option>)}</select></label>
                  <label className="block min-w-0"><span className="label">Insurance company</span><input className="desk-input" data-testid="insurance-carrier" maxLength={160} value={draft.carrier} onChange={(event) => put({ carrier: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Policy number</span><input className="desk-input" data-testid="insurance-policy" maxLength={120} value={draft.policy} onChange={(event) => put({ policy: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">Ends on</span><input className="desk-input" type="date" data-testid="insurance-expires" value={draft.expiresOn} onChange={(event) => put({ expiresOn: event.target.value })} /></label>
                  <label className="block min-w-0"><span className="label">{insuresBuilding(draft.kind) ? "Dwelling coverage ($, optional)" : "Coverage ($, optional)"}</span><input className="desk-input" inputMode="numeric" data-testid="insurance-coverage" maxLength={14} value={draft.coverage} onChange={(event) => put({ coverage: event.target.value })} /></label>
                </div>
                {insuresBuilding(draft.kind) && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="insurance-wind" checked={draft.windIncluded} onChange={(event) => put({ windIncluded: event.target.checked })} /><span>It covers windstorm and hurricane too (no wind exclusion).</span></label>}
                {draft.kind !== "flood" && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="insurance-citizens" checked={isCitizens({ carrier: draft.carrier, citizens: draft.citizens })} onChange={(event) => put({ citizens: event.target.checked })} /><span>Written by Citizens Property Insurance, the state&apos;s insurer of last resort.</span></label>}
                {draft.kind === "flood" && <label className="block max-w-xs"><span className="label">Flood program</span><select className="desk-input" data-testid="insurance-program" value={draft.program} onChange={(event) => put({ program: event.target.value as Draft["program"] })}><option value="">Choose one</option><option value="nfip">The NFIP (FEMA)</option><option value="private">A private insurer</option></select></label>}
                <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="insurance-mortgagee" checked={draft.mortgagee} onChange={(event) => put({ mortgagee: event.target.checked })} /><span>It names LendHous as mortgagee and loss payee (ISAOA/ATIMA).</span></label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`btn-primary ${small}`} data-testid="save-insurance" disabled={!draft.carrier.trim() || !draft.expiresOn || (draft.kind === "flood" && !draft.program)} onClick={() => void save()}>Save</button>
                  <button type="button" className={`btn-ghost ${small}`} onClick={() => setDraft(null)}>Cancel</button>
                </div>
              </div>
            )}
          </Reveal>
        </div>

        {openRenewals(deal).length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="font-medium">Renewals to check</p>
            {openRenewals(deal).map((renewal) => <RenewalReview key={renewal.id} deal={deal} renewal={renewal} />)}
          </div>
        )}

        {deal.app.propertyType === "condo" && (
          <div className="space-y-2 border-t border-border pt-3" data-testid="association-policy">
            <p className="font-medium">The condo association&apos;s building</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 basis-48"><span className="label">Who insures it</span><input className="desk-input" data-testid="association-carrier" maxLength={160} value={association.carrier} onChange={(event) => setAssociation({ ...association, carrier: event.target.value })} /></label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" data-testid="association-citizens" checked={association.citizens} onChange={(event) => setAssociation({ ...association, citizens: event.target.checked })} />Citizens</label>
              <button type="button" className={`btn-ghost ${small}`} data-testid="save-association" disabled={!association.carrier.trim()} onClick={saveAssociation}>Save</button>
            </div>
          </div>
        )}
        {warnings.length > 0 && <ul className="space-y-1 text-xs" data-testid="insurance-warnings">{warnings.map((warning) => <li key={warning.key} className={warning.tone === "warn" ? "text-warn" : "text-muted-foreground"} data-testid={`insurance-warning-${warning.key}`}>{warning.text}</li>)}</ul>}
        {gaps.length > 0 && <ul className="space-y-0.5 text-xs text-warn" data-testid="insurance-gaps">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}
      </div>
    </Section>
  );
}

/** A renewal the borrower sent: the team checks the policy, then accepts it onto the file or sends it back with why. */
function RenewalReview({ deal, renewal }: { deal: Deal; renewal: InsuranceRenewal }) {
  const { dispatch, viewerName } = useStore();
  const [mortgagee, setMortgagee] = useState(false);
  const [wind, setWind] = useState(policiesOf(deal).find((item) => item.kind === renewal.kind)?.windIncluded ?? false);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const decide = (accept: boolean) => dispatch({ t: "decideRenewal", dealId: deal.id, renewalId: renewal.id, accept, mortgagee, ...(insuresBuilding(renewal.kind) ? { windIncluded: wind } : {}), note, by: viewerName });
  return (
    <div className="space-y-2 rounded-[2px] border border-border p-3 text-xs" data-testid="insurance-renewal">
      <p><span className="font-medium">{POLICY_KINDS[renewal.kind]}</span> · {renewal.carrier}{renewal.policy ? ` · policy ${renewal.policy}` : ""} · ends {shortDay(renewal.expiresOn)}</p>
      <p className="text-muted-foreground">Sent by {renewal.by} {shortDay(renewal.at.slice(0, 10))} · {renewal.documentId ? <a className="text-link underline underline-offset-2" href={`/api/documents/${renewal.documentId}`} target="_blank" rel="noreferrer">{renewal.fileName}</a> : renewal.fileName}</p>
      {insuresBuilding(renewal.kind) && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" data-testid="renewal-wind" checked={wind} onChange={(event) => setWind(event.target.checked)} /><span>It covers windstorm too.</span></label>}
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" data-testid="renewal-mortgagee" checked={mortgagee} onChange={(event) => setMortgagee(event.target.checked)} /><span>I checked it names LendHous as mortgagee and loss payee.</span></label>
      {!returning ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn-primary ${small}`} data-testid="accept-renewal" disabled={!mortgagee} onClick={() => void decide(true)}>Accept it</button>
          <button type="button" className={`btn-ghost ${small}`} data-testid="return-renewal" onClick={() => setReturning(true)}>Send it back</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-56"><span className="label">What&apos;s wrong with it</span><input className="desk-input" data-testid="renewal-note" maxLength={1000} placeholder="LendHous isn't named as mortgagee" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className={`btn-primary ${small}`} data-testid="confirm-return" disabled={!note.trim()} onClick={async () => { if (await decide(false)) setReturning(false); }}>Send it back</button>
          <button type="button" className={`btn-ghost ${small}`} onClick={() => setReturning(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
