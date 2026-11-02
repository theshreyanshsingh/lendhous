"use client";
import { useState } from "react";
import { SponsorEditor } from "@/components/SponsorEditor";
import { Badge, Section, shortDate, usd } from "@/components/ui";
import { CITIZENSHIP, countedDeals, creditFlags, DECLARATIONS, EXPERIENCE_MONTHS, qualifyingFico, TRACK_KIND } from "@/lib/credit";
import { experienceTier } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { est, useStore } from "@/lib/store";

const IN_REVIEW = ["submitted", "initial_review", "underwriting"];

/** The credit officer's view of who stands behind a loan. Signing it off is what lets a term sheet go out. */
export function CreditReview({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  // A tick shows at once; for a real account the server's answer replaces it a moment later.
  const [ticking, setTicking] = useState<Record<string, boolean>>({});
  const verify = async (trackId: string, verified: boolean) => {
    setTicking((all) => ({ ...all, [trackId]: verified }));
    await dispatch({ t: "verifyTrackDeal", dealId: deal.id, trackId, verified });
    setTicking(({ [trackId]: _done, ...rest }) => rest);
  };
  const now = new Date();
  const e = est(deal.app);
  const sponsor = deal.sponsor;
  const signed = deal.creditReview;
  const open = IN_REVIEW.includes(deal.status) && !signed;
  const flags = creditFlags(sponsor, e, now);
  const claimed = sponsor ? countedDeals(sponsor.trackRecord, now) : undefined;
  const verified = sponsor ? countedDeals(sponsor.trackRecord, now, true) : undefined;

  if (editing) return <Section title="Borrower profile"><SponsorEditor deal={deal} onDone={() => setEditing(false)} /></Section>;
  return (
    <div className="space-y-4" data-testid="credit-review">
      <Section title="Credit review" right={signed ? <Badge tone="green">Signed off</Badge> : <Badge tone="amber">Waiting for sign-off</Badge>}>
        {flags.length ? (
          <ul className="space-y-1 text-sm text-warn" data-testid="credit-flags">{flags.map((flag) => <li key={flag}>· {flag}</li>)}</ul>
        ) : <p className="text-sm text-muted-foreground" data-testid="credit-flags">Nothing stands out.</p>}
        {!sponsor && IN_REVIEW.includes(deal.status) && <p className="mt-3 text-sm text-muted-foreground">The borrower is asked to complete it on their loan page. <button className="text-link underline underline-offset-2" data-testid="fill-sponsor" onClick={() => setEditing(true)}>Fill it in for them</button></p>}
      </Section>

      {sponsor && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Entity and guarantors" right={open ? <button className="text-xs text-link underline underline-offset-2" data-testid="edit-sponsor" onClick={() => setEditing(true)}>Edit</button> : undefined}>
            <p className="text-sm">{deal.entityName} · formed in {sponsor.entityState}</p>
            <table className="stack-table mt-2 w-full">
              <thead><tr className="border-b border-rule"><th>Guarantor</th><th className="text-right">Owns</th><th className="text-right">Score</th><th>Citizenship</th></tr></thead>
              <tbody>{sponsor.guarantors.map((item, index) => <tr key={index} className="border-b border-border last:border-0"><td className="font-medium">{item.name}</td><td data-label="Owns" className="text-right">{item.ownershipPct}%</td><td data-label="Score" className="text-right">{item.fico}</td><td data-label="Citizenship">{CITIZENSHIP[item.citizenship]}</td></tr>)}</tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">Priced on the lowest score: {qualifyingFico(sponsor.guarantors)}. Self-reported until the credit pull.</p>
          </Section>
          <Section title="Credit questions">
            {DECLARATIONS.some((item) => sponsor.declarations[item.key]) ? (
              <div data-testid="declaration-answers">
                <ul className="space-y-1 text-sm">{DECLARATIONS.filter((item) => sponsor.declarations[item.key]).map((item) => <li key={item.key} className="text-bad">Yes: {item.question}</li>)}</ul>
                <p className="mt-2 rounded-[2px] bg-muted p-2 text-sm whitespace-pre-wrap">{sponsor.declarations.explanation}</p>
              </div>
            ) : <p className="text-sm text-muted-foreground" data-testid="declaration-answers">Answered no to all {DECLARATIONS.length}.</p>}
          </Section>
        </div>
      )}

      {sponsor && (
        <Section title={`Past deals (${verified!.deals} of ${claimed!.deals} verified)`}>
          {sponsor.trackRecord.length ? (
            <table className="stack-table w-full" data-testid="track-table">
              <thead><tr className="border-b border-rule"><th>Property</th><th>Type</th><th>Finished</th><th className="text-right">Paid</th><th className="text-right">Sold or value</th><th>Verified</th></tr></thead>
              <tbody>{sponsor.trackRecord.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="font-medium">{item.address}</td>
                  <td data-label="Type">{TRACK_KIND[item.kind]}</td>
                  <td data-label="Finished">{item.completed}</td>
                  <td data-label="Paid" className="text-right">{usd(item.purchasePrice)}</td>
                  <td data-label="Sold or value" className="text-right">{item.salePrice ? usd(item.salePrice) : "—"}</td>
                  <td data-label="Verified"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`verify-${item.id}`} disabled={!open || item.id in ticking} checked={ticking[item.id] ?? Boolean(item.verified)} onChange={(event) => void verify(item.id, event.target.checked)} />Checked</label></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="text-sm text-muted-foreground">No past deals listed: priced as a first-time investor.</p>}
          <p className="mt-2 text-xs text-muted-foreground" data-testid="experience-effect">Only deals finished in the last {EXPERIENCE_MONTHS} months count. {signed ? `Priced on ${signed.verifiedDeals} verified.` : `Priced on ${claimed!.deals} claimed now (tier ${experienceTier(claimed!.deals)}). Signing off prices it on ${verified!.deals} verified (tier ${experienceTier(verified!.deals)}).`}</p>
        </Section>
      )}

      <Section title="Sign-off">
        {signed ? (
          <div className="text-sm" data-testid="credit-signed">
            <p>Signed off by <b className="font-medium">{signed.by}</b> on {shortDate(signed.at)}.</p>
            {signed.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{signed.note}</p>}
            {IN_REVIEW.includes(deal.status) && <button className="btn-ghost mt-3" data-testid="reopen-credit" onClick={() => dispatch({ t: "reopenCreditReview", dealId: deal.id })}>Reopen the review</button>}
          </div>
        ) : open ? (
          <div className="space-y-3">
            <label className="block"><span className="label">Notes for the file (optional)</span><textarea className="desk-input h-auto! py-2" rows={3} maxLength={2000} data-testid="credit-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What you checked and why it's acceptable." /></label>
            <button className="btn-primary" data-testid="sign-off-credit" onClick={() => dispatch({ t: "signOffCredit", dealId: deal.id, by: viewerName, note })}>Sign off credit review</button>
            <p className="text-xs text-muted-foreground">Takes term sheet authority. Once signed, the profile and verified deals are locked until someone reopens the review.</p>
          </div>
        ) : <p className="text-sm text-muted-foreground">This loan is past credit review.</p>}
      </Section>
    </div>
  );
}
