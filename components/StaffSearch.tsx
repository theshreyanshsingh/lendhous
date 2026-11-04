"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchLeads } from "@/actions/leads";
import { statusLabel } from "@/components/ui";
import { useStore } from "@/lib/store";

type Result = { key: string; href: string; title: string; sub: string };

/**
 * The staff sidebar's search, also opened with ⌘K or Ctrl+K: loans from the book by number, borrower, entity or address,
 * and website leads from the server. Enter opens the first one.
 */
export function StaffSearch() {
  const { s } = useStore();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<{ id: string; name: string; place: string }[]>([]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const needle = q.trim().toLowerCase();
  useEffect(() => {
    if (needle.length < 2) { setLeads([]); return; }
    const timer = setTimeout(() => void searchLeads(needle).then(setLeads).catch(() => setLeads([])), 250);
    return () => clearTimeout(timer);
  }, [needle]);
  const loans = needle.length < 2 ? [] : s.deals.filter((deal) => [deal.loanNumber, deal.borrowerName, deal.entityName, deal.address, deal.city].some((value) => value.toLowerCase().includes(needle))).slice(0, 6);
  const results: Result[] = [
    ...loans.map((deal) => ({ key: deal.id, href: `/admin/deals/${deal.id}`, title: `${deal.loanNumber} · ${deal.borrowerName}`, sub: `${deal.address}, ${deal.city} · ${statusLabel(deal.status)}` })),
    ...leads.map((lead) => ({ key: `lead-${lead.id}`, href: `/admin/leads#lead-${lead.id}`, title: lead.name, sub: `Website lead${lead.place ? ` · ${lead.place}` : ""}` })),
  ];
  const done = () => { setOpen(false); setQ(""); input.current?.blur(); };
  return (
    <div className="relative px-1 pb-3" data-testid="staff-search">
      <input ref={input} type="search" role="combobox" aria-label="Search loans and leads" aria-expanded={open && needle.length >= 2} aria-controls="staff-search-results" autoComplete="off" placeholder="Search loans and leads" className="desk-input h-9! text-sm" data-testid="staff-search-input" value={q}
        onChange={(event) => { setQ(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => { if (event.key === "Escape") done(); if (event.key === "Enter" && results[0]) { router.push(results[0].href); done(); } }} />
      {open && needle.length >= 2 && (
        <ul id="staff-search-results" role="listbox" className="absolute inset-x-1 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-[2px] border border-border bg-card py-1 shadow-[var(--shadow)]" data-testid="staff-search-results">
          {results.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Nothing matches.</li> : results.map((result) => (
            <li key={result.key} role="option" aria-selected={false}>
              <Link href={result.href} className="block px-3 py-2 hover:bg-hover" data-testid="search-result" onClick={done}><span className="block truncate text-sm font-medium">{result.title}</span><span className="block truncate text-xs text-muted-foreground">{result.sub}</span></Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
