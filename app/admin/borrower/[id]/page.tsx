"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isClosedApplication, PRE_FUNDING } from "@/lib/loan-exits";
import { balanceOf, ledger, noteRateOn, SERVICED } from "@/lib/servicing";
import { useStore, est } from "@/lib/store";
import { fundedBalances } from "@/lib/engine";
import { CloseApplication } from "@/components/loan/CloseApplication";
import { DrawPanel } from "@/components/loan/DrawPanel";
import { BudgetControls } from "@/components/loan/BudgetControls";
import { Extensions } from "@/components/loan/Extensions";
import { Modifications } from "@/components/loan/Modifications";
import { PaidOff } from "@/components/loan/PaidOff";
import { LoanMessages } from "@/components/loan/LoanMessages";
import { PaymentsPanel } from "@/components/loan/PaymentsPanel";
import { ScopeOfWork } from "@/components/loan/ScopeOfWork";
import { TermSheetCard } from "@/components/loan/TermSheetCard";
import { BorrowerConditions } from "@/components/loan/BorrowerConditions";
import { PropertyPhotos } from "@/components/loan/PropertyPhotos";
import { TeamContacts } from "@/components/loan/LoanTeam";
import { NeedsFromYou } from "@/components/loan/NeedsFromYou";
import { NextLoan } from "@/components/loan/NextLoan";
import { SurveyCard } from "@/components/loan/SurveyCard";
import { NextStepCard } from "@/components/loan/NextStepCard";
import { FundedNote } from "@/components/loan/FundedNote";
import { LoanTimeline } from "@/components/loan/LoanTimeline";
import { RehabProgress } from "@/components/loan/RehabProgress";
import { PropertyPicture } from "@/components/PropertyPicture";
import { Showcase } from "@/components/loan/Showcase";
import { LoanMoney } from "@/components/loan/LoanStatements";
import { ExitPlanCard } from "@/components/loan/ExitPlanCard";
import { BorrowerDocuments } from "@/components/loan/BorrowerDocuments";
import { YourAgents } from "@/components/loan/YourAgents";
import { InsuranceCard } from "@/components/loan/InsuranceCard";
import { PropertySchedule } from "@/components/loan/PropertySchedule";
import { interestBasis, PLAIN_RATIO } from "@/lib/status-words";
import { Badge, Section, Stat, usd, pct, productLabel, statusLabel } from "@/components/ui";
import { shortDay } from "@/lib/format";


