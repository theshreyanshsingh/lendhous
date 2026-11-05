"use client";
import { useServiceDay } from "@/components/loan/use-service-day";
import { usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { floridaDay } from "@/lib/loan-timeline";
import type { Deal } from "@/lib/mockData";
import { firstDueDate, SERVICED } from "@/lib/servicing";
import { est } from "@/lib/store";

/** How many days after funding the borrower still sees the note. */
export const FUNDED_NOTE_DAYS = 7;

/** A quiet note on the borrower's loan in the week it funds: how much went out, and what happens next. */
export function FundedNote({ deal }: { deal: Deal }) {
  const today = useServiceDay();
  const fundedAt = deal.stages?.find((stage) => stage.status === "funded")?.at;
  if (!today || !fundedAt || !SERVICED.includes(deal.status)) return null;
  const on = floridaDay(fundedAt);
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000;
  if (age < 0 || age > FUNDED_NOTE_DAYS) return null;
  const e = est(deal.app);
  return (
    <section className="glass border-good/40 p-4" data-testid="funded-note">
      <p className="eyebrow mb-1 text-good">Funded</p>
      <h2 className="font-heading text-xl font-normal">Your loan funded on {shortDay(on)}.</h2>
      <p className="mt-1 text-sm text-muted-foreground">{usd(e.initialAdvance)} went to the closing{e.holdback > 0 ? `, and ${usd(e.holdback)} is set aside for the work, paid out in draws as it's done` : ""}. Your first payment is due {shortDay(firstDueDate(deal.closingDate))}.</p>
    </section>
  );
}
