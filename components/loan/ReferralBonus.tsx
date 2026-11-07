"use client";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { BONUS_STATE, bonusOf, bonusPaidProblem, PAY_WITHIN_BUSINESS_DAYS } from "@/lib/referrals";
import { useStore } from "@/lib/store";

/** A loan a LendHous borrower referred: who, and their bonus from expected to earned to paid (lib/referrals.ts). */
export function ReferralBonus({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const bonus = bonusOf(deal);
  const today = serviceDay(s);
  const [paid, setPaid] = useState({ amount: String(bonus.amount || ""), on: today, reference: "" });
  const referral = deal.friendReferral;
  if (!referral) return null;
  const problem = bonusPaidProblem(deal, Number(paid.amount), paid.on, today);
  return (
    <Section title="Borrower referral" right={<Badge tone={bonus.state === "paid" ? "green" : bonus.state === "earned" ? "amber" : "slate"}>{BONUS_STATE[bonus.state]}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="referral-bonus">
        <p>Referred by {referral.referrerName} on {shortDay(referral.on)} · {referral.bonus ? `${usd(referral.bonus, 0)} bonus once this loan funds` : "no bonus: the program was off"}</p>
        {referral.paid && <p className="text-good" data-testid="referral-paid">Paid {usd(referral.paid.amount, 2)} on {shortDay(referral.paid.on)}{referral.paid.reference ? ` (${referral.paid.reference})` : ""}, recorded by {referral.paid.by}.</p>}
        {bonus.state === "earned" && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="block"><span className="label">Amount paid</span><input className="desk-input w-32!" inputMode="decimal" data-testid="referral-paid-amount" value={paid.amount} onChange={(event) => setPaid({ ...paid, amount: event.target.value })} /></label>
            <label className="block"><span className="label">Paid on</span><input className="desk-input w-auto!" type="date" data-testid="referral-paid-on" value={paid.on} onChange={(event) => setPaid({ ...paid, on: event.target.value })} /></label>
            <label className="block min-w-0 flex-1 basis-40"><span className="label">Reference (optional)</span><input className="desk-input" maxLength={160} placeholder="ACH or check number" value={paid.reference} onChange={(event) => setPaid({ ...paid, reference: event.target.value })} /></label>
            <button type="button" className="btn-primary" data-testid="referral-paid-save" disabled={Boolean(problem)} title={problem ?? undefined} onClick={() => void dispatch({ t: "referralBonusPaid", dealId: deal.id, amount: Number(paid.amount), on: paid.on, reference: paid.reference, by: viewerName })}>Record it paid</button>
            <p className="w-full text-xs text-muted-foreground">Paid to {referral.referrerName} from LendHous&apos;s own account, aiming for {PAY_WITHIN_BUSINESS_DAYS} business days after funding. They&apos;re emailed when it&apos;s recorded. Bonuses of $600 or more in a year likely need a 1099-MISC: the Tax page lists them.</p>
          </div>
        )}
      </div>
    </Section>
  );
}
