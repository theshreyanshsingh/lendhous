"use client";
import { useState } from "react";
import { shortDay } from "@/lib/format";
import type { Deal, MitigationForm } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { floodDisclosureProblem, mitigationCredits, mitigationNote, mitigationProblem, mitigationValidUntil, OPENINGS, ROOF_DECK, ROOF_SHAPE, ROOF_TO_WALL, sellerDisclosureApplies, sellerFloodFlags, type MitigationInput } from "@/lib/wind-mitigation";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
const blank: MitigationInput = { inspectedOn: "", inspector: "", builtToCode: false, roofCovering: false, roofDeck: "other", roofToWall: "unknown", roofShape: "other", swr: false, openings: "none" };
const draftOf = (form?: MitigationForm): MitigationInput => (form ? { inspectedOn: form.inspectedOn, inspector: form.inspector, builtToCode: form.builtToCode, roofCovering: form.roofCovering, roofDeck: form.roofDeck, roofToWall: form.roofToWall, roofShape: form.roofShape, swr: form.swr, openings: form.openings } : blank);
type Answer = "" | "yes" | "no";
const answer = (value?: boolean): Answer => (value === undefined ? "" : value ? "yes" : "no");

/**
 * On the insurance file: the wind mitigation form's answers, which earn premium credits (Fla. Stat. 627.0629), and on a
 * purchase the seller's flood disclosure (689.302), with any "yes" flagged for the team.
 */
