"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usd } from "@/components/ui";
import { referralPath } from "@/lib/brokers";
import { shortDay } from "@/lib/format";
import { canRefer, friendCodeFor, referralsBy, type MyReferral } from "@/lib/referrals";
import { useStore } from "@/lib/store";

const LINE: Record<MyReferral["state"], (item: MyReferral) => string> = {
  expected: () => "Waiting for their loan to fund",
  earned: (item) => `${usd(item.amount, 0)} earned: on its way`,
  paid: (item) => `${usd(item.amount, 0)} paid${item.paidOn ? ` on ${shortDay(item.paidOn)}` : ""}`,
  none: () => "No bonus: their application closed",
};

/**
 * A borrower's own referral link, once one of their loans has funded and while the program is on: a friend whose first
 * LendHous loan funds through it earns them the bonus (lib/referrals.ts). They see where each bonus stands, never the
 * friend's loan.
 */
export function ReferAFriend() {
  const { s, referralBonus } = useStore();
  const [copied, setCopied] = useState(false);
  // The site's address is only known in the browser, and a phone hands the link to its own share menu.
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); setCanShare(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches); }, []);
  if (!referralBonus || !canRefer(s.deals, s.borrowerId)) return null;
  const url = `${origin}${referralPath(friendCodeFor(s.borrowerId))}`;
  const mine = s.myReferrals ?? referralsBy(s.deals, s.borrowerId);
  const paid = mine.filter((item) => item.state === "paid").reduce((sum, item) => sum + item.amount, 0);
  const share = () => void navigator.share({ title: "LendHous investor loans", text: "I finance my deals with LendHous. See terms for yours in a minute, with no credit check:", url }).catch(() => {});
  return (
    <section className="glass space-y-3 p-4" data-testid="refer-friend" aria-labelledby="refer-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="refer-title" className="text-base font-medium">Refer an investor, earn {usd(referralBonus, 0)}</h2>
          <p className="text-sm text-muted-foreground">When someone you send has their first LendHous loan fund, we send you {usd(referralBonus, 0)}. There&apos;s no limit on how many.</p>
          <p className="mt-1 truncate font-mono text-xs" data-testid="friend-url">{url}</p>
        </div>
        <div className="flex gap-2 max-sm:w-full">
          {canShare && <button type="button" className="btn-primary max-sm:h-11 max-sm:flex-1" data-testid="share-friend" onClick={share}>Share link</button>}
          <button type="button" className="btn-ghost max-sm:h-11 max-sm:flex-1" data-testid="copy-friend" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      </div>
      {mine.length > 0 && (
        <div className="border-t border-border pt-3 text-sm">
          <p className="font-medium" data-testid="friend-summary">{mine.length} referral{mine.length === 1 ? "" : "s"}{paid ? ` · ${usd(paid, 0)} paid to you` : ""}</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">{mine.map((item, n) => <li key={`${item.on}-${n}`} data-testid="friend-referral">Referred {shortDay(item.on)}: {LINE[item.state](item)}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Your repeat-borrower pricing and the other perks are on the <Link href="/rewards" className="text-link">Rewards page</Link>.</p>
    </section>
  );
}
