"use client";
import { useState } from "react";
import { ADVANCE_KINDS, carryingCosts, defaultNotice, FORECLOSURE_STEPS, inBankruptcy, lossSplit, nextStep, reoProceeds, STOP_REASONS } from "@/lib/collections";
import { shortDay } from "@/lib/format";
import type { AdvanceKind, Deal } from "@/lib/mockData";
import { advancesOwed, openDefault, payoffFor, SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";

const amount = (text: string) => Number(text.replace(/[^0-9.]/g, "")) || 0;

/**
 * Money paid out to protect a loan, the foreclosure case in court, and the property once it's LendHous's (lib/collections.ts):
 * its carrying costs, its sale, and who takes what of the loss. The attorney runs the case; the team records each step.
 */
export function ForeclosurePanel({ deal }: { deal: Deal }) {
  const today = useServiceDay();
  if (!today) return null;
  const reo = deal.status === "reo";
  const show = reo || Boolean(openDefault(deal)) || Boolean(deal.foreclosure) || (deal.advances?.length ?? 0) > 0;
  if (!show || !(reo || SERVICED.includes(deal.status))) return null;
  return (
    <>
      {reo ? <BankOwned deal={deal} today={today} /> : <Foreclosure deal={deal} today={today} />}
      <Costs deal={deal} today={today} />
    </>
  );
}

function Costs({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch, viewerName } = useStore();
  const [on, setOn] = useState(today);
  const [kind, setKind] = useState<AdvanceKind>("attorney");
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const [repaid, setRepaid] = useState("");
  const [reference, setReference] = useState("");
  const reo = deal.status === "reo";
  const owed = advancesOwed(deal);
  const advances = [...(deal.advances ?? [])].reverse();
  const save = async () => { if (await dispatch({ t: "recordAdvance", dealId: deal.id, on, kind, amount: amount(paid), note: note.trim(), by: viewerName })) { setPaid(""); setNote(""); } };
  const back = async () => { if (await dispatch({ t: "advancesRepaid", dealId: deal.id, amount: amount(repaid), on: today, reference: reference.trim(), by: viewerName })) { setRepaid(""); setReference(""); } };
  return (
    <Section title={reo ? "Carrying costs" : "Costs advanced"} right={<span className="text-xs text-muted-foreground" data-testid="advances-owed">{reo ? `${usd(carryingCosts(deal), 2)} since ${shortDay(deal.reo!.since)}` : `${usd(owed, 2)} owed back`}</span>}>
      <div className="space-y-3 text-sm" data-testid="advances">
        {!(reo && deal.reo?.sold) && (
          <div className="grid gap-2 sm:grid-cols-5" data-testid="advance-form">
            <label className="block"><span className="label">Paid on</span><input type="date" className="desk-input" data-testid="advance-on" min={reo ? deal.reo!.since : deal.closingDate} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
            <label className="block"><span className="label">For</span><select className="desk-input" data-testid="advance-kind" value={kind} onChange={(event) => setKind(event.target.value as AdvanceKind)}>{Object.entries(ADVANCE_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="block"><span className="label">Amount</span><input className="desk-input" inputMode="decimal" data-testid="advance-amount" value={paid} onChange={(event) => setPaid(event.target.value)} /></label>
            <label className="block sm:col-span-2"><span className="label">Paid to, invoice</span><input className="desk-input" data-testid="advance-note" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="button" className="btn-ghost h-10! px-3! text-xs! sm:col-span-5 sm:justify-self-start" data-testid="save-advance" disabled={!(amount(paid) > 0)} onClick={() => void save()}>Record it</button>
          </div>
        )}
        {advances.length > 0 && <ul className="divide-y divide-border" data-testid="advance-list">{advances.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-1.5" data-testid="advance-row"><span>{shortDay(item.on)} · {ADVANCE_KINDS[item.kind]}{item.note ? `: ${item.note}` : ""}</span><span className="tabular-nums">{usd(item.amount, 2)}</span></li>)}</ul>}
        {!reo && <p className="text-xs text-muted-foreground">Costs advanced are owed back at payoff and show on payoff letters. Bringing the loan current doesn&apos;t need them; if the borrower pays them sooner, record it here.</p>}
        {!reo && owed > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Borrower repaid</span><input className="desk-input w-36!" inputMode="decimal" data-testid="repaid-amount" placeholder={owed.toFixed(2)} value={repaid} onChange={(event) => setRepaid(event.target.value)} /></label>
            <label className="block min-w-0 flex-1 basis-40"><span className="label">Reference</span><input className="desk-input" data-testid="repaid-reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
            <button type="button" className="btn-ghost h-10! px-3! text-xs!" data-testid="save-repaid" disabled={!(amount(repaid) > 0) || !reference.trim()} onClick={() => void back()}>Record it repaid</button>
          </div>
        )}
      </div>
    </Section>
  );
}

function Foreclosure({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch, viewerName } = useStore();
  const [attorney, setAttorney] = useState("");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [county, setCounty] = useState(deal.app.county);
  const [judgment, setJudgment] = useState("");
  const [saleOn, setSaleOn] = useState("");
  const [winner, setWinner] = useState<"lendhous" | "third_party">("lendhous");
  const [bid, setBid] = useState("");
  const [stopping, setStopping] = useState<"" | "dismissed" | "deed_in_lieu">("");
  const [proceeds, setProceeds] = useState("");
  const [reference, setReference] = useState("");
  const stayed = inBankruptcy(deal);
  const open = deal.foreclosure && !deal.foreclosure.stopped ? deal.foreclosure : undefined;
  const next = nextStep(deal);
  const notice = defaultNotice(deal);
  const owed = payoffFor(deal, today).total;
  const reset = () => { setNote(""); setOn(today); };
  if (!open) {
    const stopped = deal.foreclosure?.stopped;
    return (
      <Section title="Foreclosure">
        <div className="space-y-2 text-sm" data-testid="foreclosure">
          {stopped && <p className="text-xs text-muted-foreground">An earlier case with {deal.foreclosure!.attorney} ended {shortDay(stopped.on)}: {STOP_REASONS[stopped.why].toLowerCase()}.</p>}
          {!openDefault(deal) ? <p className="text-muted-foreground">Not in foreclosure.</p> : stayed ? <p className="text-muted-foreground">On hold: the automatic stay stops a foreclosure until the bankruptcy ends or the court lifts it.</p> : !notice || today <= notice.cureEnds ? (
            <p className="text-muted-foreground" data-testid="foreclosure-wait">{!notice ? "Send the notice of default first: the loan documents give the borrower time to cure." : `The notice of default's cure period runs to ${shortDay(notice.cureEnds)}. Refer it to the attorney after that.`}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2" data-testid="refer-form">
              <label className="block min-w-0 flex-1 basis-48"><span className="label">Foreclosure attorney or firm</span><input className="desk-input" data-testid="foreclosure-attorney" maxLength={160} value={attorney} onChange={(event) => setAttorney(event.target.value)} /></label>
              <label className="block"><span className="label">Referred on</span><input type="date" className="desk-input" data-testid="foreclosure-referred" max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
              <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="refer-foreclosure" disabled={!attorney.trim()} onClick={() => void dispatch({ t: "referForeclosure", dealId: deal.id, attorney: attorney.trim(), on, by: viewerName })}>Refer it</button>
            </div>
          )}
        </div>
      </Section>
    );
  }
  const record = async () => {
    if (!next) return;
    const extra = next.step === "complaint_filed" ? { caseNumber: caseNumber.trim(), county: county.trim() } : next.step === "judgment" ? { judgment: { amount: amount(judgment), saleOn } } : next.step === "sale_held" ? { sale: { winner, amount: amount(bid) } } : {};
    if (await dispatch({ t: "foreclosureStep", dealId: deal.id, step: next.step, on, note: note.trim(), ...extra, by: viewerName })) reset();
  };
  const done = new Map(open.steps.map((item) => [item.step, item]));
  return (
    <Section title="Foreclosure" right={<Badge tone="rose">With {open.attorney}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="foreclosure">
        <p className="text-xs text-muted-foreground">Referred {shortDay(open.referredOn)}{open.caseNumber ? ` · case ${open.caseNumber}, ${open.county} County` : ""}. {usd(owed, 2)} to pay it off today.</p>
        <ol className="space-y-1" data-testid="foreclosure-steps">
          {FORECLOSURE_STEPS.map((item) => {
            const step = done.get(item.step);
            return (
              <li key={item.step} className={`flex gap-2 ${step ? "" : "text-muted-foreground"}`} data-testid="foreclosure-step">
                <span aria-hidden className="w-4 shrink-0">{step ? "✓" : item.step === next?.step ? "→" : "·"}</span>
                <span className="min-w-0"><span className={step ? "font-medium" : ""}>{item.label}</span>{step ? ` ${shortDay(step.on)}${step.note ? `: ${step.note}` : ""}` : item.step === next?.step ? <small className="block text-xs">{item.hint}</small> : null}{item.step === "judgment" && open.judgment ? ` · ${usd(open.judgment.amount, 2)}, sale ${shortDay(open.judgment.saleOn)}` : ""}{item.step === "sale_held" && open.sale ? ` · ${open.sale.winner === "lendhous" ? "LendHous" : "a third party"} at ${usd(open.sale.amount, 2)}` : ""}</span>
              </li>
            );
          })}
        </ol>
        {stayed && <p className="text-xs text-bad">On hold: the automatic stay stops the case until the bankruptcy ends or the court lifts it.</p>}
        {!stayed && next && !(next.step === "certificate_of_title" && open.sale?.winner === "third_party") && (
          <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="step-form">
            <p className="font-medium">{next.label}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="block"><span className="label">On</span><input type="date" className="desk-input" data-testid="step-on" max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
              {next.step === "complaint_filed" && <><label className="block"><span className="label">Case number</span><input className="desk-input" data-testid="step-case" maxLength={60} value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} /></label><label className="block"><span className="label">County</span><input className="desk-input" data-testid="step-county" maxLength={60} value={county} onChange={(event) => setCounty(event.target.value)} /></label></>}
              {next.step === "judgment" && <><label className="block"><span className="label">Judgment amount</span><input className="desk-input" inputMode="decimal" data-testid="step-judgment" placeholder={owed.toFixed(2)} value={judgment} onChange={(event) => setJudgment(event.target.value)} /></label><label className="block"><span className="label">Sale date</span><input type="date" className="desk-input" data-testid="step-sale-on" min={on} value={saleOn} onChange={(event) => setSaleOn(event.target.value)} /></label></>}
              {next.step === "sale_held" && <><label className="block"><span className="label">Won by</span><select className="desk-input" data-testid="step-winner" value={winner} onChange={(event) => setWinner(event.target.value as typeof winner)}><option value="lendhous">LendHous (credit bid)</option><option value="third_party">A third party</option></select></label><label className="block"><span className="label">Winning bid</span><input className="desk-input" inputMode="decimal" data-testid="step-bid" value={bid} onChange={(event) => setBid(event.target.value)} /></label></>}
              <label className="block sm:col-span-4"><span className="label">Note</span><input className="desk-input" data-testid="step-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            </div>
            <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="save-step" onClick={() => void record()}>Record it</button>
          </div>
        )}
        {open.sale?.winner === "third_party" && !deal.paidOff && (
          <div className="flex flex-wrap items-end gap-2 rounded-[2px] border border-border p-3" data-testid="proceeds-form">
            <label className="block"><span className="label">The clerk paid</span><input className="desk-input w-40!" inputMode="decimal" data-testid="proceeds-amount" placeholder={Math.min(open.sale.amount, owed).toFixed(2)} value={proceeds} onChange={(event) => setProceeds(event.target.value)} /></label>
            <label className="block"><span className="label">Received</span><input type="date" className="desk-input" data-testid="proceeds-on" min={open.sale.on} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
            <label className="block min-w-0 flex-1 basis-40"><span className="label">Reference</span><input className="desk-input" data-testid="proceeds-reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
            <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="save-proceeds" disabled={!(amount(proceeds) > 0) || !reference.trim()} onClick={() => void dispatch({ t: "saleProceeds", dealId: deal.id, amount: amount(proceeds), on, reference: reference.trim(), by: viewerName })}>Close the loan</button>
            <p className="basis-full text-xs text-muted-foreground">It ends the loan even if it&apos;s short of the {usd(owed, 2)} owed; the shortfall stays a claim against the borrower and guarantors.</p>
          </div>
        )}
        {!stopping ? (
          <span className="flex gap-3 text-xs"><button type="button" className="text-link underline underline-offset-2" data-testid="stop-dismissed" onClick={() => setStopping("dismissed")}>The case was dismissed</button>{!stayed && <button type="button" className="text-link underline underline-offset-2" data-testid="stop-deed" onClick={() => setStopping("deed_in_lieu")}>Take a deed in lieu</button>}</span>
        ) : (
          <div className="flex flex-wrap items-end gap-2" data-testid="stop-form">
            <label className="block"><span className="label">On</span><input type="date" className="desk-input" data-testid="stop-on" min={open.referredOn} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
            <label className="block min-w-0 flex-1 basis-48"><span className="label">{stopping === "deed_in_lieu" ? "The deed's recording" : "Why"}</span><input className="desk-input" data-testid="stop-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="save-stop" onClick={async () => { if (await dispatch({ t: "stopForeclosure", dealId: deal.id, on, why: stopping, note: note.trim(), by: viewerName })) { setStopping(""); reset(); } }}>{stopping === "deed_in_lieu" ? "Take the property" : "Record it"}</button>
            <button type="button" className="btn-ghost h-10! px-3! text-xs!" onClick={() => setStopping("")}>Cancel</button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Paying it off, bringing it current or a signed modification ends the case by itself.</p>
      </div>
    </Section>
  );
}

function BankOwned({ deal, today }: { deal: Deal; today: string }) {
  const { s, dispatch, viewerName } = useStore();
  const reo = deal.reo!;
  const [on, setOn] = useState(today);
  const [price, setPrice] = useState("");
  const [value, setValue] = useState("");
  const [costs, setCosts] = useState("");
  const [reference, setReference] = useState("");
  const owed = reo.owed.principal + reo.owed.interest + reo.owed.fees + reo.owed.advances;
  const paid = reoProceeds(deal);
  const split = lossSplit(s, deal);
  return (
    <Section title="Bank-owned property" right={<Badge tone={reo.sold ? "slate" : "rose"}>{reo.sold ? `Sold ${shortDay(reo.sold.on)}` : reo.listed ? `Listed at ${usd(reo.listed.price)}` : "Not listed"}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="reo">
        <p>LendHous took the property on {shortDay(reo.since)} by {reo.how === "deed_in_lieu" ? "a deed in lieu of foreclosure" : "the foreclosure's certificate of title"}. The loan then came to {usd(owed, 2)}: {usd(reo.owed.principal, 2)} principal, {usd(reo.owed.interest, 2)} interest, {usd(reo.owed.fees, 2)} fees and {usd(reo.owed.advances, 2)} of costs advanced.{reo.value ? ` Valued at ${usd(reo.value)}.` : ""}</p>
        {!reo.sold && (
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="block"><span className="label">On</span><input type="date" className="desk-input" data-testid="reo-on" min={reo.since} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
            <label className="block"><span className="label">{reo.listed ? "Sold for" : "List price"}</span><input className="desk-input" inputMode="decimal" data-testid="reo-price" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
            {reo.listed ? (
              <>
                <label className="block"><span className="label">Closing costs</span><input className="desk-input" inputMode="decimal" data-testid="reo-costs" value={costs} onChange={(event) => setCosts(event.target.value)} /></label>
                <label className="block"><span className="label">Closing reference</span><input className="desk-input" data-testid="reo-reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
                <button type="button" className="btn-primary h-10! px-3! text-xs! sm:col-span-4 sm:justify-self-start" data-testid="sell-reo" disabled={!(amount(price) > 0) || !reference.trim()} onClick={() => void dispatch({ t: "sellReo", dealId: deal.id, on, price: amount(price), closingCosts: amount(costs), reference: reference.trim(), by: viewerName })}>Record the sale</button>
              </>
            ) : (
              <>
                <label className="block"><span className="label">Value (BPO or appraisal)</span><input className="desk-input" inputMode="decimal" data-testid="reo-value" value={value} onChange={(event) => setValue(event.target.value)} /></label>
                <button type="button" className="btn-primary h-10! px-3! text-xs! self-end" data-testid="list-reo" disabled={!(amount(price) > 0)} onClick={async () => { if (await dispatch({ t: "listReo", dealId: deal.id, on, price: amount(price), ...(amount(value) ? { value: amount(value) } : {}), by: viewerName })) setPrice(""); }}>List it</button>
              </>
            )}
          </div>
        )}
        {reo.sold && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="reo-proceeds">
              <div><dt className="text-xs text-muted-foreground">Sale, less its costs</dt><dd className="font-semibold tabular-nums">{usd(paid.net, 2)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Costs back to LendHous</dt><dd className="font-semibold tabular-nums">{usd(paid.costsBack, 2)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Principal back</dt><dd className="font-semibold tabular-nums">{usd(paid.principal, 2)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Principal lost</dt><dd className={`font-semibold tabular-nums ${paid.principalLoss > 0 ? "text-bad" : ""}`} data-testid="reo-loss">{usd(paid.principalLoss, 2)}</dd></div>
            </dl>
            <table className="stack-table w-full" data-testid="loss-split">
              <thead><tr className="border-b border-rule"><th>Who holds it</th><th className="text-right">Share</th><th className="text-right">Principal</th><th className="text-right">Back</th><th className="text-right">Loss</th></tr></thead>
              <tbody>{split.map((line) => <tr key={line.who} className="border-b border-border last:border-0" data-testid="loss-row"><td>{line.who}</td><td data-label="Share" className="text-right tabular-nums">{(line.share * 100).toFixed(0)}%</td><td data-label="Principal" className="text-right tabular-nums">{usd(line.principal, 2)}</td><td data-label="Back" className="text-right tabular-nums">{usd(line.recovered, 2)}</td><td data-label="Loss" className="text-right tabular-nums">{usd(line.loss, 2)}</td></tr>)}</tbody>
            </table>
            <p className="text-xs text-muted-foreground">The sale&apos;s costs come off first, then LendHous takes back the costs it advanced and carried, then principal by share, then interest. PLACEHOLDER until the participation and sale agreements say how a loss is shared.{paid.interestLost > 0 ? ` ${usd(paid.interestLost, 2)} of interest and fees owed wasn't recovered.` : ""}</p>
          </>
        )}
      </div>
    </Section>
  );
}
