"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { sendQuote } from "@/actions/leads";
import { AddressField, emptyAddress, type AddressValue } from "@/components/AddressField";
import { PropertyPhotoPicker } from "@/components/PropertyPhotoPicker";
import { SIGNUP_PREFILL } from "@/components/signup-form";
import { Arrive, Reveal } from "@/components/motion";
import type { PricingConfig } from "@/lib/pricing-config";
import { CITIZENSHIP_LABEL, CREDIT_LABEL, EXITS, EXPERIENCE_LABEL, indicativeTerms, LOAN_TYPES, PRICED, PROPERTY_TYPES, PURPOSES, quoteProblem, quoteSummary, type LoanType, type Quote } from "@/lib/quote";

type Draft = {
  submitter: "borrower" | "broker"; broker: { name: string; company: string; email: string; phone: string };
  borrower: { firstName: string; lastName: string; email: string; phone: string };
  citizenship: string; creditBand: string; experience: string; address: AddressValue; propertyType: string; beds: string; baths: string; sqft: string;
  loanType: LoanType; purpose: string; purchasePrice: string; rehab: string; arv: string; requestedAmount: string; monthlyRent: string; fundingDate: string;
  comps: { address: string; price: string; soldOn: string }[]; exit: string; notes: string;
};
const blank = (): Draft => ({ submitter: "borrower", broker: { name: "", company: "", email: "", phone: "" }, borrower: { firstName: "", lastName: "", email: "", phone: "" }, citizenship: "", creditBand: "", experience: "", address: emptyAddress(), propertyType: "sfr", beds: "", baths: "", sqft: "", loanType: "fix_flip", purpose: "purchase", purchasePrice: "", rehab: "", arv: "", requestedAmount: "", monthlyRent: "", fundingDate: "", comps: [], exit: "sell", notes: "" });
const num = (text: string) => { const value = Number(text.replace(/[^0-9.]/g, "")); return text.trim() === "" || !Number.isFinite(value) ? undefined : value; };
const dollars = (text: string) => { const value = num(text); return value === undefined ? "" : value.toLocaleString("en-US"); };
const usd = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/** The draft as the request the server checks. */
function toQuote(draft: Draft): unknown {
  return {
    submitter: draft.submitter, broker: draft.submitter === "broker" ? draft.broker : undefined, borrower: draft.borrower,
    citizenship: draft.citizenship, creditBand: draft.creditBand, experience: draft.experience, address: draft.address, propertyType: draft.propertyType,
    beds: num(draft.beds), baths: num(draft.baths), sqft: num(draft.sqft), loanType: draft.loanType, purpose: draft.purpose,
    purchasePrice: num(draft.purchasePrice) ?? 0, rehab: num(draft.rehab) ?? 0, arv: num(draft.arv), requestedAmount: num(draft.requestedAmount), monthlyRent: num(draft.monthlyRent),
    fundingDate: draft.fundingDate, comps: draft.comps.filter((comp) => comp.address.trim()).map((comp) => ({ address: comp.address, price: num(comp.price) ?? 0, soldOn: comp.soldOn })), exit: draft.exit, notes: draft.notes,
  };
}

/**
 * The loan quote request: a borrower or a broker sends the deal, the team gets everything a first call needs, and the
 * visitor sees indicative terms from today's pricing straight away.
 */
