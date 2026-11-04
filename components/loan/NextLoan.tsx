"use client";
import Link from "next/link";
import { serviceDay } from "@/lib/book";
import { repeatTierOf, repeatTiersOf } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { currentPricing } from "@/lib/pricing-versions";
import { repeatHistory } from "@/lib/repeat-borrower";
import { useStore } from "@/lib/store";

/**
 * On a funded or paid-off loan: the next loan, started with this one's entity, guarantors and past deals, and what the
 * borrower's record with LendHous takes off its price.
 */
export function NextLoan({ deal }: { deal: Deal }) {
  const { s } = useStore();
  const history = repeatHistory(s.deals, s.borrowerId, serviceDay(s));
  const config = currentPricing();
  const tier = repeatTierOf({ repeat: history }, config);
  const next = repeatTiersOf(config).filter((item) => item.loans > history.loans).sort((a, b) => a.loans - b.loans)[0];
  const more = next ? next.loans - history.loans : 0;
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-4" data-testid="next-loan">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-base font-medium">Another property?</h2>
        <p className="text-sm text-muted-foreground" data-testid="repeat-status">
          {history.pausedBy
            ? `A late payment on ${history.pausedBy} in the last 24 months pauses your repeat-borrower pricing until it's 24 months behind you.`
            : tier
              ? `Your ${history.loans} LendHous loan${history.loans === 1 ? "" : "s"} paid as agreed take${history.loans === 1 ? "s" : ""} ${tier.rateCut}% off the rate${tier.pointsCut ? ` and ${tier.pointsCut} points off the fee` : ""} on your next one.`
              : "Loans you pay as agreed with LendHous lower the price of the next ones."}
          {!history.pausedBy && next ? ` ${more} more ${more === 1 ? "takes" : "take"} it to ${next.rateCut}% off${next.pointsCut ? ` and ${next.pointsCut} points` : ""}.` : ""}
          {" "}Start with this loan&apos;s entity, guarantors and past deals filled in.
        </p>
      </div>
      <Link href={`/admin/apply?from=${deal.id}`} className="btn-primary" data-testid="new-loan-from">New loan on another property</Link>
    </div>
  );
}
