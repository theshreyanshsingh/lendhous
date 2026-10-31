"use client";
import Link from "next/link";
import { useStore, est } from "@/lib/store";
import { fundedBalances } from "@/lib/engine";
import Tracker from "@/components/Tracker";
import { PageIntro } from "@/components/page-intro";
import { Badge, usd, productLabel, statusLabel, Stat } from "@/components/ui";

export default function BorrowerHome() {
  const { s, viewerName } = useStore();
  const mine = s.deals.filter((d) => d.borrowerId === s.borrowerId);
  const tasks = mine.flatMap((d) => d.docs.filter((x) => x.status === "requested" || x.status === "rejected").map((x) => ({ d, x })));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0"><PageIntro eyebrow="Welcome back" title={viewerName} lede="Your applications and funded loans. Open one to see its next step and upload documents." /></div>
        <Link href="/admin/apply" className="btn-primary mb-6">+ Start a new loan</Link>
      </div>
      {tasks.length > 0 && <div className="glass border-warn/30 bg-warn/12 p-4 text-sm text-warn"><b>{tasks.length} document{tasks.length > 1 ? "s" : ""} needed</b> across your loans. Open a loan to upload.</div>}
      {mine.length === 0 && <div className="glass p-6 text-sm text-muted-foreground" data-testid="no-loans">No loans yet. Start an application to get an instant estimate.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {mine.map((d) => {
          const e = est(d.app); const funded = ["servicing_current", "servicing_delinquent", "funded", "matured"].includes(d.status);
          const open = d.docs.filter((x) => x.status === "requested" || x.status === "rejected").length;
          const b = fundedBalances(e, d.app, d.disbursedDraws);
          return (
            <Link key={d.id} href={`/admin/borrower/${d.id}`} className="glass block min-w-0 p-5 transition-colors hover:border-faint" data-testid="borrower-loan-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]}</div><div className="text-lg font-semibold">{d.address}, {d.city}</div></div>
                <Badge tone={funded ? "green" : "blue"}>{statusLabel(d.status)}</Badge>
              </div>
              <div className="my-4"><Tracker status={d.status} /></div>
              {funded ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Disbursed principal" value={usd(b.disbursed)} />
                  <Stat label="Holdback remaining" value={usd(b.holdbackRemaining)} />
                  <Stat label="Next payment" value={usd(b.nextPayment)} sub={`due ${d.nextPaymentDue}`} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Est. loan" value={usd(e.noteAmount)} />
                  <Stat label="Est. rate" value={`${e.rate.toFixed(2)}%`} />
                  <Stat label="Docs needed" value={open} sub={open ? "tap to upload" : "all in"} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
