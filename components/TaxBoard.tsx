"use client";
import { useEffect, useState } from "react";
import { exportIris, taxYearReport } from "@/actions/tax";
import { Badge, Section, Skeleton, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { deadlines, TAX_CONFIG, taxYear, type FormLine } from "@/lib/tax-forms";
import { bonusesPaidIn, MISC_THRESHOLD } from "@/lib/referrals";
import { useStore } from "@/lib/store";

const FORMS: { form: FormLine["form"]; title: string; who: string }[] = [
  { form: "1099-INT", title: "1099-INT: interest to partners and buyers", who: `Their interest after servicing, $${TAX_CONFIG.interestThreshold} or more. Corporations, IRAs and tax-exempt payees are exempt.` },
  { form: "1099-NEC", title: "1099-NEC: broker fees", who: `Fees paid at closing, $${TAX_CONFIG.brokerFeeThreshold.toLocaleString("en-US")} or more in the year. Corporations are exempt.` },
  { form: "1098", title: "1098: mortgage interest from individual borrowers", who: `$${TAX_CONFIG.mortgageInterestThreshold} or more of interest from a person, not an LLC, on a loan secured by real property.` },
];

/** The owners' year-end screen: every form a tax year calls for, what's missing, the deadlines, and the IRIS export. */
export function TaxBoard() {
  const { s, local } = useStore();
  const [year, setYear] = useState(2026);
  const referralBonuses = bonusesPaidIn(s.deals, year);
  const [report, setReport] = useState<{ lines: FormLine[]; deadlines: ReturnType<typeof deadlines> } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setReport(null);
    if (local) { const made = taxYear(s, year, () => null); setReport({ lines: made.lines, deadlines: made.deadlines }); }
    else void taxYearReport(year).then(setReport).catch(() => setError("Couldn't load the tax year."));
  }, [local, s, year]);
  const download = async () => {
    setError("");
    if (local) return setError("Demo accounts have no taxpayer IDs to export.");
    const reply: { csv?: string; error?: string } = await exportIris(year).catch(() => ({ error: "That didn't go through." }));
    if (!reply.csv) return setError(reply.error ?? "Nothing to export.");
    const url = URL.createObjectURL(new Blob([reply.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `lendhous-iris-${year}.csv`; link.click();
    URL.revokeObjectURL(url);
  };
  const due = report?.lines.filter((line) => line.due) ?? [];
  const missing = due.filter((line) => line.onFile === "missing");
  return (
    <div className="space-y-4" data-testid="tax-board">
      <div className="glass flex flex-wrap items-end justify-between gap-3 p-4">
        <label className="block"><span className="label">Tax year</span><select className="desk-input w-auto!" data-testid="tax-year" value={year} onChange={(event) => setYear(Number(event.target.value))}>{[2027, 2026, 2025].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {report && <p className="text-sm text-muted-foreground" data-testid="tax-deadlines">Recipients&apos; copies by <b className="text-foreground">{shortDay(report.deadlines.recipients)}</b>; 1099-NEC to the IRS by {shortDay(report.deadlines.brokerFeesToIrs)}; the rest e-filed by {shortDay(report.deadlines.efileToIrs)}.</p>}
        <button type="button" className="btn-ghost" data-testid="tax-export" onClick={() => void download()}>Export for IRIS (CSV)</button>
      </div>
      {error && <p className="text-sm text-bad" role="alert" data-testid="tax-board-error">{error}</p>}
      {report && (
        <p className={`text-sm ${missing.length ? "text-warn" : "text-muted-foreground"}`} data-testid="tax-summary">{due.length} form{due.length === 1 ? "" : "s"} due for {year}{missing.length ? `; ${missing.length} payee${missing.length === 1 ? " has" : "s have"} no W-9, so ${TAX_CONFIG.backupWithholdingPct}% backup withholding applies to what they're paid until one is signed (their portal's Tax form page).` : "."}{due.length >= 10 ? " That's 10 or more, so they must be e-filed (IRIS)." : ""}</p>
      )}
      {FORMS.map((group) => {
        const lines = report?.lines.filter((line) => line.form === group.form) ?? [];
        return (
          <Section key={group.form} title={group.title}>
            <p className="mb-2 text-xs text-muted-foreground">{group.who}</p>
            {!report ? <Skeleton /> : lines.length === 0 ? <p className="text-sm text-muted-foreground">None for {year}.</p> : (
              <table className="stack-table w-full text-sm" data-testid={`tax-${group.form}`}>
                <thead><tr><th>Payee</th><th>Loans</th><th className="text-right">Amount</th><th>Tax form</th><th>Form</th></tr></thead>
                <tbody className="divide-y divide-border">{lines.map((line) => (
                  <tr key={`${line.payeeType}-${line.payeeId}-${line.loans[0]}`} data-testid="tax-line">
                    <td className="font-medium">{line.name}</td>
                    <td data-label="Loans" className="text-xs text-muted-foreground">{line.loans.join(", ")}</td>
                    <td data-label="Amount" className="text-right tabular-nums">{usd(line.amount, 2)}{line.backupWithholding > 0 && <div className="text-xs text-warn">withhold {usd(line.backupWithholding, 2)}</div>}</td>
                    <td data-label="Tax form">{line.onFile === "w9" ? <Badge tone="green">W-9</Badge> : line.onFile === "w8" ? <Badge tone="blue">W-8</Badge> : line.onFile === "missing" ? <Badge tone="amber">No W-9</Badge> : <span className="text-xs text-muted-foreground">Not needed</span>}</td>
                    <td data-label="Form">{line.due ? <Badge tone="violet">Due</Badge> : <span className="text-xs text-muted-foreground">{line.reason}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Section>
        );
      })}
      {/* Not in the export: whether these go on a 1099-MISC (box 3, other income) is the CPA's call. */}
      <Section title="Referral bonuses paid to borrowers">
        <p className="mb-2 text-xs text-muted-foreground">Bonuses for referring an investor whose loan funded (lib/referrals.ts). Anyone paid {usd(MISC_THRESHOLD, 0)} or more in the year likely needs a 1099-MISC: ask the CPA, and get a W-9 from them before January.</p>
        {referralBonuses.length === 0 ? <p className="text-sm text-muted-foreground">None paid in {year}.</p> : (
          <table className="stack-table w-full text-sm" data-testid="tax-referrals">
            <thead><tr><th>Borrower</th><th>Loans referred</th><th className="text-right">Paid</th><th>1099-MISC</th></tr></thead>
            <tbody className="divide-y divide-border">{referralBonuses.map((row) => (
              <tr key={row.referrerId} data-testid="tax-referral">
                <td className="font-medium">{row.name}</td>
                <td data-label="Loans referred" className="text-xs text-muted-foreground">{row.loans.join(", ")}</td>
                <td data-label="Paid" className="text-right tabular-nums">{usd(row.total, 2)}</td>
                <td data-label="1099-MISC">{row.needsForm ? <Badge tone="amber">Likely: ask the CPA</Badge> : <span className="text-xs text-muted-foreground">Under {usd(MISC_THRESHOLD, 0)}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>
      <p className="text-xs text-faint">The thresholds and who counts as exempt are for LendHous&apos;s CPA to confirm. Upload the export at IRIS (the IRS&apos;s only e-file system from January 1, 2027), which also gives recipients&apos; copies to mail; check its columns against IRS&apos;s current CSV template first. Florida has no state filing for these.</p>
    </div>
  );
}
