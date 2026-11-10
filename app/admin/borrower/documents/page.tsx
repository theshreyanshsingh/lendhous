"use client";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageIntro } from "@/components/page-intro";
import { Badge } from "@/components/ui";
import { docBadge } from "@/lib/borrower-docs";
import { filedDocuments, reuseProblem } from "@/lib/doc-sorting";
import { shortDay } from "@/lib/format";
import { useStore } from "@/lib/store";

const ORDER = ["Identity", "Entity", "Property", "Liquidity", "Experience", "Credit", "Closing", "Other"];
const FOLDER: Record<string, string> = { Identity: "You and your guarantors", Entity: "Your company", Property: "Properties and deals", Liquidity: "Your money", Experience: "Your track record", Credit: "Credit", Closing: "Closing and insurance", Other: "Things you added" };

/**
 * Every document the borrower has sent LendHous, across all their loans, in folders by what it's about (lib/doc-sorting.ts).
 * Each opens from here, and one another loan still needs can be sent to it in a tap, for the team to review there.
 */
export default function MyDocuments() {
  const { s, dispatch, viewerName } = useStore();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const mine = s.deals.filter((deal) => deal.borrowerId === s.borrowerId);
  const filed = filedDocuments(mine).filter(({ deal, doc }) => !query.trim() || `${doc.name} ${doc.fileName ?? ""} ${deal.loanNumber} ${deal.address}`.toLowerCase().includes(query.trim().toLowerCase()));
  const folders = [...new Set([...ORDER, ...filed.map(({ doc }) => doc.category)])].filter((category) => filed.some(({ doc }) => doc.category === category));
  /** Other loans of theirs waiting for this same document. */
  const waiting = (dealId: string, docId: string) => mine.filter((other) => other.id !== dealId && !reuseProblem(other, other.docs.find((doc) => doc.id === docId), mine.find((deal) => deal.id === dealId), mine.find((deal) => deal.id === dealId)?.docs.find((doc) => doc.id === docId)));
  const send = async (fromDealId: string, docId: string, toDealId: string, name: string, loanNumber: string) => {
    if (await dispatch({ t: "reuseDocument", dealId: toDealId, docId, fromDealId, by: viewerName })) setNote(`${name} sent to ${loanNumber}. Your loan team reviews it there.`);
  };
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Your files" title="My documents" lede="Everything you've sent LendHous, across your loans. Open any of them, or send one again to a loan that needs it." />
      {note && <p className="rounded-[2px] bg-good/10 p-3 text-sm text-good" role="status" data-testid="my-docs-note">✓ {note}</p>}
      <label className="block max-w-sm"><span className="label">Find a document</span><input className="desk-input" data-testid="my-docs-search" placeholder="Operating agreement, bank, 123 Main…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {!filed.length ? <EmptyState>{query ? "Nothing matches that." : "No documents yet. They show here once you've sent them on a loan."}</EmptyState> : folders.map((category) => (
        <section key={category} className="glass min-w-0 p-4 sm:p-5" data-testid="my-docs-folder">
          <h2 className="eyebrow">{FOLDER[category] ?? category}</h2>
          <ul className="mt-2 divide-y divide-border">
            {filed.filter(({ doc }) => doc.category === category).map(({ deal, doc }) => {
              const badge = docBadge(doc);
              const needs = waiting(deal.id, doc.id);
              return (
                <li key={`${deal.id}-${doc.id}`} className="space-y-1 py-3" data-testid="my-doc">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <a className="font-medium text-link underline-offset-2 hover:underline" href={`/api/documents/${doc.documentId}`}>{doc.name}</a>
                      <p className="truncate text-xs text-muted-foreground">📎 {doc.fileName ?? "file"} · <Link className="underline underline-offset-2" href={`/admin/borrower/${deal.id}#documents`}>{deal.loanNumber}</Link>, {deal.address}{doc.uploadedAt ? ` · sent ${shortDay(doc.uploadedAt.slice(0, 10))}` : doc.acceptedOn ? ` · accepted ${shortDay(doc.acceptedOn)}` : ""}</p>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  {needs.map((other) => <button key={other.id} type="button" className="text-xs text-link underline underline-offset-2 max-sm:min-h-11" data-testid="my-doc-send" onClick={() => void send(deal.id, doc.id, other.id, doc.name, other.loanNumber)}>Send it to {other.loanNumber}, {other.address}, which needs it</button>)}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