export default function BorrowerLoan() {
  const { id } = useParams<{ id: string }>(); const { s } = useStore();
  const d = s.deals.find((x) => x.id === id);
  if (!d) return <div className="glass p-6">Loan not found. <Link className="underline" href="/admin/borrower">Back</Link></div>;
  const e = est(d.app); const funded = SERVICED.includes(d.status); const closed = isClosedApplication(d.status);
  const b = fundedBalances(e, d.app, d.disbursedDraws);
  // Once funded, the figures a release or a modification changed: what's owed, the payment coming and the rate now.
  const now = funded ? ledger(d) : null;
  const nextPayment = now?.rows.find((row) => row.due === now.nextDue)?.amount ?? b.nextPayment;
  const rate = funded ? noteRateOn(d) : e.rate;
  const keyRatios = e.ratios.filter((r) => ["ltc", "ltarv", "ltv", "dscr"].includes(r.key)); // flip: LTC/LTARV · bridge: LTV · DSCR: LTV/DSCR
  return (
    <div className="space-y-4">
      <Link href="/admin/borrower" className="text-sm text-link">← My loans</Link>
      <div className="glass p-5">
        <div className="flex items-start gap-3 sm:gap-4">
          <PropertyPicture deal={d} variant="header" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="text-xs text-muted-foreground">{d.loanNumber} · {productLabel[d.app.product]} · {d.entityName}</div><h1 className="text-xl font-normal tracking-tight">{d.address}, {d.city} {d.zip}</h1></div><Badge tone={d.status === "default" ? "rose" : funded || d.status === "paid_off" ? "green" : closed ? "slate" : "blue"}>{statusLabel(d.status)}</Badge></div>
          </div>
        </div>
        {!closed && (
              <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:max-w-lg" data-testid="loan-glance">
                {(funded ? [["Balance", usd(balanceOf(d))], ["Next payment", ledger(d).nextDue ? `${usd(nextPayment)}, ${shortDay(ledger(d).nextDue!)}` : "None due"], ["Matures", shortDay(ledger(d).maturity)]] : d.status === "paid_off" ? [["Paid off", shortDay(d.paidOff?.receivedOn)], ["Loan", usd(e.noteAmount)], ["Rate", `${e.rate.toFixed(2)}%`]] : [["Loan", usd(e.noteAmount)], ["Rate", `${e.rate.toFixed(2)}%`], ["Closing", shortDay(d.closingDate)]]).map(([label, value]) => (
                  <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold text-foreground tabular-nums">{value}</dd></div>
                ))}
              </dl>
            )}
        {/* The full width, so its form fits a small phone beside nothing. */}
        {closed && <CloseApplication deal={d} side="borrower" />}
        {PRE_FUNDING.includes(d.status) && <div className="mt-3"><CloseApplication deal={d} side="borrower" /></div>}
        <LoanTimeline deal={d} side="client" />
      </div>
      <FundedNote deal={d} />
      <NextStepCard deal={d} />
      {(funded || d.status === "paid_off") && <SurveyCard deal={d} />}
      {(funded || d.status === "paid_off") && <NextLoan deal={d} />}
      {!closed && d.status !== "paid_off" && <div id="needs-from-you"><NeedsFromYou deal={d} /></div>}
      <div id="term-sheet"><TermSheetCard deal={d} canSign /></div>
      <div id="conditions"><BorrowerConditions deal={d} canUpload /></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
        <BorrowerDocuments deal={d} settled={funded || d.status === "paid_off"} />
        {d.sponsor && ["submitted", "initial_review", "underwriting"].includes(d.status) && <Link href={`/admin/borrower/${d.id}/profile`} className="block text-sm text-link underline underline-offset-2" data-testid="edit-profile">Update your guarantors, past deals or credit answers</Link>}
        <div id="property-photos"><PropertyPhotos deal={d} side="client" /></div>
        <ScopeOfWork deal={d} editable />
        <div id="messages"><LoanMessages dealId={d.id} side="borrower" /></div>
        </div>
        {/* Once funded, a phone shows the money before the paperwork. */}
        <div className={`min-w-0 space-y-4 ${funded ? "max-lg:order-first" : ""}`}>
          <Section title={funded ? "Loan balance" : "Estimated terms"}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Note amount" value={usd(e.noteAmount)} />
              <Stat label="Rate" value={`${rate.toFixed(2)}%`} sub={interestBasis(d.app.product, d.app.accrual)} />
              {funded ? <><Stat label="Disbursed" value={usd(b.disbursed)} /><Stat label="Holdback left" value={usd(b.holdbackRemaining)} /><Stat label="Next payment" value={usd(nextPayment)} sub={ledger(d).nextDue ? `due ${shortDay(ledger(d).nextDue!)}` : "—"} /><Stat label="Maturity" value={shortDay(ledger(d).maturity)} sub={`${e.termMonths}-month term${d.extensions?.some((x) => x.status === "executed") || d.modifications?.some((x) => x.status === "executed" && x.months) ? ", extended" : ""}`} /></>
                : <><Stat label="Cash to close" value={usd(e.cashToClose)} /><Stat label="Target closing" value={shortDay(d.closingDate)} />{keyRatios.map((r) => <Stat key={r.key} label={PLAIN_RATIO[r.key] ?? r.label} value={r.key === "dscr" ? r.actual.toFixed(2) + "x" : pct(r.actual)} />)}<Stat label="Points" value={usd(e.points)} /></>}
            </div>
          </Section>
          {funded && e.holdback > 0 && <RehabProgress deal={d} />}
          {funded && e.holdback > 0 && <DrawPanel deal={d} />}
          {funded && <BudgetControls deal={d} side="client" />}
          {funded && <ExitPlanCard deal={d} side="client" />}
          {(funded || d.status === "paid_off") && <LoanMoney deal={d} />}
          {d.properties?.length ? <PropertySchedule deal={d} side="borrower" /> : null}
          {funded && <InsuranceCard deal={d} />}
          {funded && <div id="payments"><PaymentsPanel deal={d} /></div>}
          {funded && <div id="extensions"><Extensions deal={d} side="borrower" /></div>}
          {funded && <Modifications deal={d} side="borrower" />}
          {d.status === "paid_off" && <PaidOff deal={d} side="borrower" />}
          {d.closing && PRE_FUNDING.includes(d.status) && (
            <Section title="Closing">
              <div className="text-sm" data-testid="borrower-closing"><p className="font-medium">{d.closing.company}</p><p className="text-muted-foreground">{[d.closing.contact, d.closing.phone].filter(Boolean).join(" · ")}{d.closing.fileNumber ? ` · file ${d.closing.fileNumber}` : ""}</p><p className="mt-1 text-muted-foreground">Target closing {shortDay(d.closingDate)}.</p></div>
              <p className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">If you&apos;re wiring money to close, call the title company at a number you looked up yourself to confirm their instructions before you send it. Instructions that change by email are a scam.</p>
            </Section>
          )}
          {(funded || d.status === "paid_off") && <Showcase deal={d} side="client" />}
          {PRE_FUNDING.includes(d.status) && <YourAgents deal={d} />}
          <Section title="Your team"><TeamContacts deal={d} /><div className="mt-3 rounded-md bg-bad/10 p-2 text-xs text-bad">Wire-fraud warning: we will never email you wire instructions. Always confirm by phone with a number you already have.</div></Section>
        </div>
      </div>
    </div>
  );
}
