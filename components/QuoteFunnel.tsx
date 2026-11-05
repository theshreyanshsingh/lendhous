"use client";
import { useEffect, useState } from "react";
import { quoteFunnelData } from "@/actions/leads";
import { Section, Skeleton } from "@/components/ui";
import { quoteFunnel, share, type FunnelCount, type FunnelLead } from "@/lib/quote-funnel";
import type { Period } from "@/lib/reports";
import { useStore } from "@/lib/store";

/** The website quote in the period: visitors who started one, saw terms, saved them, became loans and funded, by channel. */
export function QuoteFunnel({ period }: { period: Period }) {
  const { s, local } = useStore();
  const [data, setData] = useState<{ counts: FunnelCount[]; leads: FunnelLead[] } | null>(null);
  useEffect(() => {
    if (local) return;
    setData(null);
    void quoteFunnelData(period.from, period.to).then(setData).catch(() => setData({ counts: [], leads: [] }));
  }, [local, period.from, period.to]);
  if (local) return <Section title="Website quotes"><p className="text-sm text-muted-foreground" data-testid="quote-funnel-demo">Real accounts see here how many visitors started a quote, saw their terms, saved them, and became loans, by channel and referring broker.</p></Section>;
  if (!data) return <Section title="Website quotes"><Skeleton /></Section>;
  const { rows, total } = quoteFunnel(data.counts, data.leads, s, period);
  return (
    <Section title="Website quotes" right={<span className="text-xs text-muted-foreground">{share(total.saved, total.shown)} of terms shown were saved</span>}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="quote-funnel-empty">No quotes in this period.</p> : (
        <table className="stack-table w-full text-sm" data-testid="quote-funnel">
          <thead><tr><th>Where from</th><th className="text-right">Started</th><th className="text-right">Saw terms</th><th className="text-right">Saved</th><th className="text-right">Became loans</th><th className="text-right">Funded</th></tr></thead>
          <tbody className="divide-y divide-border">
            {[...rows, total].map((row) => (
              <tr key={row.key} className={row.key === "total" ? "font-medium" : ""} data-testid="quote-funnel-row">
                <td>{row.label}</td>
                <td data-label="Started" className="text-right tabular-nums">{row.started}</td>
                <td data-label="Saw terms" className="text-right tabular-nums">{row.shown}</td>
                <td data-label="Saved" className="text-right tabular-nums">{row.saved}</td>
                <td data-label="Became loans" className="text-right tabular-nums">{row.loans}</td>
                <td data-label="Funded" className="text-right tabular-nums">{row.funded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Started and saw terms are anonymous counts; nothing about a visitor is kept until they save. A saved quote is a website lead.</p>
    </Section>
  );
}
