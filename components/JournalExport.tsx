"use client";
import { useState } from "react";
import { Section } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { downloadCsv } from "@/lib/csv";
import { ACCOUNTS, monthJournal } from "@/lib/journal";
import { useStore } from "@/lib/store";

const monthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A month of the servicing book as journal entries for QuickBooks Online (lib/journal.ts). */
export function JournalExport() {
  const { s } = useStore();
  const today = serviceDay(s);
  const months = Array.from({ length: 12 }, (_, back) => { const [y, m] = today.split("-").map(Number); return new Date(Date.UTC(y, m - 1 - back, 15)).toISOString().slice(0, 7); });
  const [month, setMonth] = useState(months[1] ?? months[0]);
  const rows = monthJournal(s, month);
  const entries = new Set(rows.map((row) => row["Journal No."])).size;
  return (
    <Section title="Accounting journal">
      <div className="flex flex-wrap items-end gap-2" data-testid="journal-export">
        <label className="block"><span className="label">Month</span><select className="desk-input w-auto!" data-testid="journal-month" value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}</select></label>
        <button type="button" className="btn-ghost" data-testid="journal-download" disabled={!rows.length} onClick={() => downloadCsv(`lendhous-journal-${month}.csv`, rows)}>Download for QuickBooks</button>
        <p className="w-full text-xs text-muted-foreground" data-testid="journal-summary">{entries ? `${entries} journal entr${entries === 1 ? "y" : "ies"} for ${monthLabel(month)}: loans advanced and points at closing, draws released, payments split into interest, principal and late fees, and referral bonuses.` : `No money moved on the servicing book in ${monthLabel(month)}.`} Each entry balances, in QuickBooks Online&apos;s journal import columns. The accounts ({Object.values(ACCOUNTS).join(", ")}) are PLACEHOLDER names for the CPA to match to the chart of accounts; a loan shared with partners shows the whole loan with LendHous&apos;s share noted.</p>
      </div>
    </Section>
  );
}
