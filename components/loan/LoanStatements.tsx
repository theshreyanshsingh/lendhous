"use client";
import { useEffect, useState } from "react";
import { loanStatements } from "@/actions/statements";
import { useServiceDay } from "@/components/loan/use-service-day";
import { Section, Skeleton, usd } from "@/components/ui";
import { borrowerStatementFor, gets1098, interestPaidIn, statementDue } from "@/lib/borrower-statements";
import { shortDay } from "@/lib/format";
import { monthName, previousMonth } from "@/lib/investor-statements";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { TAX_CONFIG } from "@/lib/tax-forms";

type Row = Awaited<ReturnType<typeof loanStatements>>[number];

/** A loan's monthly statements, each a PDF. A demo book keeps none, so it shows what last month's says, with a sample. */
function StatementList({ deal }: { deal: Deal }) {
  const { s, local } = useStore();
  const today = useServiceDay();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { if (!local) void loanStatements(deal.id).then(setRows).catch(() => setRows([])); }, [local, deal.id]);
  if (local) {
    const month = today ? previousMonth(today) : "";
    const preview = month && statementDue(deal, month) ? borrowerStatementFor(s, deal, month) : null;
    if (!month) return <Skeleton rows={2} />;
    if (!preview) return <p className="text-sm text-muted-foreground">The first statement comes on the 1st of the month after the loan funds.</p>;
    return (
      <div className="space-y-2 text-sm" data-testid="loan-statement-preview">
        <p className="text-muted-foreground">Real accounts get one on the 1st of each month for the month before, by email and here. This is what {monthName(month)}&apos;s says for this sample loan.</p>
        <p><span className="text-muted-foreground">Received in {monthName(month)}:</span> <b className="tabular-nums" data-testid="loan-statement-received">{usd(preview.received, 2)}</b>{preview.nextDue && <> · <span className="text-muted-foreground">next payment</span> <b className="tabular-nums">{usd(preview.nextDue.amount, 2)}</b> <span className="text-muted-foreground">due {shortDay(preview.nextDue.on)}</span></>}</p>
        <a className="text-link underline underline-offset-2" href={`/api/borrower-statements/demo?deal=${deal.id}`} data-testid="loan-statement-sample">Sample statement (PDF)</a>
      </div>
    );
  }
  if (rows === null) return <Skeleton rows={2} />;
  if (!rows.length) return <p className="text-sm text-muted-foreground" data-testid="no-loan-statements">The first statement comes on the 1st of the month after the loan funds.</p>;
  return (
    <ul className="divide-y divide-border text-sm" data-testid="loan-statements">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="loan-statement-row">
          <span className="min-w-0"><span className="font-medium">{monthName(row.month)}</span> <span className="text-muted-foreground">· {row.paidOff ? `paid off ${shortDay(row.paidOff)}` : `${usd(row.received, 2)} received · ${usd(row.principal)} balance`}</span></span>
          <a className="text-link underline underline-offset-2" href={`/api/borrower-statements/${row.id}`} data-testid="loan-statement-pdf">PDF</a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The money side of a funded loan for its borrower: how to pay, the monthly statements, and the interest paid for the
 * year, with whether a 1098 comes for it. What's due and the payment history are just below it, with the payoff.
 */
export function LoanMoney({ deal }: { deal: Deal }) {
  const { paymentInstructions, local } = useStore();
  const today = useServiceDay();
  const year = today ? Number(today.slice(0, 4)) : 0;
  return (
    <Section title="Statements and how to pay">
      <div id="statements" className="space-y-5" data-testid="loan-money">
        <div data-testid="how-to-pay">
          <h3 className="mb-1 text-sm font-medium">How to pay</h3>
          {paymentInstructions ? <p className="text-sm whitespace-pre-line" data-testid="pay-instructions">{paymentInstructions}</p> : <p className="text-sm text-muted-foreground">{local ? "On a real account, LendHous's payment instructions show here." : "Call your LendHous servicing team for how to pay. Paying online comes later."}</p>}
          <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">We will never email you new payment or wire instructions. Before you send money for the first time, confirm these by calling a LendHous number you already have.</p>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium">Monthly statements</h3>
          <StatementList deal={deal} />
        </div>
        {year > 0 && (
          <div data-testid="loan-interest">
            <h3 className="mb-1 text-sm font-medium">Interest for your taxes</h3>
            <p className="text-sm"><span className="text-muted-foreground">Paid in {year} so far:</span> <b className="tabular-nums">{usd(interestPaidIn(deal, year), 2)}</b></p>
            {interestPaidIn(deal, year - 1) > 0 && <p className="text-sm"><span className="text-muted-foreground">Paid in {year - 1}:</span> <b className="tabular-nums">{usd(interestPaidIn(deal, year - 1), 2)}</b>{gets1098(deal, year - 1) ? <span className="text-muted-foreground">. LendHous files a Form 1098 for it and sends your copy by early February.</span> : <span className="text-muted-foreground">. No Form 1098: {deal.entityName && !/to be formed/i.test(deal.entityName) ? "the loan is to a company" : `it's under $${TAX_CONFIG.mortgageInterestThreshold}`}.</span>}</p>}
          </div>
        )}
      </div>
    </Section>
  );
}

/** The team's list of a loan's statements, on its Servicing tab. */
export function TeamLoanStatements({ deal }: { deal: Deal }) {
  return <Section title="Monthly statements"><StatementList deal={deal} /></Section>;
}
