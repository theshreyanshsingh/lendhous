import type { LetterContent } from "@/lib/payoffs";
import { shortDay } from "@/lib/format";

const money = (amount: number) => `${amount < 0 ? "−" : ""}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A payoff letter on screen: the same content as its PDF. */
export function PayoffLetterView({ content }: { content: LetterContent }) {
  return (
    <article className="glass space-y-5 p-5 sm:p-7" data-testid="payoff-letter">
      <header className="border-b border-rule pb-3">
        <p className="font-heading text-2xl text-foreground">{content.lender}</p>
        <p className="text-xs text-muted-foreground">Payoff letter (estoppel letter under section 701.04, Florida Statutes)</p>
      </header>
      {content.sample && <p className="rounded-md bg-bad/10 p-2 text-sm text-bad">Sample only. These are made-up figures, not a real payoff letter.</p>}
      <div className="text-sm">
        <p>Issued {shortDay(content.issuedOn)}</p>
        <p className="wrap-anywhere text-muted-foreground">Reference {content.reference}</p>
        {content.corrected && <p className="mt-2 font-medium" data-testid="letter-corrected">Corrected letter. {content.corrected}</p>}
      </div>
      <div className="text-sm"><p className="font-medium">To</p>{content.to.map((line) => <p key={line} className="wrap-anywhere">{line}</p>)}</div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
        {content.loan.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 wrap-anywhere">{value}</dd></div>)}
      </dl>
      <section className="border-t border-border pt-4">
        <h2 className="font-heading text-lg text-foreground">Amount to pay off the loan</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {content.rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3"><dt className="min-w-0">{row.label}{row.detail && <span className="block text-xs text-muted-foreground">{row.detail}</span>}</dt><dd className="shrink-0 tabular-nums">{money(row.amount)}</dd></div>
          ))}
          <div className="flex justify-between gap-3 border-t border-foreground/40 pt-2 font-semibold"><dt className="min-w-0">{content.total.label}</dt><dd className="shrink-0 tabular-nums" data-testid="letter-total">{money(content.total.amount)}</dd></div>
        </dl>
        <p className="mt-2 text-sm">{content.perDiem}</p>
      </section>
      <div className="space-y-3 border-t border-border pt-4 text-sm">{content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
    </article>
  );
}
