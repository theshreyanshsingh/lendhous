"use client";
import Link from "next/link";
import { useState } from "react";
import { Section, usd } from "@/components/ui";
import { CONFIDENCE, EXIT_CHOICES, exitAskOpen, exitPlanProblem, shortTerm, type Confidence, type ExitChoice } from "@/lib/exit-plans";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { ledger, SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";

const digits = (text: string) => Number(text.replace(/[^0-9.]/g, "")) || undefined;

/**
 * How a short-term loan will end, in the borrower's words: they can say any time, and are asked from four months before
 * maturity. Refinancing with LendHous starts the rental-loan application from this loan. The team can write down what
 * a borrower said on a call.
 */
export function ExitPlanCard({ deal, side }: { deal: Deal; side: "client" | "team" }) {
  const { dispatch, viewerName } = useStore();
  const plan = deal.exitPlan;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<ExitChoice | "">(plan?.choice ?? "");
  const [confidence, setConfidence] = useState<Confidence | "">(plan?.confidence ?? "");
  const [listPrice, setListPrice] = useState(plan?.listPrice ? plan.listPrice.toLocaleString("en-US") : "");
  const [saleBy, setSaleBy] = useState(plan?.saleBy ?? "");
  const [lender, setLender] = useState(plan?.lender ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  const [error, setError] = useState("");
  if (!shortTerm(deal) || !SERVICED.includes(deal.status)) return null;
  const l = ledger(deal);
  const asking = exitAskOpen(deal, l.daysToMaturity);
  const save = async () => {
    const draft = { choice: choice as ExitChoice, confidence: confidence as Confidence, listPrice: digits(listPrice), saleBy: saleBy || undefined, lender: lender.trim() || undefined, note: note.trim() };
    const problem = exitPlanProblem(draft);
    if (problem) return setError(problem);
    setError("");
    if (await dispatch({ t: "setExitPlan", dealId: deal.id, plan: draft, by: viewerName })) setEditing(false);
  };
  const refi = <Link href={`/admin/apply?from=${deal.id}&refi=1`} className="btn-primary" data-testid="exit-refi-start">Start the rental-loan application</Link>;
  const showForm = editing || !plan;
  return (
    <div id="exit-plan">
      <Section title={side === "client" ? "How you'll pay off the loan" : "Exit plan"} right={<span className="text-xs text-muted-foreground">matures {shortDay(l.maturity)} · {l.daysToMaturity >= 0 ? `${l.daysToMaturity} days` : `${-l.daysToMaturity} days ago`}</span>}>
        <div className="space-y-3 text-sm" data-testid="exit-plan">
          {plan && !editing && (
            <div className="space-y-2" data-testid="exit-summary">
              <p><b className="font-medium">{EXIT_CHOICES[plan.choice]}</b> <span className="text-muted-foreground">({CONFIDENCE[plan.confidence].toLowerCase()})</span>{plan.choice === "sell" && plan.listPrice ? <span className="text-muted-foreground">: listing at {usd(plan.listPrice)}{plan.saleBy ? `, closing by ${shortDay(plan.saleBy)}` : ""}</span> : null}{plan.lender ? <span className="text-muted-foreground"> with {plan.lender}</span> : null}</p>
              {plan.note && <p className="text-muted-foreground">&ldquo;{plan.note}&rdquo;</p>}
              <p className="text-xs text-faint">Told us {shortDay(plan.at)}{plan.by ? ` · ${plan.by}` : ""}</p>
              <div className="flex flex-wrap items-center gap-3">
                {plan.choice === "refi_lendhous" && side === "client" && !deal.refinances && refi}
                {plan.choice === "extend" && side === "client" && <a href="#extensions" className="text-link underline underline-offset-2">Ask for the extension</a>}
                {plan.choice === "payoff" && side === "client" && <a href="#payments" className="text-link underline underline-offset-2">Ask for a payoff letter</a>}
                <button type="button" className="text-link underline underline-offset-2" data-testid="exit-change" onClick={() => setEditing(true)}>Change it</button>
              </div>
            </div>
          )}
          {showForm && (
            <div className="space-y-3">
              {side === "client" && !plan && <p className="text-muted-foreground" data-testid="exit-ask">{asking ? "Tell us your plan, so we can help in time: a payoff letter for the closing, a rental loan, or more time." : "Whenever you know, tell us how you'll pay it off. We'll ask from four months before it matures."}</p>}
              <fieldset className="space-y-1.5"><legend className="label">The plan</legend>
                {(Object.keys(EXIT_CHOICES) as ExitChoice[]).map((key) => <label key={key} className="flex items-center gap-2"><input type="radio" name={`exit-${deal.id}`} data-testid={`exit-choice-${key}`} checked={choice === key} onChange={() => setChoice(key)} />{EXIT_CHOICES[key]}</label>)}
              </fieldset>
              {choice === "sell" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">List price</span><input className="desk-input" inputMode="numeric" data-testid="exit-list-price" value={listPrice} onChange={(event) => setListPrice(event.target.value)} /></label>
                  <label className="block"><span className="label">Expected closing</span><input className="desk-input" type="date" data-testid="exit-sale-by" value={saleBy} onChange={(event) => setSaleBy(event.target.value)} /></label>
                </div>
              )}
              {choice === "refi_other" && <label className="block"><span className="label">Which lender (optional)</span><input className="desk-input" data-testid="exit-lender" maxLength={120} value={lender} onChange={(event) => setLender(event.target.value)} /></label>}
              {choice === "refi_lendhous" && <p className="rounded-[2px] bg-good/10 p-2 text-xs text-good">A LendHous rental (DSCR) loan pays this one off when it funds, and the finished rehab counts as a project you did. Save the plan, then start the application.</p>}
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="label w-full">How sure</legend>
                {(Object.keys(CONFIDENCE) as Confidence[]).map((key) => <label key={key} className="flex items-center gap-2"><input type="radio" name={`exit-sure-${deal.id}`} data-testid={`exit-confidence-${key}`} checked={confidence === key} onChange={() => setConfidence(key)} />{CONFIDENCE[key]}</label>)}
              </fieldset>
              <label className="block"><span className="label">Anything we should know (optional)</span><textarea className="desk-input min-h-16" data-testid="exit-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
              {error && <p className="text-sm text-bad" role="alert" data-testid="exit-error">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" data-testid="exit-save" onClick={() => void save()}>Save the plan</button>
                {editing && <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
