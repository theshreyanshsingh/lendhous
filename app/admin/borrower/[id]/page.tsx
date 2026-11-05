"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { isClosedApplication, PRE_FUNDING } from "@/lib/loan-exits";
import { ledger, SERVICED } from "@/lib/servicing";
import { useStore, est } from "@/lib/store";
import { fundedBalances } from "@/lib/engine";
import { CloseApplication } from "@/components/loan/CloseApplication";
import { DrawPanel } from "@/components/loan/DrawPanel";
import { Extensions } from "@/components/loan/Extensions";
import { PaidOff } from "@/components/loan/PaidOff";
import { LoanMessages } from "@/components/loan/LoanMessages";
import { PaymentsPanel } from "@/components/loan/PaymentsPanel";
import { ScopeOfWork } from "@/components/loan/ScopeOfWork";
import { TermSheetCard } from "@/components/loan/TermSheetCard";
import { BorrowerConditions } from "@/components/loan/BorrowerConditions";
import { PropertyPhotos } from "@/components/loan/PropertyPhotos";
import { TeamContacts } from "@/components/loan/LoanTeam";
import { NeedsFromYou } from "@/components/loan/NeedsFromYou";
import { NextLoan } from "@/components/loan/NextLoan";
import { NextStepCard } from "@/components/loan/NextStepCard";
import { FundedNote } from "@/components/loan/FundedNote";
import { LoanTimeline } from "@/components/loan/LoanTimeline";
import { RehabProgress } from "@/components/loan/RehabProgress";
import { PropertyPicture } from "@/components/PropertyPicture";
import { Showcase } from "@/components/loan/Showcase";
import { interestBasis, PLAIN_RATIO } from "@/lib/status-words";
import { Badge, Section, Stat, usd, pct, productLabel, statusLabel } from "@/components/ui";
import type { DocStatus } from "@/lib/mockData";
import { shortDay } from "@/lib/format";

const docTone: Record<DocStatus, "slate" | "blue" | "amber" | "green" | "rose" | "violet"> = { requested: "amber", uploaded: "blue", in_review: "violet", accepted: "green", rejected: "rose", waived: "slate" };

