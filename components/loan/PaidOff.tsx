"use client";
import { useState } from "react";
import { lienReleaseDaysLeft, lienReleaseDue } from "@/lib/loan-exits";
import type { Deal } from "@/lib/mockData";
import { METHODS } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";

/** A paid-off loan: the money that paid it, and the satisfaction of mortgage from being sent to being recorded. */
export function PaidOff({ deal, side }: { deal: Deal; side: "team" | "borrower" }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [step, setStep] = useState<"sent" | "recorded" | null>(null);
  const [on, setOn] = useState("");
  const [reference, setReference] = useState("");
  const paid = deal.paidOff;
  if (!paid) return <Section title="Paid off"><p className="text-sm text-muted-foreground">This loan is paid in full.</p></Section>;
  const release = paid.release;
  const due = lienReleaseDue(deal)!;
  const left = today ? lienReleaseDaysLeft(deal, today) : 0;
  const over = paid.amount - paid.owed;
  const day = on || today;
  const save = async () => {
    if (step && await dispatch({ t: "recordLienRelease", dealId: deal.id, step, on: day, reference: reference.trim(), by: viewerName })) { setStep(null); setOn(""); setReference(""); }
  };
  return (
    <Section title="Paid off" right={<Badge tone="green">Paid in full</Badge>}>
      <div className="space-y-1 text-sm" data-testid="paid-off">
        <p>{usd(paid.amount, 2)} received {shortDay(paid.receivedOn)} by {METHODS[paid.method].toLowerCase()}{paid.reference ? ` (${paid.reference})` : ""}.</p>
        {side === "team" && <p className="text-xs text-muted-foreground">The payoff that day was {usd(paid.owed, 2)}.{over >= 0.01 ? ` ${usd(over, 2)} is owed back to the borrower.` : ""}{paid.by ? ` Recorded by ${paid.by}.` : ""}</p>}
      </div>
      <div className="mt-3 border-t border-border pt-3 text-sm" data-testid="lien-release">
        <p className="font-medium">Release of the mortgage</p>
        {release?.recordedOn ? (
          <p className="mt-1 text-good" data-testid="lien-recorded">Recorded {shortDay(release.recordedOn)}{release.reference ? ` (${release.reference})` : ""}.</p>
        ) : side === "borrower" ? (
          <p className="mt-1 text-muted-foreground">{release?.sentOn ? `Sent to be recorded on ${shortDay(release.sentOn)}.` : "We're preparing the satisfaction of your mortgage."} We&apos;ll tell you once it&apos;s recorded.</p>
        ) : (
          <>
            <p className={`mt-1 ${left < 0 ? "text-bad" : left <= 14 ? "text-warn" : "text-muted-foreground"}`} data-testid="lien-due">{release?.sentOn ? `Sent for recording ${shortDay(release.sentOn)}. ` : ""}Due out by {due}{today ? ` (${left < 0 ? `${-left} days late` : `${left} days left`})` : ""}.</p>
            {!step ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {!release?.sentOn && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="lien-sent" onClick={() => setStep("sent")}>Sent for recording</button>}
                <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="lien-record" onClick={() => setStep("recorded")}>Recorded</button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block"><span className="label">{step === "sent" ? "Sent on" : "Recorded on"}</span><input className="desk-input" data-testid="lien-date" type="date" min={paid.receivedOn} max={today || undefined} value={day} onChange={(event) => setOn(event.target.value)} /></label>
                <label className="block min-w-0 flex-1 basis-48"><span className="label">{step === "sent" ? "Sent to (optional)" : "Book and page, or instrument number"}</span><input className="desk-input" data-testid="lien-reference" maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
                <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="save-lien" disabled={step === "recorded" && !reference.trim()} onClick={save}>Save</button>
                <button type="button" className="btn-ghost h-10! px-3! text-xs!" onClick={() => setStep(null)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
