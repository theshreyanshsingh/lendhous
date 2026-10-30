"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { useStore, est } from "@/lib/store";
import { fundedBalances, maturityDate } from "@/lib/engine";
import Tracker from "@/components/Tracker";
import { Badge, Section, Stat, usd, pct, productLabel, statusLabel } from "@/components/ui";
import type { DocStatus } from "@/lib/mockData";

const docTone: Record<DocStatus, "slate" | "blue" | "amber" | "green" | "rose" | "violet"> = { requested: "amber", uploaded: "blue", in_review: "violet", accepted: "green", rejected: "rose", waived: "slate" };

export default function BorrowerLoan() {
  const { id } = useParams<{ id: string }>(); const { s, dispatch } = useStore();
  const d = s.deals.find((x) => x.id === id);
  const fileRef = useRef<HTMLInputElement>(null); const [target, setTarget] = useState<string | null>(null); const [drag, setDrag] = useState<string | null>(null);
  if (!d) return <div className="glass p-6">Loan not found. <Link className="underline" href="/borrower">Back</Link></div>;
  const e = est(d.app); const funded = ["servicing_current", "servicing_delinquent", "funded", "matured"].includes(d.status);
  const b = fundedBalances(e, d.app, d.disbursedDraws);
  const keyRatios = e.ratios.filter((r) => ["ltc", "ltarv", "ltv", "dscr"].includes(r.key)); // flip: LTC/LTARV · bridge: LTV · DSCR: LTV/DSCR
  const upload = (docId: string, name: string) => dispatch({ t: "uploadDoc", dealId: d.id, docId, fileName: name });
  const cats = Array.from(new Set(d.docs.map((x) => x.category)));
  return (
    <div className="space-y-4">
      <Link href="/borrower" className="text-sm text-link">← My loans</Link>
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]} · {d.entityName}</div><h1 className="text-xl font-normal tracking-tight">{d.address}, {d.city} {d.zip}</h1></div><Badge tone={funded ? "green" : "blue"}>{statusLabel(d.status)}</Badge></div>
        <div className="mt-4"><Tracker status={d.status} /></div>
        <div className="mt-3 text-sm text-muted-foreground">Next step: {funded ? "Make your monthly payment or request a draw." : d.docs.some((x) => x.status === "requested" || x.status === "rejected") ? "Upload the documents marked Requested below." : "Your team is reviewing. We'll notify you of the next step."}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Section title="Document center" right={<span className="text-xs text-muted-foreground">{d.docs.filter((x) => x.status === "accepted").length}/{d.docs.length} accepted</span>}>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic" capture="environment" data-testid="file-input"
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f && target) upload(target, f.name); ev.target.value = ""; }} />
          <div className="space-y-4">
            {cats.map((c) => (
              <div key={c}><div className="mb-1.5 text-xs text-faint">{c}</div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {d.docs.filter((x) => x.category === c).map((x) => (
                    <li key={x.id} data-testid={`doc-${x.id}`}
                      onDragOver={(ev) => { ev.preventDefault(); setDrag(x.id); }} onDragLeave={() => setDrag(null)}
                      onDrop={(ev) => { ev.preventDefault(); setDrag(null); const f = ev.dataTransfer.files?.[0]; if (f) upload(x.id, f.name); }}
                      className={`flex flex-wrap items-center justify-between gap-2 p-3 ${drag === x.id ? "bg-active" : ""}`}>
                      <div className="min-w-0"><div className="text-sm font-medium">{x.name}</div>{x.fileName && <div className="truncate text-xs text-muted-foreground">📎 {x.fileName}</div>}{x.status === "rejected" && <div className="text-xs text-bad">Rejected: please upload a clearer, complete copy</div>}</div>
                      <div className="flex items-center gap-2"><Badge tone={docTone[x.status]}>{statusLabel(x.status)}</Badge>
                        {(x.status === "requested" || x.status === "rejected" || x.status === "uploaded") && <button className="btn-ghost py-1 text-xs" onClick={() => { setTarget(x.id); fileRef.current?.click(); }}>{x.status === "uploaded" ? "Replace" : "Upload"}</button>}</div>
                    </li>))}
                </ul></div>))}
            <p className="text-xs text-faint">Drag and drop a file onto a row, or tap Upload (opens the camera on phones).</p>
          </div>
        </Section>
        <div className="space-y-4">
          <Section title={funded ? "Loan balance" : "Estimated terms"}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Note amount" value={usd(e.noteAmount)} />
              <Stat label="Rate" value={`${e.rate.toFixed(2)}%`} sub={d.app.product === "dscr" ? "30-yr amortizing" : d.app.accrual === "dutch" ? "on disbursed funds" : "full-boat"} />
              {funded ? <><Stat label="Disbursed" value={usd(b.disbursed)} /><Stat label="Holdback left" value={usd(b.holdbackRemaining)} /><Stat label="Next payment" value={usd(b.nextPayment)} sub={`due ${d.nextPaymentDue}`} /><Stat label="Maturity" value={maturityDate(d.closingDate, e.termMonths)} sub={`${e.termMonths}-month term`} /></>
                : <><Stat label="Cash to close" value={usd(e.cashToClose)} /><Stat label="Target closing" value={d.closingDate} /><Stat label={keyRatios.map((r) => r.label).join(" / ")} value={keyRatios.map((r) => (r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual))).join(" / ")} /><Stat label="Points" value={usd(e.points)} /></>}
            </div>
          </Section>
          {funded && <Section title="Draws"><div className="text-sm text-muted-foreground">Budget {usd(e.holdback)} · released {usd(d.disbursedDraws ?? 0)}</div><div className="mt-2 h-2 rounded-full bg-accent"><div className="h-2 rounded-full bg-good" style={{ width: `${((d.disbursedDraws ?? 0) / Math.max(1, e.holdback)) * 100}%` }} /></div><button className="btn-primary mt-3 w-full" disabled>Request a draw (coming soon)</button></Section>}
          <Section title="Your team"><div className="text-sm">Processor: Pat Processor (FAKE)<br />Underwriter: Uma Underwriter (FAKE)</div><div className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">Wire-fraud warning: we will never email you wire instructions. Always confirm by phone with a number you already have.</div></Section>
        </div>
      </div>
    </div>
  );
}