export function QuoteRequest({ pricing, signupOpen = false, referral }: { pricing: PricingConfig; signupOpen?: boolean; referral?: { code: string; name: string } }) {
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState("");
  const [sending, setSending] = useState<false | "quote" | string>(false);
  const [sent, setSent] = useState<Quote | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoResult, setPhotoResult] = useState({ sent: 0, failed: 0 });
  const [honeypot, setHoneypot] = useState("");
  const put = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const rehabLoan = draft.loanType === "fix_flip" || draft.loanType === "ground_up";
  const rental = draft.loanType.startsWith("dscr") || draft.loanType === "second";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const checked = quoteProblem(toQuote(draft));
    if ("error" in checked) return setError(checked.error);
    setSending("quote");
    const reply: { sent: boolean; error: string; photoKey?: string } = await sendQuote(checked.quote, honeypot, referral?.code).catch(() => ({ sent: false, error: "We couldn't send this just now. Please try again in a few minutes." }));
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

  if (sent) return <QuoteSent quote={sent} pricing={pricing} photos={photoResult} signupOpen={signupOpen} />;

  const text = (label: string, value: string, set: (value: string) => void, extra: { type?: string; testid?: string; auto?: string; required?: boolean; max?: number; placeholder?: string } = {}) => (
    <label>{label}{extra.required === false ? "" : " *"}<input type={extra.type ?? "text"} data-testid={extra.testid} autoComplete={extra.auto} required={extra.required !== false} maxLength={extra.max ?? 120} placeholder={extra.placeholder} value={value} onChange={(event) => set(event.target.value)} /></label>
  );
  const money = (label: string, key: "purchasePrice" | "rehab" | "arv" | "requestedAmount" | "monthlyRent", required = true, hint?: string) => (
    <label>{label}{required ? " *" : ""}<input inputMode="numeric" data-testid={`quote-${key}`} required={required} placeholder="$0" value={draft[key]} onChange={(event) => put({ [key]: dollars(event.target.value) })} />{hint && <small className="quote-hint">{hint}</small>}</label>
  );
  const select = <K extends string>(label: string, value: string, options: Record<K, string>, set: (value: K) => void, testid: string) => (
    <label>{label} *<select data-testid={testid} required value={value} onChange={(event) => set(event.target.value as K)}><option value="" disabled>Select</option>{(Object.entries(options) as [K, string][]).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
  );

  return (
    <form className="quote-form" onSubmit={submit} data-testid="quote-form" noValidate>
      {referral && <p className="panel quote-small" data-testid="quote-referral">Referred by <b>{referral.name}</b>. They&apos;ll be kept up to date on this request.</p>}
      <section className="panel">
        <div className="quote-step-title">Who&apos;s sending this?</div>
        <div className="quote-choices" role="radiogroup">
          {(["borrower", "broker"] as const).map((who) => (
            <button key={who} type="button" role="radio" aria-checked={draft.submitter === who} data-testid={`quote-${who}`} className={`quote-choice ${draft.submitter === who ? "on" : ""}`} onClick={() => put({ submitter: who })}>
              <b>{who === "borrower" ? "I'm the borrower" : "I'm a loan broker"}</b>
              <span>{who === "borrower" ? "Applying for myself or my own LLC." : "Sending a client's deal on their behalf."}</span>
            </button>
          ))}
        </div>
      </section>

      <Reveal open={draft.submitter === "broker"}>
        <section className="panel">
          <div className="quote-step-title"><i>B</i> Your details</div>
          <div className="fields">
            {text("Your name", draft.broker.name, (name) => put({ broker: { ...draft.broker, name } }), { testid: "broker-name", auto: "name", required: draft.submitter === "broker" })}
            {text("Company", draft.broker.company, (company) => put({ broker: { ...draft.broker, company } }), { required: false, auto: "organization" })}
            {text("Your email", draft.broker.email, (email) => put({ broker: { ...draft.broker, email } }), { type: "email", testid: "broker-email", auto: "email", required: draft.submitter === "broker", max: 200 })}
            {text("Your phone", draft.broker.phone, (phone) => put({ broker: { ...draft.broker, phone } }), { type: "tel", testid: "broker-phone", auto: "tel", required: draft.submitter === "broker", max: 40 })}
          </div>
        </section>
      </Reveal>

      <section className="panel">
        <div className="quote-step-title"><i>1</i> {draft.submitter === "broker" ? "The borrower" : "Your information"}</div>
        {draft.submitter === "broker" && <p className="quote-small">They&apos;re added as a guarantor, and their name goes on the quote and the application.</p>}
        <div className="fields">
          {text("First name", draft.borrower.firstName, (firstName) => put({ borrower: { ...draft.borrower, firstName } }), { testid: "quote-first", auto: draft.submitter === "borrower" ? "given-name" : "off" })}
          {text("Last name", draft.borrower.lastName, (lastName) => put({ borrower: { ...draft.borrower, lastName } }), { testid: "quote-last", auto: draft.submitter === "borrower" ? "family-name" : "off" })}
          {text("Email", draft.borrower.email, (email) => put({ borrower: { ...draft.borrower, email } }), { type: "email", testid: "quote-email", auto: draft.submitter === "borrower" ? "email" : "off", max: 200 })}
          {text("Phone", draft.borrower.phone, (phone) => put({ borrower: { ...draft.borrower, phone } }), { type: "tel", testid: "quote-phone", auto: draft.submitter === "borrower" ? "tel" : "off", required: draft.submitter === "borrower", max: 40 })}
          {select(draft.submitter === "broker" ? "Is the borrower a U.S. citizen?" : "Citizenship", draft.citizenship, CITIZENSHIP_LABEL, (citizenship) => put({ citizenship }), "quote-citizen")}
          {select("Credit score (estimate)", draft.creditBand, CREDIT_LABEL, (creditBand) => put({ creditBand }), "quote-credit")}
          {select("Projects finished in the last 3 years", draft.experience, EXPERIENCE_LABEL, (experience) => put({ experience }), "quote-experience")}
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>2</i> The property</div>
        <AddressField variant="site" testid="quote-address" value={draft.address} onChange={(address) => put({ address })} />
        <div style={{ marginTop: 20 }}><PropertyPhotoPicker onChange={setPhotos} testid="quote-photos" /></div>
        <div className="fields" style={{ marginTop: 20 }}>
          {select("Property type", draft.propertyType, PROPERTY_TYPES, (propertyType) => put({ propertyType }), "quote-type")}
          {text("Bedrooms", draft.beds, (beds) => put({ beds: beds.replace(/[^0-9]/g, "") }), { required: false, max: 3 })}
          {text("Bathrooms", draft.baths, (baths) => put({ baths: baths.replace(/[^0-9.]/g, "") }), { required: false, max: 4 })}
          {text("Square footage", draft.sqft, (sqft) => put({ sqft: dollars(sqft) }), { required: false, max: 9 })}
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>3</i> The loan</div>
        <div className="quote-chips" role="radiogroup" aria-label="Type of loan">
          {(Object.entries(LOAN_TYPES) as [LoanType, string][]).map(([key, name]) => <button key={key} type="button" role="radio" aria-checked={draft.loanType === key} data-testid={`quote-loan-${key}`} className={`quote-chip ${draft.loanType === key ? "on" : ""}`} onClick={() => put({ loanType: key })}>{name}</button>)}
        </div>
        <div className="fields" style={{ marginTop: 20 }}>
          {select("Purpose", draft.purpose, PURPOSES, (purpose) => put({ purpose }), "quote-purpose")}
          {select("Exit strategy", draft.exit, EXITS, (exit) => put({ exit }), "quote-exit")}
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>4</i> The numbers</div>
        <div className="fields">
          {money(draft.purpose === "purchase" ? "Purchase price" : "Current value", "purchasePrice")}
          {rehabLoan && money(draft.loanType === "ground_up" ? "Construction budget" : "Renovation budget", "rehab")}
          {rehabLoan && money("After-repair value (ARV)", "arv", true, "What it sells for once the work is done. Add comps below to support it.")}
          {rental && money("Monthly rent (lease or market)", "monthlyRent")}
          {money("Loan amount you'd like", "requestedAmount", false, "Leave blank for the most it qualifies for.")}
          {text("Funding date you'd like", draft.fundingDate, (fundingDate) => put({ fundingDate }), { type: "date", testid: "quote-date" })}
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
        <label style={{ marginTop: 20 }}>Anything else we should know<textarea rows={3} maxLength={1500} value={draft.notes} placeholder="Timeline, scope, questions." onChange={(event) => put({ notes: event.target.value })} /></label>
      </section>

      <label className="hp" aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} /></label>
      {error && <Arrive className="form-error"><span role="alert" data-testid="quote-error">{error}</span></Arrive>}
      <p className="quote-small">This isn&apos;t an application and doesn&apos;t pull credit. Don&apos;t enter a Social Security number or account details here.</p>
      <button className="button quote-submit" type="submit" data-testid="quote-submit" disabled={Boolean(sending)}>{sending === "quote" ? "Sending…" : sending ? sending : "Get my quote →"}</button>
    </form>
  );
}