export function WindAndFlood({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const form = deal.insurance?.mitigation;
  const [draft, setDraft] = useState<MitigationInput | null>(null);
  const put = (changes: Partial<MitigationInput>) => setDraft((current) => (current ? { ...current, ...changes } : current));
  const note = today ? mitigationNote(deal, today) : null;
  const problem = draft && today ? mitigationProblem(draft, today) : null;
  const save = async () => { if (draft && (await dispatch({ t: "saveMitigation", dealId: deal.id, form: draft, by: viewerName }))) setDraft(null); };

  const disclosure = deal.insurance?.sellerFlood;
  const [floodOpen, setFloodOpen] = useState(false);
  const [given, setGiven] = useState<Answer>(answer(disclosure?.given));
  const [answers, setAnswers] = useState({ flooding: answer(disclosure?.flooding), claim: answer(disclosure?.claim), assistance: answer(disclosure?.assistance) });
  const asked = { given: given === "yes", ...(given === "yes" ? { flooding: answers.flooding ? answers.flooding === "yes" : undefined, claim: answers.claim ? answers.claim === "yes" : undefined, assistance: answers.assistance ? answers.assistance === "yes" : undefined } : {}) };
  const floodProblem = given ? floodDisclosureProblem(deal, asked) : "Say whether the seller gave it.";
  const saveFlood = async () => { if (await dispatch({ t: "saveSellerFlood", dealId: deal.id, disclosure: asked, by: viewerName })) setFloodOpen(false); };
  const flags = sellerFloodFlags(deal);

  return (
    <>
      <div className="space-y-2 border-t border-border pt-3" data-testid="wind-mitigation">
        <p className="font-medium">Wind mitigation</p>
        {form && !draft && (
          <div className="space-y-1 text-xs" data-testid="mitigation-summary">
            <p>Inspected {shortDay(form.inspectedOn)} by {form.inspector} · good to {shortDay(mitigationValidUntil(form))}</p>
            <p className="text-muted-foreground">{[ROOF_SHAPE[form.roofShape], `roof deck ${form.roofDeck === "other" ? "not known" : form.roofDeck}`, `roof-to-wall: ${ROOF_TO_WALL[form.roofToWall].toLowerCase()}`, form.swr ? "secondary water resistance" : "no secondary water resistance", OPENINGS[form.openings].toLowerCase()].join(" · ")}</p>
            {mitigationCredits(form).length > 0 && <ul className="flex flex-wrap gap-1" data-testid="mitigation-credits">{mitigationCredits(form).map((credit) => <li key={credit} className="rounded-[2px] bg-good/10 px-1.5 py-0.5 text-good">{credit}</li>)}</ul>}
          </div>
        )}
        {note && !draft && <p className={`text-xs ${note.tone === "warn" ? "text-warn" : "text-muted-foreground"}`} data-testid="mitigation-note">{note.text}</p>}
        {!draft && <button type="button" className={`btn-ghost ${small}`} data-testid="edit-mitigation" onClick={() => setDraft(draftOf(form))}>{form ? "Update the form" : "Record the mitigation form"}</button>}
        {draft && (
          <div className="space-y-2" data-testid="mitigation-form">
            <p className="text-xs text-muted-foreground">From the uniform mitigation verification form (OIR-B1-1802) a licensed inspector signed.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block min-w-0"><span className="label">Inspected on</span><input className="desk-input" type="date" data-testid="mitigation-date" value={draft.inspectedOn} onChange={(event) => put({ inspectedOn: event.target.value })} /></label>
              <label className="block min-w-0"><span className="label">Signed by</span><input className="desk-input" data-testid="mitigation-inspector" maxLength={160} placeholder="Name and license" value={draft.inspector} onChange={(event) => put({ inspector: event.target.value })} /></label>
              <label className="block min-w-0"><span className="label">Roof shape</span><select className="desk-input" data-testid="mitigation-shape" value={draft.roofShape} onChange={(event) => put({ roofShape: event.target.value as MitigationInput["roofShape"] })}>{Object.entries(ROOF_SHAPE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">Roof deck attachment</span><select className="desk-input" data-testid="mitigation-deck" value={draft.roofDeck} onChange={(event) => put({ roofDeck: event.target.value as MitigationInput["roofDeck"] })}>{Object.entries(ROOF_DECK).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">Roof-to-wall attachment</span><select className="desk-input" data-testid="mitigation-wall" value={draft.roofToWall} onChange={(event) => put({ roofToWall: event.target.value as MitigationInput["roofToWall"] })}>{Object.entries(ROOF_TO_WALL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">Opening protection</span><select className="desk-input" data-testid="mitigation-openings" value={draft.openings} onChange={(event) => put({ openings: event.target.value as MitigationInput["openings"] })}>{Object.entries(OPENINGS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <label className="flex items-center gap-2"><input type="checkbox" data-testid="mitigation-code" checked={draft.builtToCode} onChange={(event) => put({ builtToCode: event.target.checked })} />Built to the 2001 Florida Building Code or later</label>
              <label className="flex items-center gap-2"><input type="checkbox" data-testid="mitigation-covering" checked={draft.roofCovering} onChange={(event) => put({ roofCovering: event.target.checked })} />Roof covering meets the code</label>
              <label className="flex items-center gap-2"><input type="checkbox" data-testid="mitigation-swr" checked={draft.swr} onChange={(event) => put({ swr: event.target.checked })} />Secondary water resistance</label>
            </div>
            {problem && draft.inspectedOn && draft.inspector.trim() && <p className="text-xs text-warn">{problem}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn-primary ${small}`} data-testid="save-mitigation" disabled={Boolean(problem)} onClick={() => void save()}>Save</button>
              <button type="button" className={`btn-ghost ${small}`} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {sellerDisclosureApplies(deal) && (
        <div className="space-y-2 border-t border-border pt-3" data-testid="seller-flood">
          <p className="font-medium">Seller&apos;s flood disclosure</p>
          {disclosure && !floodOpen && <p className="text-xs" data-testid="seller-flood-summary">{disclosure.given ? `Given: ${[["flooding that damaged it", disclosure.flooding], ["a flood claim", disclosure.claim], ["help for flood damage", disclosure.assistance]].map(([label, value]) => `${value ? "yes" : "no"} to ${label}`).join(", ")}.` : "Not given at the contract."}</p>}
          {flags.length > 0 && !floodOpen && <ul className="space-y-1 text-xs" data-testid="seller-flood-flags">{flags.map((flag) => <li key={flag.text} className={flag.level === "bad" ? "text-bad" : flag.level === "warn" ? "text-warn" : "text-muted-foreground"}>{flag.text}</li>)}</ul>}
          {!floodOpen ? (
            <button type="button" className={`btn-ghost ${small}`} data-testid="edit-seller-flood" onClick={() => setFloodOpen(true)}>{disclosure ? "Change it" : "Record it"}</button>
          ) : (
            <div className="space-y-2 text-xs" data-testid="seller-flood-form">
              <label className="block max-w-xs"><span className="label">Did the seller give it (Fla. Stat. 689.302)?</span>
                <select className="desk-input" data-testid="seller-flood-given" value={given} onChange={(event) => setGiven(event.target.value as Answer)}><option value="">Choose one</option><option value="yes">Yes, with the contract</option><option value="no">No</option></select>
              </label>
              {given === "yes" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {([["flooding", "Knows of flooding that damaged it"], ["claim", "Filed a flood insurance claim"], ["assistance", "Got FEMA or other help for flood damage"]] as const).map(([key, label]) => (
                    <label key={key} className="block min-w-0"><span className="label">{label}</span>
                      <select className="desk-input" data-testid={`seller-flood-${key}`} value={answers[key]} onChange={(event) => setAnswers({ ...answers, [key]: event.target.value as Answer })}><option value="">Choose one</option><option value="yes">Seller has</option><option value="no">Seller has not</option></select>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`btn-primary ${small}`} data-testid="save-seller-flood" disabled={Boolean(floodProblem)} onClick={() => void saveFlood()}>Save</button>
                <button type="button" className={`btn-ghost ${small}`} onClick={() => setFloodOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
