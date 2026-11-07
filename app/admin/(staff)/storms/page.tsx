"use client";
import Link from "next/link";
import { useState } from "react";
import { checkStormsNow } from "@/actions/property-facts";
import { EmptyState } from "@/components/EmptyState";
import { PageIntro } from "@/components/page-intro";
import { useServiceDay } from "@/components/loan/use-service-day";
import { Badge, Section, Stat, k, shortDate, usd } from "@/components/ui";
import type { Deal } from "@/lib/mockData";
import { PHOTO_LINK_DAYS } from "@/lib/photo-requests";
import { DEMO_STORM, exposure, freshInspectionNeeded, loansInCone, type StormWatch } from "@/lib/storms";
import { useStore } from "@/lib/store";

/** Storm mode: which funded loans each hurricane's forecast cone covers, and the follow-ups once one has passed. */
export default function Storms() {
  const { s, dispatch, applyReply, local } = useStore();
  const storms = s.storms ?? [];
  const active = storms.filter((storm) => storm.status === "active");
  const passed = storms.filter((storm) => storm.status === "passed");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // A demo seat never reaches NHC: its first check finds the sample storm over South Florida, the next finds it gone and
  // asks those borrowers for photos, as the nightly job would.
  const demoCheck = async () => {
    const at = new Date().toISOString();
    const sample = storms.find((storm) => storm.id === DEMO_STORM.id);
    if (!sample) {
      await dispatch({ t: "recordStormCheck", at, storms: [{ id: DEMO_STORM.id, name: DEMO_STORM.name, label: DEMO_STORM.label, advisory: DEMO_STORM.advisory, dealIds: loansInCone(s.deals, DEMO_STORM.cone) }] });
      return `${DEMO_STORM.label} (a sample, not a real storm) is on watch. Check again to see it pass.`;
    }
    if (sample.status === "active") {
      await dispatch({ t: "recordStormCheck", at, storms: [] });
      for (const dealId of sample.dealIds) {
        const deal = s.deals.find((item) => item.id === dealId);
        if (deal) await dispatch({ t: "askForPhotos", requestId: `storm-${dealId}-${Date.now().toString(36)}`, dealId, stormId: sample.id, to: deal.borrowerName, who: "borrower", scopeIds: [], by: "LendHous servicing", byTeam: true, expiresAt: new Date(Date.now() + PHOTO_LINK_DAYS * 86_400_000).toISOString() });
      }
      return `${DEMO_STORM.label} has passed. Its ${sample.dealIds.length} borrowers were asked for photos (demo seats send nothing).`;
    }
    return "The sample storm has already passed. No other storm is on watch.";
  };
  const check = async () => {
    setBusy(true);
    setNote("");
    if (local) setNote(await demoCheck());
    else {
      const reply = await checkStormsNow().catch(() => ({ error: "That didn't go through. Check your connection and try again." }));
      applyReply(reply);
      setNote("summary" in reply && reply.summary ? `Checked: ${reply.summary}.` : "");
    }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Servicing" title="Storms" lede="When the National Hurricane Center's five-day forecast cone for an Atlantic storm covers a funded LendHous property, it shows here and the owners are emailed. It's checked every six hours, with each new advisory." />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" data-testid="check-storms" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check now"}</button>
        {note && <p className="min-w-0 flex-1 basis-60 text-sm text-muted-foreground" role="status" data-testid="storm-check-note">{note}</p>}
      </div>
      {!active.length && !passed.length && <EmptyState>No storm&apos;s forecast cone covers a LendHous property.</EmptyState>}
      {active.map((storm) => <ActiveStorm key={storm.id} storm={storm} />)}
      {passed.length > 0 && (
        <Section title="Passed">
          <ul className="divide-y divide-border">{passed.map((storm) => <PassedStorm key={storm.id} storm={storm} />)}</ul>
        </Section>
      )}
    </div>
  );
}