export default function BorrowerLoan() {
  const { id } = useParams<{ id: string }>(); const { s, uploadDoc } = useStore();
  const d = s.deals.find((x) => x.id === id);
  const fileRef = useRef<HTMLInputElement>(null); const [target, setTarget] = useState<string | null>(null); const [drag, setDrag] = useState<string | null>(null);
  if (!d) return <div className="glass p-6">Loan not found. <Link className="underline" href="/admin/borrower">Back</Link></div>;
  const e = est(d.app); const funded = SERVICED.includes(d.status); const closed = isClosedApplication(d.status);
  const b = fundedBalances(e, d.app, d.disbursedDraws);
  const keyRatios = e.ratios.filter((r) => ["ltc", "ltarv", "ltv", "dscr"].includes(r.key)); // flip: LTC/LTARV · bridge: LTV · DSCR: LTV/DSCR
  const upload = (docId: string, file: File) => uploadDoc(d.id, docId, file);
  const cats = Array.from(new Set(d.docs.map((x) => x.category)));
  return (
    <div className="space-y-4">
      <Link href="/admin/borrower" className="text-sm text-link">← My loans</Link>
      <div className="glass p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <PropertyPicture deal={d} variant="header" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]} · {d.entityName}</div><h1 className="text-xl font-normal tracking-tight">{d.address}, {d.city} {d.zip}</h1></div><Badge tone={d.status === "default" ? "rose" : funded || d.status === "paid_off" ? "green" : closed ? "slate" : "blue"}>{statusLabel(d.status)}</Badge></div>
            {closed && <CloseApplication deal={d} side="borrower" />}
            {PRE_FUNDING.includes(d.status) && <div className="mt-3"><CloseApplication deal={d} side="borrower" /></div>}
          </div>
        </div>
        <LoanTimeline deal={d} side="client" />
      </div>
      <FundedNote deal={d} />
      <NextStepCard deal={d} />
      {(funded || d.status === "paid_off") && <NextLoan deal={d} />}
      {!closed && d.status !== "paid_off" && <div id="needs-from-you"><NeedsFromYou deal={d} /></div>}
      <div id="term-sheet"><TermSheetCard deal={d} canSign /></div>
      <div id="conditions"><BorrowerConditions deal={d} canUpload /></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
        <Section title="Document center" right={<span className="text-xs text-muted-foreground">{d.docs.filter((x) => x.status === "accepted").length}/{d.docs.length} accepted</span>}>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" data-testid="file-input"
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f && target) void upload(target, f); ev.target.value = ""; }} />
          <div className="space-y-4">
            {cats.map((c) => (
              <div key={c}><div className="mb-1.5 text-xs text-faint">{c}</div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {d.docs.filter((x) => x.category === c).map((x) => (
                    <li key={x.id} id={`doc-${x.id}`} data-testid={`doc-${x.id}`}
                      onDragOver={(ev) => { ev.preventDefault(); setDrag(x.id); }} onDragLeave={() => setDrag(null)}
                      onDrop={(ev) => { ev.preventDefault(); setDrag(null); const f = ev.dataTransfer.files?.[0]; if (f) void upload(x.id, f); }}
                      className={`flex flex-wrap items-center justify-between gap-2 p-3 ${drag === x.id ? "bg-active" : ""}`}>
                      <div className="min-w-0"><div className="text-sm font-medium">{x.name}</div>{x.fileName && (x.documentId ? <a href={`/api/documents/${x.documentId}`} className="block truncate text-xs text-link underline underline-offset-2" data-testid="doc-file">📎 {x.fileName}</a> : <div className="truncate text-xs text-muted-foreground">📎 {x.fileName}</div>)}{x.carriedFrom ? <div className="text-xs text-good" data-testid="doc-carried">On file from your loan {x.carriedFrom}</div> : x.note && x.status !== "accepted" && <div className="text-xs text-muted-foreground">{x.note}</div>}{x.status === "rejected" && <div className="text-xs text-bad">Rejected: please upload a clearer, complete copy</div>}</div>
                      <div className="flex items-center gap-2"><Badge tone={docTone[x.status]}>{statusLabel(x.status)}</Badge>
                        {(x.status === "requested" || x.status === "rejected" || x.status === "uploaded") && <button className="btn-ghost py-1 text-xs" onClick={() => { setTarget(x.id); fileRef.current?.click(); }}>{x.status === "uploaded" ? "Replace" : "Upload"}</button>}</div>
                    </li>))}
                </ul></div>))}
            <p className="text-xs text-faint">Drag and drop a file onto a row, or tap Upload (opens the camera on phones).</p>
          </div>
        </Section>
        {d.sponsor && ["submitted", "initial_review", "underwriting"].includes(d.status) && <Link href={`/admin/borrower/${d.id}/profile`} className="block text-sm text-link underline underline-offset-2" data-testid="edit-profile">Update your guarantors, past deals or credit answers</Link>}
        <div id="property-photos"><PropertyPhotos deal={d} side="client" /></div>
        <ScopeOfWork deal={d} editable />
        <div id="messages"><LoanMessages dealId={d.id} side="borrower" /></div>
        </div>
        <div className="min-w-0 space-y-4">
          <Section title={funded ? "Loan balance" : "Estimated terms"}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Note amount" value={usd(e.noteAmount)} />
              <Stat label="Rate" value={`${e.rate.toFixed(2)}%`} sub={interestBasis(d.app.product, d.app.accrual)} />
              {funded ? <><Stat label="Disbursed" value={usd(b.disbursed)} /><Stat label="Holdback left" value={usd(b.holdbackRemaining)} /><Stat label="Next payment" value={usd(b.nextPayment)} sub={ledger(d).nextDue ? `due ${shortDay(ledger(d).nextDue!)}` : "—"} /><Stat label="Maturity" value={shortDay(ledger(d).maturity)} sub={`${e.termMonths}-month term${d.extensions?.some((x) => x.status === "executed") ? ", extended" : ""}`} /></>
                : <><Stat label="Cash to close" value={usd(e.cashToClose)} /><Stat label="Target closing" value={shortDay(d.closingDate)} />{keyRatios.map((r) => <Stat key={r.key} label={PLAIN_RATIO[r.key] ?? r.label} value={r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual)} />)}<Stat label="Points" value={usd(e.points)} /></>}
            </div>
          </Section>
          {funded && e.holdback > 0 && <RehabProgress deal={d} />}
          {funded && e.holdback > 0 && <DrawPanel deal={d} />}
          {funded && <div id="payments"><PaymentsPanel deal={d} /></div>}
          {funded && <Extensions deal={d} side="borrower" />}
          {d.status === "paid_off" && <PaidOff deal={d} side="borrower" />}
          {d.closing && PRE_FUNDING.includes(d.status) && (
            <Section title="Closing">
              <div className="text-sm" data-testid="borrower-closing"><p className="font-medium">{d.closing.company}</p><p className="text-muted-foreground">{[d.closing.contact, d.closing.phone].filter(Boolean).join(" · ")}{d.closing.fileNumber ? ` · file ${d.closing.fileNumber}` : ""}</p><p className="mt-1 text-muted-foreground">Target closing {shortDay(d.closingDate)}.</p></div>
              <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">If you&apos;re wiring money to close, call the title company at a number you looked up yourself to confirm their instructions before you send it. Instructions that change by email are a scam.</p>
            </Section>
          )}
          {(funded || d.status === "paid_off") && <Showcase deal={d} side="client" />}
          <Section title="Your team"><TeamContacts deal={d} /><div className="mt-3 rounded-md bg-bad/10 p-2 text-xs text-bad">Wire-fraud warning: we will never email you wire instructions. Always confirm by phone with a number you already have.</div></Section>
        </div>
      </div>
    </div>
  );
}
