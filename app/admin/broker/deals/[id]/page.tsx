"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocUpload } from "@/components/loan/DocUpload";
import { LoanMessages } from "@/components/loan/LoanMessages";
import { TermSheetCard } from "@/components/loan/TermSheetCard";
import Tracker from "@/components/Tracker";
import { Badge, Section, Stat, points, productLabel, statusLabel, usd } from "@/components/ui";
import { est, useStore } from "@/lib/store";

export default function BrokerDeal() {
  const { id } = useParams<{ id: string }>();
  const { s } = useStore();
  const deal = s.deals.find((item) => item.id === id && item.brokerId === s.brokerId);
  if (!deal) return <div className="glass p-6">This deal isn&apos;t one of yours. <Link className="underline" href="/admin/broker">Back to my deals</Link></div>;
  const e = est(deal.app);
  return (
    <div className="space-y-4">
      <Link href="/admin/broker" className="text-sm text-link">← My deals</Link>
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><div className="text-xs text-muted-foreground">{deal.loanNumber} · {productLabel[deal.app.product]} · {deal.entityName}</div><h1 className="text-xl font-normal tracking-tight">{deal.borrowerName}</h1><div className="text-sm text-muted-foreground">{deal.address}, {deal.city} {deal.zip}</div></div>
          <Badge tone="blue">{statusLabel(deal.status)}</Badge>
        </div>
        <div className="mt-4"><Tracker status={deal.status} /></div>
      </div>
      <TermSheetCard deal={deal} canSign={false} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Section title="Documents" right={<span className="text-xs text-muted-foreground">{deal.docs.filter((doc) => doc.status === "accepted").length}/{deal.docs.length} accepted</span>}>
            <ul className="divide-y divide-border">{deal.docs.map((doc) => <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="broker-doc"><span className="min-w-0 text-sm">{doc.name}{doc.documentId && <a className="block text-xs text-link underline underline-offset-2" href={`/api/documents/${doc.documentId}`}>{doc.fileName}</a>}</span><span className="flex flex-wrap items-center gap-2"><Badge tone={doc.status === "accepted" ? "green" : doc.status === "requested" || doc.status === "rejected" ? "amber" : "slate"}>{statusLabel(doc.status)}</Badge><DocUpload dealId={deal.id} doc={doc} /></span></li>)}</ul>
          </Section>
          <LoanMessages dealId={deal.id} side="broker" />
        </div>
        <div className="min-w-0 space-y-4">
          <Section title="Numbers">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Loan" value={usd(e.noteAmount)} />
              <Stat label="Rate" value={`${e.rate.toFixed(2)}%`} />
              <Stat label="Your fee" value={usd((e.noteAmount * (deal.brokerPoints ?? 0)) / 100)} sub={`${points(deal.brokerPoints)}, paid at closing`} />
              <Stat label="Target closing" value={deal.closingDate} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
