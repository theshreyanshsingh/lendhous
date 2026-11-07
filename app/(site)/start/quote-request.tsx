"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendQuote } from "@/actions/leads";
import { AddressField, emptyAddress, type AddressValue } from "@/components/AddressField";
import { PropertyPhotoPicker } from "@/components/PropertyPhotoPicker";
import { SIGNUP_PREFILL } from "@/components/signup-form";
import { Arrive, Reveal } from "@/components/motion";
import type { PricingConfig } from "@/lib/pricing-config";
import { quoteBuyDowns } from "@/lib/buy-down";
import { ratePercent } from "@/lib/format";
import { evaluate } from "@/lib/engine";
import { cashToCloseParts, CITIZENSHIP_LABEL, CREDIT_LABEL, dealProblem, EXITS, EXPERIENCE_LABEL, indicativeTerms, LOAN_TYPES, PRICED, PROPERTY_TYPES, PURPOSES, quoteApplication, quoteProblem, quoteSummary, type LoanType, type Quote, type QuoteDeal } from "@/lib/quote";
import { embedChannel, type QuoteStep } from "@/lib/quote-funnel";

type Draft = {
  submitter: "borrower" | "broker"; broker: { name: string; company: string; email: string; phone: string };
  borrower: { firstName: string; lastName: string; email: string; phone: string };
  citizenship: string; creditBand: string; experience: string; address: AddressValue; propertyType: string; beds: string; baths: string; sqft: string;
  loanType: LoanType; purpose: string; purchasePrice: string; rehab: string; arv: string; requestedAmount: string; monthlyRent: string; rentalType: "long_term" | "short_term"; strAnnualIncome: string; strIncomeSource: "payouts" | "projection"; buyDownPoints?: number; fundingDate: string;
  comps: { address: string; price: string; soldOn: string }[]; exit: string; notes: string;
};
const blank = (): Draft => ({ submitter: "borrower", broker: { name: "", company: "", email: "", phone: "" }, borrower: { firstName: "", lastName: "", email: "", phone: "" }, citizenship: "", creditBand: "", experience: "", address: emptyAddress(), propertyType: "sfr", beds: "", baths: "", sqft: "", loanType: "fix_flip", purpose: "purchase", purchasePrice: "", rehab: "", arv: "", requestedAmount: "", monthlyRent: "", rentalType: "long_term", strAnnualIncome: "", strIncomeSource: "payouts", fundingDate: "", comps: [], exit: "sell", notes: "" });
const num = (text: string) => { const value = Number(text.replace(/[^0-9.]/g, "")); return text.trim() === "" || !Number.isFinite(value) ? undefined : value; };
const dollars = (text: string) => { const value = num(text); return value === undefined ? "" : value.toLocaleString("en-US"); };
const usd = (amount: number) => `${amount < 0 ? "−" : ""}$${Math.abs(Math.round(amount)).toLocaleString("en-US")}`;

/** The deal part of the draft, as the terms are worked out from. */
function toDeal(draft: Draft) {
  return {
    citizenship: draft.citizenship, creditBand: draft.creditBand, experience: draft.experience, address: draft.address, propertyType: draft.propertyType,
    beds: num(draft.beds), baths: num(draft.baths), sqft: num(draft.sqft), loanType: draft.loanType, purpose: draft.purpose,
    purchasePrice: num(draft.purchasePrice) ?? 0, rehab: num(draft.rehab) ?? 0, arv: num(draft.arv), requestedAmount: num(draft.requestedAmount), monthlyRent: draft.loanType === "dscr" && draft.rentalType === "short_term" ? undefined : num(draft.monthlyRent),
    ...(draft.loanType === "dscr" && draft.rentalType === "short_term" ? { rentalType: draft.rentalType, strAnnualIncome: num(draft.strAnnualIncome), strIncomeSource: draft.strIncomeSource } : {}),
    ...(draft.buyDownPoints !== undefined ? { buyDownPoints: draft.buyDownPoints } : {}),
    fundingDate: draft.fundingDate, comps: draft.comps.filter((comp) => comp.address.trim()).map((comp) => ({ address: comp.address, price: num(comp.price) ?? 0, soldOn: comp.soldOn })), exit: draft.exit, notes: draft.notes,
  };
}
/** The whole draft as the request the server checks. */
const toQuote = (draft: Draft): unknown => ({ submitter: draft.submitter, broker: draft.submitter === "broker" ? draft.broker : undefined, borrower: draft.borrower, ...toDeal(draft) });

