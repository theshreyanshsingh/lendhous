"use client";
import Link from "next/link";
import { useState } from "react";
import { isClosedApplication } from "@/lib/loan-exits";
import { ledger, SERVICED } from "@/lib/servicing";
import { useStore, est } from "@/lib/store";
import { fundedBalances } from "@/lib/engine";
import Tracker from "@/components/Tracker";
import { PageIntro } from "@/components/page-intro";
import { Badge, usd, productLabel, statusLabel, Stat } from "@/components/ui";
import { BorrowerLetters } from "@/components/BorrowerLetters";
import { ReferAFriend } from "@/components/ReferAFriend";
import { EmptyArt } from "@/components/art/HouseArt";
import { OPEN_UPLOAD } from "@/components/UploadSheet";
import { PropertyPicture } from "@/components/PropertyPicture";
import { shortDay } from "@/lib/format";
import { itemsOwed, nextStepFor } from "@/lib/next-step";

const ENDED = ["declined", "withdrawn", "paid_off"];

export default function BorrowerHome() {
  const { s, viewerName } = useStore();
  const all = s.deals.filter((d) => d.borrowerId === s.borrowerId);
  const closedLoans = all.filter((d) => ENDED.includes(d.status));
  const [shown, setShown] = useState<"active" | "closed">("active");
  const mine = shown === "closed" ? closedLoans : all.filter((d) => !ENDED.includes(d.status));
  const tasks = mine.flatMap((d) => d.docs.filter((x) => x.status === "requested" || x.status === "rejected").map((x) => ({ d, x })));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0"><PageIntro eyebrow="Welcome back" title={viewerName} lede="Your applications and funded loans. Open one to see its next step and upload documents." /></div>
        <Link href="/admin/apply" className="btn-primary mb-6">+ Apply for a loan</Link>
      </div>
      {tasks.length > 0 && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 border-warn/30 bg-warn/12 p-4 text-sm text-warn" data-testid="docs-owed">
          <p className="min-w-0 flex-1 basis-48"><b>{tasks.length} document{tasks.length > 1 ? "s" : ""} needed</b> across your loans.<span className="max-md:hidden"> Open a loan to upload.</span></p>
          {/* On a phone, all of them in one sheet, straight from the camera. */}
          <button type="button" className="btn-primary h-11! w-full md:hidden" data-testid="upload-now" onClick={() => window.dispatchEvent(new Event(OPEN_UPLOAD))}>Upload now</button>
        </div>
      )}
      <BorrowerLetters />
      <ReferAFriend />
      {closedLoans.length > 0 && (
        <div className="flex gap-2" role="tablist" aria-label="Your loans">
          {([["active", "Active", all.length - closedLoans.length], ["closed", "Paid off, declined and withdrawn", closedLoans.length]] as const).map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={shown === key} data-testid={`loans-tab-${key}`} onClick={() => setShown(key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${shown === key ? "bg-primary text-primary-foreground" : "border border-rule text-muted-foreground hover:text-foreground"}`}>{label} ({count})</button>)}
        </div>
      )}
      {all.length === 0 && <div className="glass flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground" data-testid="no-loans"><EmptyArt className="h-24 w-32" />No loans yet. Start an application to get an instant estimate.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {mine.map((d) => {
          const e = est(d.app); const funded = SERVICED.includes(d.status);
          const open = d.docs.filter((x) => x.status === "requested" || x.status === "rejected").length;
          const b = fundedBalances(e, d.app, d.disbursedDraws);
          const step = nextStepFor(d);
          const owed = itemsOwed(d);
          return (
            <div key={d.id} className="min-w-0">
            <Link href={`/admin/borrower/${d.id}`} className="glass block min-w-0 overflow-hidden transition-colors hover:border-faint" data-testid="borrower-loan-card">
              <PropertyPicture deal={d} variant="card" />
              <div className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]}</div><div className="text-lg font-semibold">{d.address}, {d.city}</div></div>
                <Badge tone={d.status === "default" ? "rose" : funded || d.status === "paid_off" ? "green" : isClosedApplication(d.status) ? "slate" : "blue"}>{statusLabel(d.status)}</Badge>
              </div>
              <div className="my-4"><Tracker status={d.status} /></div>
              {funded ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Disbursed principal" value={usd(b.disbursed)} />
                  <Stat label="Holdback remaining" value={usd(b.holdbackRemaining)} />
                  <Stat label="Next payment" value={usd(b.nextPayment)} sub={ledger(d).nextDue ? `due ${shortDay(ledger(d).nextDue)}` : "none due"} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Est. loan" value={usd(e.noteAmount)} />
                  <Stat label="Est. rate" value={`${e.rate.toFixed(2)}%`} />
                  <Stat label="Docs needed" value={open} sub={open ? "tap to upload" : "all in"} />
                </div>
              )}
              {step && <p className="mt-4 border-t border-border pt-3 text-sm" data-testid="card-next-step"><span className="text-muted-foreground">Next: </span>{step.title}</p>}
              </div>
            </Link>
            {owed > 0 && (
              <Link href={`/admin/borrower/${d.id}#documents`} className="-mt-px flex flex-wrap items-center justify-between gap-2 rounded-b-[2px] border border-warn/30 bg-warn/12 px-5 py-3 text-sm text-warn hover:bg-warn/20" data-testid="card-send-docs">
                <span><b className="font-semibold">{owed} item{owed === 1 ? "" : "s"}</b> still needed from you</span>
                <span className="font-medium">Send documents for this loan →</span>
              </Link>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
