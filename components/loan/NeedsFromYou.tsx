"use client";
import { PRE_FUNDING } from "@/lib/loan-exits";
import type { Deal } from "@/lib/mockData";

const IN = ["uploaded", "in_review", "accepted", "waived"];

/**
 * Everything the borrower still owes on one list at the top of their loan: documents asked for or sent back, their open
 * conditions, and photos of the property. Each item jumps to where it's done.
 */
export function NeedsFromYou({ deal }: { deal: Deal }) {
  const docs = deal.docs.filter((doc) => doc.status === "requested" || doc.status === "rejected");
  const conditions = (deal.conditions ?? []).filter((item) => item.owner === "borrower" && item.status === "open");
  const photos = PRE_FUNDING.includes(deal.status) && !deal.propertyPhotos?.length;
  const items = [
    ...docs.map((doc) => ({ key: doc.id, href: `#doc-${doc.id}`, label: doc.status === "rejected" ? `${doc.name}: sent back${doc.note ? ` (${doc.note})` : ""}` : doc.name })),
    ...conditions.map((item) => ({ key: item.id, href: "#conditions", label: item.title })),
    ...(photos ? [{ key: "photos", href: "#property-photos", label: "Photos of the property (optional)" }] : []),
  ];
  const inHand = deal.docs.filter((doc) => IN.includes(doc.status)).length;
  return (
    <section className="glass p-4" data-testid="needs-from-you">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{items.length ? "What we need from you" : "Nothing needed from you right now"}</h2>
        {deal.docs.length > 0 && <span className="text-xs text-muted-foreground" data-testid="needs-progress">{inHand} of {deal.docs.length} documents in</span>}
      </div>
      {deal.docs.length > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-link" style={{ width: `${(inHand / deal.docs.length) * 100}%` }} /></div>}
      {items.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {items.map((item) => <li key={item.key} data-testid="need-item"><a href={item.href} className="flex items-start gap-2 hover:underline"><span aria-hidden="true" className="text-faint">○</span><span className="min-w-0">{item.label}</span></a></li>)}
        </ul>
      ) : <p className="mt-2 text-sm text-muted-foreground">We&apos;ll email you when that changes.</p>}
      <a href="#messages" className="mt-3 inline-block text-xs text-link underline" data-testid="jump-messages">Questions? Message your team</a>
    </section>
  );
}
