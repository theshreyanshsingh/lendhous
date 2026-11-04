"use client";
import { useEffect, useState } from "react";
import { myStatements } from "@/actions/statements";
import { useServiceDay } from "@/components/loan/use-service-day";
import { Section, usd } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { monthName, previousMonth, statementFor, statementRows, type Investor } from "@/lib/investor-statements";
import { useStore } from "@/lib/store";

type Row = Awaited<ReturnType<typeof myStatements>>[number];

/**
 * A partner's or buyer's monthly statements, each a PDF and a spreadsheet. A demo book has none kept, so it shows what
 * last month's would say, with a sample PDF.
 */
export function InvestorStatements({ investor }: { investor: Investor }) {
  const { s, local } = useStore();
  const today = useServiceDay();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { if (!local) void myStatements().then(setRows).catch(() => setRows([])); }, [local]);

  if (local) {
    const month = today ? previousMonth(today) : "";
    const preview = month ? statementFor(s, investor, month) : null;
    return (
      <Section title="Monthly statements">
        <div className="space-y-3 text-sm" data-testid="statement-preview">
          <p className="text-muted-foreground">Real accounts get a statement on the 1st of each month for the month before, by email and here. This is what {month ? monthName(month) : "last month"}&apos;s says for this sample book.</p>
          {preview && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><div className="text-xs text-muted-foreground">Interest</div><div className="font-semibold tabular-nums">{usd(preview.totals.interest, 2)}</div></div>
                <div><div className="text-xs text-muted-foreground">Servicing fee</div><div className="font-semibold tabular-nums">−{usd(preview.totals.servicingFee, 2)}</div></div>
                <div><div className="text-xs text-muted-foreground">Principal</div><div className="font-semibold tabular-nums">{usd(preview.totals.principal, 2)}</div></div>
                <div><div className="text-xs text-muted-foreground">Net to you</div><div className="font-semibold tabular-nums" data-testid="statement-net">{usd(preview.totals.net, 2)}</div></div>
              </div>
              <div className="flex flex-wrap gap-3">
                <a className="text-link underline" href={`/api/statements/demo?type=${investor.type}`} data-testid="statement-sample-pdf">Sample PDF</a>
                <button type="button" className="text-link underline" data-testid="statement-sample-csv" onClick={() => downloadCsv(`lendhous-statement-${preview.month}-sample.csv`, statementRows(preview))}>Spreadsheet</button>
              </div>
            </>
          )}
        </div>
      </Section>
    );
  }
  return (
    <Section title="Monthly statements">
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-statements">Your first statement arrives on the 1st of the month after your first loan pays.</p> : (
        <ul className="divide-y divide-border text-sm" data-testid="statements">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="statement-row">
              <span className="min-w-0"><span className="font-medium">{monthName(row.month)}</span> <span className="text-muted-foreground">· {usd(row.net, 2)} to you · {row.loans} loan{row.loans === 1 ? "" : "s"} · {usd(row.balance)} outstanding</span></span>
              <span className="flex gap-3"><a className="text-link underline" href={`/api/statements/${row.id}`} data-testid="statement-pdf">PDF</a><a className="text-link underline" href={`/api/statements/${row.id}?format=csv`} data-testid="statement-csv">Spreadsheet</a></span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
