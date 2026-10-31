"use client";
import { useState } from "react";
import { maturityDate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { est, useStore } from "@/lib/store";
import { Badge, Section, Stat, shortDate, usd } from "@/components/ui";

/** The offer in plain numbers. The borrower accepts it here by typing their name. Anyone else only reads it. */
export function TermSheetCard({ deal, canSign }: { deal: Deal; canSign: boolean }) {
  const { dispatch } = useStore();
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const e = est(deal.app);
  const waiting = deal.status === "term_sheet_issued";
  if (!waiting && !deal.termSheetSignedBy) return null;
  return (
    <Section title="Term sheet" right={waiting ? <Badge tone="amber">Waiting for acceptance</Badge> : <Badge tone="green">Accepted</Badge>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="term-sheet">
        <Stat label="Loan amount" value={usd(e.noteAmount)} />
        <Stat label="Rate" value={`${e.rate.toFixed(3)}%`} sub={deal.app.product === "dscr" ? "30-year amortizing" : "interest only"} />
        <Stat label="Points" value={usd(e.points)} sub={`${e.pointsPct}%`} />
        <Stat label="Term" value={`${e.termMonths} months`} sub={`matures ${maturityDate(deal.closingDate, e.termMonths)}`} />
        <Stat label="Cash to close" value={usd(e.cashToClose)} />
        <Stat label="Target closing" value={deal.closingDate} />
      </div>
      {deal.termSheetSignedBy && <p className="mt-3 text-sm text-muted-foreground" data-testid="term-sheet-signed">Accepted by {deal.termSheetSignedBy}{deal.termSheetSignedAt ? ` on ${shortDate(deal.termSheetSignedAt)}` : ""}.</p>}
      {waiting && canSign && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <label className="block"><span className="label">Type your full name to accept</span><input data-testid="term-sheet-name" className="desk-input" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm"><input data-testid="term-sheet-agree" type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> I accept these terms. I understand this isn&apos;t a commitment to lend, and final terms depend on underwriting.</label>
          <button className="btn-primary w-full sm:w-auto" data-testid="accept-term-sheet" disabled={!agreed || !name.trim()} onClick={() => dispatch({ t: "acceptTermSheet", dealId: deal.id, signedName: name })}>Accept term sheet</button>
        </div>
      )}
      {waiting && !canSign && <p className="mt-3 text-sm text-muted-foreground">Waiting for the borrower to accept this.</p>}
    </Section>
  );
}