/** After sending: indicative terms on today's pricing, and a copy to keep. */
function QuoteSent({ quote, pricing, photos, signupOpen }: { quote: Quote; pricing: PricingConfig; photos: { sent: number; failed: number }; signupOpen: boolean }) {
  const terms = indicativeTerms(quote, pricing);
  const download = () => {
    const url = URL.createObjectURL(new Blob([`LENDHOUS: LOAN QUOTE REQUEST\n\n${quoteSummary(quote)}\n\nNot a loan application, offer or approval.`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "LendHous-Quote-Request.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Arrive className="panel sent-panel">
      <div aria-live="polite" data-testid="quote-sent">
        <div className="eyebrow">SENT TO LENDHOUS</div>
        <h3>Thanks, {quote.borrower.firstName}. A loan officer has your deal.</h3>
        {terms && terms.eligible ? (
          <div className="quote-terms" data-testid="quote-terms">
            <p>Based on what you entered, a {LOAN_TYPES[quote.loanType].toLowerCase()} loan on this property could look like:</p>
            <dl>
              <div><dt>Loan amount</dt><dd data-testid="quote-amount">up to {usd(terms.noteAmount)}</dd></div>
              <div><dt>Rate</dt><dd>about {terms.rate.toFixed(2)}%</dd></div>
              <div><dt>Points</dt><dd>{terms.pointsPct}</dd></div>
              <div><dt>Term</dt><dd>{PRICED[quote.loanType] === "dscr" ? "30 years" : `${terms.termMonths} months`}</dd></div>
              <div><dt>Monthly payment</dt><dd>about {usd(terms.monthlyPayment)}</dd></div>
              <div><dt>Cash to close</dt><dd>about {usd(terms.cashToClose)}</dd></div>
            </dl>
            {terms.ratios.length > 0 && <p className="quote-small">{terms.ratios.map((ratio) => `${ratio.label} ${(ratio.key === "dscr" ? ratio.actual.toFixed(2) + "x" : `${(ratio.actual * 100).toFixed(1)}%`)}`).join(" · ")}. {PRICED[quote.loanType] === "dscr" ? "Assumes taxes and insurance of about 3% of the value a year." : ""}</p>}
          </div>
        ) : terms ? (
          <p data-testid="quote-review">This one needs a closer look before we can put numbers on it: {terms.hardStops[0] ?? "a ratio is outside our limits"}. A loan officer will call you about it.</p>
        ) : (
          <p data-testid="quote-review">A loan officer prices {LOAN_TYPES[quote.loanType].toLowerCase()} loans by hand and will be in touch shortly.</p>
        )}
        {(photos.sent > 0 || photos.failed > 0) && <p className="quote-small" data-testid="quote-photos-sent">{photos.sent ? `${photos.sent} photo${photos.sent === 1 ? "" : "s"} of the property sent.` : ""}{photos.failed ? ` ${photos.failed} didn't go through; send ${photos.failed === 1 ? "it" : "them"} to your loan officer.` : ""}</p>}
        {signupOpen && quote.submitter === "borrower" && <p className="quote-small" data-testid="quote-signup">Want to follow it and send documents yourself? <Link className="text-link" href="/login/signup" data-testid="quote-signup-link" onClick={() => { try { sessionStorage.setItem(SIGNUP_PREFILL, JSON.stringify({ name: `${quote.borrower.firstName} ${quote.borrower.lastName}`.trim(), email: quote.borrower.email, phone: quote.borrower.phone })); } catch {} }}>Create your LendHous account</Link>.</p>}
        <p className="quote-small">An estimate from what you entered, not an offer or a commitment to lend. Final terms depend on underwriting, the appraisal, title and credit. Business-purpose loans only.</p>
        <div className="quote-actions">
          <button type="button" className="button" onClick={download}>Download a copy</button>
          <Link href="/programs" className="text-link">Compare our loan programs</Link>
        </div>
      </div>
    </Arrive>
  );
}