/**
 * The loan quote: the visitor describes the deal and sees indicative terms from today's pricing straight away, worked out
 * in their browser, with nothing sent or kept. Saving the terms asks who they are and sends the request to the team.
 * `embed` is the quote widget on a partner's or GT's own site (/embed/quote).
 */
export function QuoteRequest({ pricing, signupOpen = false, referral, embed }: { pricing: PricingConfig; signupOpen?: boolean; referral?: { code: string; name: string; kind: "broker" | "borrower" }; embed?: { site: string } }) {
  const channel = embed ? embedChannel(embed.site) : "site";
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<QuoteDeal | null>(null);
  const [sending, setSending] = useState<false | "quote" | string>(false);
  const [sent, setSent] = useState<Quote | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoResult, setPhotoResult] = useState({ sent: 0, failed: 0 });
  const [honeypot, setHoneypot] = useState("");
  const termsRef = useRef<HTMLDivElement>(null);
  // Each step is counted once per visit, anonymously (lib/quote-funnel.ts).
  const counted = useRef<Partial<Record<QuoteStep, boolean>>>({});
  const count = (step: QuoteStep) => {
    if (counted.current[step]) return;
    counted.current[step] = true;
    void fetch("/api/quote-event", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step, channel, ref: referral?.code ?? "" }) }).catch(() => {});
  };
  const put = (changes: Partial<Draft>) => { count("started"); setDraft((current) => ({ ...current, ...changes })); };
  const rehabLoan = draft.loanType === "fix_flip" || draft.loanType === "ground_up";
  const rental = draft.loanType.startsWith("dscr") || draft.loanType === "second";
  // A DSCR rental let by the night is sized on its yearly income instead of a monthly rent.
  const nightly = draft.loanType === "dscr" && draft.rentalType === "short_term";
  // Once the terms are showing they follow the numbers; while an edit leaves the deal incomplete, the last good terms stay.
  const live = shown ? dealProblem(toDeal(draft)) : null;
  const deal = live && "deal" in live ? live.deal : shown;
  useEmbedHeight(Boolean(embed));

  function seeTerms() {
    setError("");
    const checked = dealProblem(toDeal(draft));
    if ("error" in checked) return setError(checked.error);
    count("started");
    count("shown");
    setShown(checked.deal);
    setTimeout(() => termsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!shown) return seeTerms();
    const checked = quoteProblem(toQuote(draft));
    if ("error" in checked) return setError(checked.error);
    setSending("quote");
    const reply: { sent: boolean; error: string; photoKey?: string } = await sendQuote(checked.quote, honeypot, referral?.code, channel).catch(() => ({ sent: false, error: "We couldn't send this just now. Please try again in a few minutes." }));
    if (!reply.sent) { setSending(false); return setError(reply.error); }
    // The photos follow the request, one at a time, with the key it came back with.
    let done = 0; let failed = 0;
    for (const [index, file] of photos.entries()) {
      if (!reply.photoKey) { failed++; continue; }
      setSending(`Sending photo ${index + 1} of ${photos.length}…`);
      const form = new FormData();
      form.set("key", reply.photoKey); form.set("file", file);
      const ok = await fetch("/api/lead-photos", { method: "POST", body: form }).then((response) => response.ok).catch(() => false);
      if (ok) done++; else failed++;
    }
    setPhotoResult({ sent: done, failed });
    setSending(false);
    setSent(checked.quote);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (sent) return <QuoteSent quote={sent} pricing={pricing} photos={photoResult} signupOpen={signupOpen} embed={Boolean(embed)} />;

  const text = (label: string, value: string, set: (value: string) => void, extra: { type?: string; testid?: string; auto?: string; required?: boolean; max?: number; placeholder?: string } = {}) => (
    <label>{label}{extra.required === false ? "" : " *"}<input type={extra.type ?? "text"} data-testid={extra.testid} autoComplete={extra.auto} required={extra.required !== false} maxLength={extra.max ?? 120} placeholder={extra.placeholder} value={value} onChange={(event) => set(event.target.value)} /></label>
  );
  const money = (label: string, key: "purchasePrice" | "rehab" | "arv" | "requestedAmount" | "monthlyRent" | "strAnnualIncome", required = true, hint?: string) => (
    <label>{label}{required ? " *" : ""}<input inputMode="numeric" data-testid={`quote-${key}`} required={required} placeholder="$0" value={draft[key]} onChange={(event) => put({ [key]: dollars(event.target.value) })} />{hint && <small className="quote-hint">{hint}</small>}</label>
  );
  const select = <K extends string>(label: string, value: string, options: Record<K, string>, set: (value: K) => void, testid: string) => (
    <label>{label} *<select data-testid={testid} required value={value} onChange={(event) => set(event.target.value as K)}><option value="" disabled>Select</option>{(Object.entries(options) as [K, string][]).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
  );

  return (
    <form className="quote-form" onSubmit={submit} data-testid="quote-form" noValidate>
      {referral && <p className="panel quote-small" data-testid="quote-referral">Referred by <b>{referral.name}</b>{referral.kind === "borrower" ? ", a LendHous borrower." : ". They'll be kept up to date on this request."}</p>}

      {/* The kind of loan comes first: it decides what the rest of the form asks. */}
      <section className="panel">
        <div className="quote-step-title"><i>1</i> The loan</div>
        <div className="quote-chips" role="radiogroup" aria-label="Type of loan">
          {(Object.entries(LOAN_TYPES) as [LoanType, string][]).map(([key, name]) => <button key={key} type="button" role="radio" aria-checked={draft.loanType === key} data-testid={`quote-loan-${key}`} className={`quote-chip ${draft.loanType === key ? "on" : ""}`} onClick={() => put({ loanType: key })}>{name}</button>)}
        </div>
        <div className="fields fields-phone-2" style={{ marginTop: 20 }}>
          {select("Purpose", draft.purpose, PURPOSES, (purpose) => put({ purpose }), "quote-purpose")}
          {select("Exit strategy", draft.exit, EXITS, (exit) => put({ exit }), "quote-exit")}
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>2</i> The property</div>
        <AddressField variant="site" testid="quote-address" value={draft.address} onChange={(address) => put({ address })} />
        <div style={{ marginTop: 20 }}><PropertyPhotoPicker onChange={setPhotos} testid="quote-photos" /></div>
        <div className="fields" style={{ marginTop: 20 }}>
          {select("Property type", draft.propertyType, PROPERTY_TYPES, (propertyType) => put({ propertyType }), "quote-type")}
          <div className="quote-trio">
            <label>Beds<input inputMode="numeric" data-testid="quote-beds" maxLength={3} value={draft.beds} onChange={(event) => put({ beds: event.target.value.replace(/[^0-9]/g, "") })} /></label>
            <label>Baths<input inputMode="decimal" data-testid="quote-baths" maxLength={4} value={draft.baths} onChange={(event) => put({ baths: event.target.value.replace(/[^0-9.]/g, "") })} /></label>
            <label>Sq ft<input inputMode="numeric" data-testid="quote-sqft" maxLength={9} value={draft.sqft} onChange={(event) => put({ sqft: dollars(event.target.value) })} /></label>
          </div>
          {rehabLoan && money("After-repair value (ARV)", "arv", true, "What it sells for once the work is done. Add comps below to support it.")}
        </div>
        {rehabLoan && (
          <div className="quote-comps">
            <div className="quote-comps-head"><b>Comparable sales for the ARV</b><span>Optional, up to 3. Recent sales of similar finished homes nearby.</span></div>
            {draft.comps.map((comp, index) => (
              <Arrive key={index} className="quote-comp">
                <label>Address<input data-testid={`comp-address-${index}`} maxLength={200} value={comp.address} onChange={(event) => put({ comps: draft.comps.map((item, at) => (at === index ? { ...item, address: event.target.value } : item)) })} /></label>
                <label>Sold for<input data-testid={`comp-price-${index}`} inputMode="numeric" placeholder="$0" value={comp.price} onChange={(event) => put({ comps: draft.comps.map((item, at) => (at === index ? { ...item, price: dollars(event.target.value) } : item)) })} /></label>
                <label>Sold in<input data-testid={`comp-sold-${index}`} type="month" value={comp.soldOn} onChange={(event) => put({ comps: draft.comps.map((item, at) => (at === index ? { ...item, soldOn: event.target.value } : item)) })} /></label>
                <button type="button" className="quote-remove" aria-label="Remove this comp" onClick={() => put({ comps: draft.comps.filter((_, at) => at !== index) })}>×</button>
              </Arrive>
            ))}
            {draft.comps.length < 3 && <button type="button" className="text-link" data-testid="add-comp" onClick={() => put({ comps: [...draft.comps, { address: "", price: "", soldOn: "" }] })}>+ Add a comp</button>}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>3</i> The numbers</div>
        <div className="fields">
          {money(draft.purpose === "purchase" ? "Purchase price" : "Current value", "purchasePrice")}
          {rehabLoan && money(draft.loanType === "ground_up" ? "Construction budget" : "Renovation budget", "rehab")}
          {draft.loanType === "dscr" && select("How it's rented", draft.rentalType, { long_term: "On a lease", short_term: "By the night (Airbnb, VRBO)" }, (rentalType) => put({ rentalType }), "quote-rental-type")}
          {rental && !nightly && money("Monthly rent (lease or market)", "monthlyRent")}
          {nightly && select("Income from", draft.strIncomeSource, { payouts: "The last 12 months of payouts", projection: "A projection (no history yet)" }, (strIncomeSource) => put({ strIncomeSource }), "quote-str-source")}
          {nightly && money(draft.strIncomeSource === "projection" ? "Projected income a year" : "Payouts in the last 12 months", "strAnnualIncome", true, "Before cleaning and management costs. We count part of it as rent.")}
          {money("Loan amount you'd like", "requestedAmount", false, "Leave blank for the most it qualifies for.")}
          {text("Funding date you'd like", draft.fundingDate, (fundingDate) => put({ fundingDate }), { type: "date", testid: "quote-date" })}
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>4</i> {draft.submitter === "broker" ? "The borrower's background" : "Your background"}</div>
        <p className="quote-small">Used only to estimate the rate. No credit is pulled.</p>
        <div className="fields" style={{ marginTop: 14 }}>
          {select("Citizenship", draft.citizenship, CITIZENSHIP_LABEL, (citizenship) => put({ citizenship }), "quote-citizen")}
          {select("Credit score (estimate)", draft.creditBand, CREDIT_LABEL, (creditBand) => put({ creditBand }), "quote-credit")}
          {select("Projects finished in the last 3 years", draft.experience, EXPERIENCE_LABEL, (experience) => put({ experience }), "quote-experience")}
        </div>
      </section>

      {/* On a phone this rides at the foot of the screen through every step, under the thumb. */}
      {!shown && (
        <div className="quote-go">
          {error && <Arrive className="form-error"><span role="alert" data-testid="quote-error">{error}</span></Arrive>}
          <p className="quote-small">No name, email or phone needed to see your terms. Nothing is sent until you save them.</p>
          <button className="button quote-submit" type="button" data-testid="quote-see-terms" onClick={seeTerms}>See my terms →</button>
        </div>
      )}

      {shown && deal && (
        <>
          <div ref={termsRef} className="panel quote-live" data-testid="quote-live">
            <div className="eyebrow">YOUR INDICATIVE TERMS</div>
            {live && "error" in live && <p className="quote-small quote-stale" data-testid="quote-stale">{live.error} These are the terms before that change.</p>}
            <TermsCard deal={deal} pricing={pricing} onPoints={(buyDownPoints) => put({ buyDownPoints })} />
          </div>

          <section className="panel">
            <div className="quote-step-title"><i>5</i> Save these terms</div>
            <p className="quote-small">A loan officer calls about them, usually the same business day.</p>
            <div className="quote-choices" role="radiogroup" style={{ marginTop: 14 }}>
              {(["borrower", "broker"] as const).map((who) => (
                <button key={who} type="button" role="radio" aria-checked={draft.submitter === who} data-testid={`quote-${who}`} className={`quote-choice ${draft.submitter === who ? "on" : ""}`} onClick={() => put({ submitter: who })}>
                  <b>{who === "borrower" ? "I'm the borrower" : "I'm a loan broker"}</b>
                  <span>{who === "borrower" ? "Applying for myself or my own LLC." : "Sending a client's deal on their behalf."}</span>
                </button>
              ))}
            </div>
            <Reveal open={draft.submitter === "broker"}>
              <div className="fields" style={{ marginTop: 18 }}>
                {text("Your name", draft.broker.name, (name) => put({ broker: { ...draft.broker, name } }), { testid: "broker-name", auto: "name", required: draft.submitter === "broker" })}
                {text("Company", draft.broker.company, (company) => put({ broker: { ...draft.broker, company } }), { required: false, auto: "organization" })}
                {text("Your email", draft.broker.email, (email) => put({ broker: { ...draft.broker, email } }), { type: "email", testid: "broker-email", auto: "email", required: draft.submitter === "broker", max: 200 })}
                {text("Your phone", draft.broker.phone, (phone) => put({ broker: { ...draft.broker, phone } }), { type: "tel", testid: "broker-phone", auto: "tel", required: draft.submitter === "broker", max: 40 })}
              </div>
            </Reveal>
            {draft.submitter === "broker" && <p className="quote-small" style={{ marginTop: 14 }}>The borrower is added as a guarantor, and their name goes on the quote and the application.</p>}
            <div className="fields" style={{ marginTop: 18 }}>
              {text(draft.submitter === "broker" ? "Borrower's first name" : "First name", draft.borrower.firstName, (firstName) => put({ borrower: { ...draft.borrower, firstName } }), { testid: "quote-first", auto: draft.submitter === "borrower" ? "given-name" : "off" })}
              {text(draft.submitter === "broker" ? "Borrower's last name" : "Last name", draft.borrower.lastName, (lastName) => put({ borrower: { ...draft.borrower, lastName } }), { testid: "quote-last", auto: draft.submitter === "borrower" ? "family-name" : "off" })}
              {text(draft.submitter === "broker" ? "Borrower's email" : "Email", draft.borrower.email, (email) => put({ borrower: { ...draft.borrower, email } }), { type: "email", testid: "quote-email", auto: draft.submitter === "borrower" ? "email" : "off", max: 200 })}
              {text(draft.submitter === "broker" ? "Borrower's phone" : "Phone", draft.borrower.phone, (phone) => put({ borrower: { ...draft.borrower, phone } }), { type: "tel", testid: "quote-phone", auto: draft.submitter === "borrower" ? "tel" : "off", required: draft.submitter === "borrower", max: 40 })}
            </div>
            <label style={{ marginTop: 20 }}>Anything else we should know<textarea rows={3} maxLength={1500} value={draft.notes} placeholder="Timeline, scope, questions." onChange={(event) => put({ notes: event.target.value })} /></label>
          </section>

          <label className="hp" aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} /></label>
          <p className="quote-small">This isn&apos;t an application and doesn&apos;t pull credit. Don&apos;t enter a Social Security number or account details here.</p>
          {/* Once the terms show, saving them rides at the foot of a phone's screen, with any problem just above it. */}
          <div className="quote-go">
            {error && <Arrive className="form-error"><span role="alert" data-testid="quote-error">{error}</span></Arrive>}
            <button className="button quote-submit" type="submit" data-testid="quote-submit" disabled={Boolean(sending)}>{sending === "quote" ? "Saving…" : sending ? sending : "Save my terms →"}</button>
          </div>
        </>
      )}
    </form>
  );
}

/** In the widget, tells the page it sits on how tall it is, so the frame grows with it instead of scrolling. */
function useEmbedHeight(on: boolean) {
  useEffect(() => {
    if (!on || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "lendhous-quote-height", height: document.documentElement.scrollHeight }, "*");
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    send();
    return () => observer.disconnect();
  }, [on]);
}

/**
 * More points for a lower rate, or fewer for a higher one (lib/buy-down.ts), on the indicative terms: each choice re-prices
 * the whole card. The pick goes with the saved request as a preference.
 */
function RateSlider({ deal, pricing, onPoints }: { deal: QuoteDeal; pricing: PricingConfig; onPoints: (points: number | undefined) => void }) {
  const app = quoteApplication(deal);
  const options = app ? quoteBuyDowns(app, pricing) : [];
  if (options.length < 2) return null;
  const start = evaluate(app!, pricing).pointsPct;
  // A pick the new numbers no longer allow falls back to the estimate's own points, as the terms above do.
  const index = (points: number) => options.findIndex((option) => Math.abs(option.points - points) < 1e-9);
  const at = Math.max(0, deal.buyDownPoints !== undefined && index(deal.buyDownPoints) >= 0 ? index(deal.buyDownPoints) : index(start));
  return (
    <div className="quote-slider" data-testid="quote-buy-down">
      <label>Buy the rate down, or keep the points low
        <input type="range" min={0} max={options.length - 1} step={1} value={at} data-testid="quote-buy-down-slider" aria-valuetext={`${ratePercent(options[at].rate)} with ${options[at].points} points`} onChange={(event) => { const option = options[Number(event.target.value)]; onPoints(Math.abs(option.points - start) < 1e-9 ? undefined : option.points); }} />
      </label>
      <div className="quote-slider-ends"><span>Fewer points, higher rate</span><span>More points, lower rate</span></div>
    </div>
  );
}

/** Indicative terms for a deal on today's pricing: what it could borrow, at what cost, and the cash to close, itemized. */
function TermsCard({ deal, pricing, onPoints }: { deal: QuoteDeal; pricing: PricingConfig; onPoints?: (points: number | undefined) => void }) {
  const terms = indicativeTerms(deal, pricing);
  if (!terms) return <p data-testid="quote-review">A loan officer prices {LOAN_TYPES[deal.loanType].toLowerCase()} loans by hand. Save the request and they&apos;ll be in touch shortly.</p>;
  if (!terms.eligible) return <p data-testid="quote-review">This one needs a closer look before we can put numbers on it: {terms.hardStops[0] ?? "a ratio is outside our limits"}. Save it and a loan officer will call you about it.</p>;
  const parts = cashToCloseParts(deal, terms, pricing);
  const [low, high] = terms.rateRange;
  return (
    <div className="quote-terms" data-testid="quote-terms">
      <p>Based on what you entered, a {LOAN_TYPES[deal.loanType].toLowerCase()} loan on this property could look like:</p>
      <dl>
        <div><dt>Loan amount</dt><dd data-testid="quote-amount">up to {usd(terms.noteAmount)}</dd></div>
        <div><dt>Rate</dt><dd data-testid="quote-rate">about {ratePercent(terms.rate)}</dd>{high > low && <small className="quote-hint">{low.toFixed(2)}–{high.toFixed(2)}% for this kind of loan</small>}</div>
        <div><dt>Points</dt><dd>{terms.pointsPct}</dd></div>
        <div><dt>Term</dt><dd>{PRICED[deal.loanType] === "dscr" ? "30 years" : `${terms.termMonths} months`}</dd></div>
        <div><dt>Monthly payment</dt><dd>about {usd(terms.monthlyPayment)}</dd></div>
        <div><dt>Cash to close</dt><dd data-testid="quote-cash">about {usd(terms.cashToClose)}</dd></div>
      </dl>
      {onPoints && <RateSlider deal={deal} pricing={pricing} onPoints={onPoints} />}
      <details className="quote-cash-parts" data-testid="quote-cash-parts">
        <summary>Where the cash to close goes</summary>
        <ul>
          {parts.map((part) => <li key={part.label}><span>{part.label}</span><b>{usd(part.amount)}</b></li>)}
          <li className="quote-cash-total"><span>Cash to close</span><b>{usd(terms.cashToClose)}</b></li>
        </ul>
        {terms.holdback > 0 && <p className="quote-small">The {deal.loanType === "ground_up" ? "construction" : "renovation"} money ({usd(terms.holdback)}) is held back and paid to you in draws as the work is done, so plan to fund the first stage yourself.</p>}
      </details>
      {terms.ratios.length > 0 && <p className="quote-small">{terms.ratios.map((ratio) => `${ratio.label} ${(ratio.key === "dscr" ? ratio.actual.toFixed(2) + "x" : `${(ratio.actual * 100).toFixed(1)}%`)}`).join(" · ")}. {PRICED[deal.loanType] === "dscr" ? "Assumes taxes and insurance of about 3% of the value a year." : ""}</p>}
      <p className="quote-small">An estimate from what you entered, not an offer or a commitment to lend. Final terms depend on underwriting, the appraisal, title and credit. Business-purpose loans only.</p>
    </div>
  );
}

/** After saving: the terms again, a copy to keep, and the way on to an account and the application. */
function QuoteSent({ quote, pricing, photos, signupOpen, embed }: { quote: Quote; pricing: PricingConfig; photos: { sent: number; failed: number }; signupOpen: boolean; embed: boolean }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([`LENDHOUS: LOAN QUOTE REQUEST\n\n${quoteSummary(quote)}\n\nNot a loan application, offer or approval.`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "LendHous-Quote-Request.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // In the widget, LendHous's own pages open in a new tab rather than inside someone else's site.
  const away = embed ? { target: "_blank" } : {};
  const remember = () => { try { sessionStorage.setItem(SIGNUP_PREFILL, JSON.stringify({ name: `${quote.borrower.firstName} ${quote.borrower.lastName}`.trim(), email: quote.borrower.email, phone: quote.borrower.phone })); } catch {} };
  return (
    <Arrive className="panel sent-panel">
      <div aria-live="polite" data-testid="quote-sent">
        <div className="eyebrow">SAVED AND SENT TO LENDHOUS</div>
        <h3>Thanks, {quote.borrower.firstName}. A loan officer has your deal.</h3>
        <TermsCard deal={quote} pricing={pricing} />
        {(photos.sent > 0 || photos.failed > 0) && <p className="quote-small" data-testid="quote-photos-sent">{photos.sent ? `${photos.sent} photo${photos.sent === 1 ? "" : "s"} of the property sent.` : ""}{photos.failed ? ` ${photos.failed} didn't go through; send ${photos.failed === 1 ? "it" : "them"} to your loan officer.` : ""}</p>}
        {signupOpen && quote.submitter === "borrower" && <p className="quote-small" data-testid="quote-signup">Want to move faster? <Link className="text-link" href="/login/signup" data-testid="quote-signup-link" onClick={remember} {...away}>Create your LendHous account</Link> and your application starts with this property and these numbers filled in.</p>}
        <div className="quote-actions">
          <button type="button" className="button" onClick={download}>Download a copy</button>
          <Link href="/programs" className="text-link" {...away}>Compare our loan programs</Link>
        </div>
      </div>
    </Arrive>
  );
}
