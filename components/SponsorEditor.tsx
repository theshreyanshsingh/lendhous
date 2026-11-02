"use client";
import { useState } from "react";
import { allAnswered, DeclarationFields, emptyProfile, fromDeclarations, GuarantorFields, toSponsor, TrackRecordFields } from "@/components/SponsorForm";
import { sponsorProblem } from "@/lib/credit";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const IN_REVIEW = ["submitted", "initial_review", "underwriting"];

/** The borrower profile on its own: for a loan staff started before they had it, or to correct it while it's in review. */
export function SponsorEditor({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const { dispatch } = useStore();
  const [profile, setProfile] = useState<ReturnType<typeof emptyProfile>>(() => deal.sponsor
    ? { entityState: deal.sponsor.entityState, guarantors: deal.sponsor.guarantors, trackRecord: deal.sponsor.trackRecord, answers: fromDeclarations(deal.sponsor.declarations) }
    : { ...emptyProfile(), guarantors: [{ name: deal.borrowerName, ownershipPct: 100, fico: 700, citizenship: "us" }] });
  const [saving, setSaving] = useState(false);
  if (!IN_REVIEW.includes(deal.status)) return <p className="text-sm text-muted-foreground">This loan has a term sheet, so its borrower profile can&apos;t change here. Message the team if something is wrong.</p>;
  const sponsor = toSponsor(profile);
  const problem = !allAnswered(profile.answers) ? "Answer every credit question." : sponsorProblem(sponsor);
  const save = async () => {
    setSaving(true);
    const done = await dispatch({ t: "saveSponsor", dealId: deal.id, sponsor });
    setSaving(false);
    if (done) onDone();
  };
  return (
    <div className="space-y-6" data-testid="sponsor-editor">
      <section className="space-y-3">
        <h2 className="text-base font-medium">Borrowing entity and guarantors</h2>
        <label className="block max-w-56"><span className="label">State the LLC was formed in</span><input className="desk-input" data-testid="entity-state" maxLength={2} value={profile.entityState} onChange={(event) => setProfile({ ...profile, entityState: event.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase() })} /></label>
        <GuarantorFields guarantors={profile.guarantors} onChange={(guarantors) => setProfile({ ...profile, guarantors })} />
      </section>
      <section className="space-y-3"><h2 className="text-base font-medium">Past deals</h2><TrackRecordFields deals={profile.trackRecord} onChange={(trackRecord) => setProfile({ ...profile, trackRecord })} /></section>
      <section className="space-y-3"><h2 className="text-base font-medium">Credit questions</h2><DeclarationFields answers={profile.answers} onChange={(answers) => setProfile({ ...profile, answers })} /></section>
      {problem && <p role="alert" className="text-sm text-bad" data-testid="sponsor-problem">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" data-testid="save-sponsor" disabled={saving || Boolean(problem)} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