function ActiveStorm({ storm }: { storm: StormWatch }) {
  const { s } = useStore();
  const today = useServiceDay();
  const loans = storm.nowIn.map((id) => s.deals.find((deal) => deal.id === id)).filter((deal): deal is Deal => Boolean(deal));
  const earlier = storm.dealIds.filter((id) => !storm.nowIn.includes(id)).map((id) => s.deals.find((deal) => deal.id === id)?.loanNumber).filter(Boolean);
  const rows = today ? loans.map((deal) => ({ deal, at: exposure(deal, today) })) : [];
  return (
    <Section title={storm.label} right={<Badge tone="rose">On watch</Badge>}>
      <div data-testid="storm-active">
        <p className="text-xs text-muted-foreground">Advisory {storm.advisory} · first covered a loan {shortDate(storm.firstSeen)} · checked {shortDate(storm.lastSeen)}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="storm-total">
          <Stat label="Loans in the cone" value={loans.length} />
          <Stat label="Out on them" value={k(rows.reduce((sum, row) => sum + row.at.balance, 0))} />
          <Stat label="Left to draw" value={k(rows.reduce((sum, row) => sum + row.at.undrawn, 0))} />
          <Stat label="Wind not covered" value={rows.filter((row) => !row.at.wind).length} />
        </div>
        {loans.length ? (
          <table className="stack-table mt-3 w-full">
            <thead><tr className="border-b border-rule"><th>Loan</th><th className="text-right">Balance</th><th className="text-right">Left to draw</th><th>Insurance ends</th><th>Wind</th></tr></thead>
            <tbody>
              {rows.map(({ deal, at }) => (
                <tr key={deal.id} className="border-b border-border last:border-0" data-testid="storm-loan">
                  <td><Link className="font-medium text-link hover:underline" href={`/admin/deals/${deal.id}?tab=Servicing`}>{deal.loanNumber}</Link><small className="block text-xs text-muted-foreground">{deal.borrowerName} · {deal.address}, {deal.city}</small></td>
                  <td data-label="Balance" className="text-right tabular-nums">{usd(at.balance)}</td>
                  <td data-label="Left to draw" className="text-right tabular-nums">{usd(at.undrawn)}</td>
                  <td data-label="Insurance ends" className={at.lapsed.length ? "text-bad" : ""}>{at.insuranceEnds ? shortDate(`${at.insuranceEnds}T12:00:00Z`) : "Not on file"}{at.lapsed.length ? ` (${at.lapsed.join(", ")} lapsed)` : ""}</td>
                  <td data-label="Wind" className={at.wind ? "text-good" : "font-medium text-bad"} data-testid="storm-wind">{at.wind ? "Covered" : "Not covered"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-3 text-sm text-muted-foreground">The latest cone has moved off every LendHous property.</p>}
        {earlier.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Earlier cones also covered {earlier.join(", ")}. They&apos;re followed up once it passes too.</p>}
      </div>
    </Section>
  );
}

function PassedStorm({ storm }: { storm: StormWatch }) {
  const { s } = useStore();
  const asked = storm.followedUp ?? [];
  const requests = s.photoRequests.filter((request) => request.stormId === storm.id);
  const received = requests.filter((request) => request.finishedAt).length;
  // Draws waiting on an inspection from after the storm.
  const held = s.draws.filter((draw) => storm.dealIds.includes(draw.dealId) && freshInspectionNeeded(s.deals.find((deal) => deal.id === draw.dealId) ?? {}, draw));
  return (
    <li className="py-3 text-sm" data-testid="storm-passed">
      <div className="flex flex-wrap items-center justify-between gap-2"><b className="font-medium">{storm.label}</b><span className="text-xs text-muted-foreground">Passed {storm.passedAt ? shortDate(storm.passedAt) : ""}</span></div>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="storm-followup">{storm.dealIds.length} loan{storm.dealIds.length === 1 ? "" : "s"} covered · {asked.length} borrower{asked.length === 1 ? "" : "s"} asked for photos of the property · {received} sent them{held.length ? ` · ${held.length} draw${held.length === 1 ? "" : "s"} waiting for a fresh inspection` : ""}</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 text-xs">{storm.dealIds.map((id) => { const deal = s.deals.find((item) => item.id === id); return deal ? <li key={id}><Link className="text-link underline underline-offset-2" href={`/admin/deals/${id}?tab=Servicing`}>{deal.loanNumber}</Link>{requests.some((request) => request.dealId === id && request.finishedAt) ? " · photos in" : asked.includes(id) ? " · asked" : ""}</li> : null; })}</ul>
    </li>
  );
}
