"use client";
import { motion } from "framer-motion";
import { Check, Lock, MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveApplicationDraft, signApplication } from "@/actions/application-links";
import { AddressField, type AddressValue } from "@/components/AddressField";
import EstimatePanel from "@/components/EstimatePanel";
import { PropertyPhotoPicker } from "@/components/PropertyPhotoPicker";
import { Logo } from "@/components/logo";
import { Arrive, Reveal, StepSwap } from "@/components/motion";
import { TrackRecordFields } from "@/components/SponsorForm";
import { blankGuarantor, CONSENTS, num, signProblems, stepProblems, STEPS, toLoan, type AppDraft, type ConsentKey, type GuarantorInfo } from "@/lib/borrower-application";
import { CITIZENSHIP, DECLARATIONS, needsList, withSponsor } from "@/lib/credit";
import { evaluate } from "@/lib/engine";
import { LOAN_TYPES, type LoanType } from "@/lib/quote";
import type { RepeatRecord } from "@/lib/repeat-borrower";
import { servicingDate } from "@/lib/servicing";

/** A signed-in borrower applying from their portal: how it saves (not at all for a demo account) and sends. */
export type PortalMode = {
  save?: (draft: AppDraft, step: number) => Promise<{ savedAt?: string; error?: string }>;
  submit: (draft: AppDraft, consents: Record<ConsentKey, boolean>, signature: string) => Promise<{ error?: string; dealId?: string }>;
  onDone: (dealId?: string) => void;
  /** A repeat borrower's loans paid as agreed, which the estimate prices on as the server will. */
  repeat?: RepeatRecord;
};
type Props = { token: string | null; initial: AppDraft; startStep: number; savedAt: string | null; officer: string; expiresAt: string ; photos?: { id: string; name: string; src: string }[]; portal?: PortalMode };

const money = (text: string) => { const value = num(text); return value === undefined ? "" : value.toLocaleString("en-US"); };
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const ssnShown = (text: string) => { const d = text.replace(/\D/g, "").slice(0, 9); return d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d; };

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`block min-w-0 ${wide ? "sm:col-span-2" : ""}`}><span className="label">{label}</span>{children}</label>;
}
function Pills<T extends string | boolean>({ value, options, onChange, testid }: { value: T | null | ""; options: { v: T; l: string }[]; onChange: (value: T) => void; testid?: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((option) => {
        const on = value === option.v;
        return <button key={String(option.v)} type="button" role="radio" aria-checked={on} data-testid={testid ? `${testid}-${String(option.v)}` : undefined} onClick={() => onChange(option.v)} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors ${on ? "border-primary bg-active font-medium text-foreground" : "border-rule text-muted-foreground hover:border-faint"}`}><span className={`grid size-3.5 place-items-center rounded-full border ${on ? "border-primary bg-primary" : "border-rule"}`}>{on && <span className="size-1.5 rounded-full bg-primary-foreground" />}</span>{option.l}</button>;
      })}
    </div>
  );
}
const yesNo = [{ v: true, l: "Yes" }, { v: false, l: "No" }];

/**
 * The borrower application: five steps, saved as the borrower goes, then four consents and a typed signature. Behind a
 * secure link (no sign-in) it's for the loan officer who sent it; in the portal it's the borrower's own, with a live
 * estimate. With neither it's a preview that keeps everything in the browser.
 */
export function BorrowerApplication({ token, initial, startStep, savedAt, officer, expiresAt, photos = [], portal }: Props) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(startStep);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(savedAt ? `Resumed where you left off · saved ${clock(savedAt)}` : "");
  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>({ application: false, credit: false, release: false, esign: false });
  const [signature, setSignature] = useState("");
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const today = servicingDate(new Date());
  const first = useRef(true);
  // In the portal, the estimate the loan will be priced on, as the numbers go in.
  const inPortal = Boolean(portal);
  const estimate = useMemo(() => {
    if (!inPortal || !num(draft.loan.purchasePrice)) return null;
    const loan = toLoan(draft);
    // A rental loan is sized on its rent, so there's nothing to estimate until the rent is in.
    if (loan.app.product === "dscr" && !num(draft.loan.monthlyRent)) return null;
    const scored = { ...(draft.guarantors.some((g) => num(g.fico)) ? withSponsor(loan.app, loan.sponsor, new Date()) : { ...loan.app, fico: 700 }), ...(portal?.repeat ? { repeat: portal.repeat } : {}) };
    return { e: evaluate(scored), product: loan.app.product, assumed: !draft.guarantors.some((g) => num(g.fico)), fico: scored.fico, deals: scored.verifiedDeals, needs: needsList(scored, loan.sponsor) };
  }, [draft, inPortal, portal?.repeat]);

  // Saves a moment after each change, so closing the page loses at most the last few keystrokes.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const save = portal ? portal.save : token ? (next: AppDraft, at: number) => saveApplicationDraft(token, next, at) : undefined;
    if (!save) { setSaved(portal ? "Sample account: this stays in your browser" : "Preview: nothing is saved"); return; }
    setSaved("Saving…");
    const timer = setTimeout(async () => {
      const reply = await save(draft, step).catch(() => ({ error: "Couldn't save. Check your connection." }));
      setSaved("savedAt" in reply && reply.savedAt ? `Saved ${clock(reply.savedAt)}` : reply.error ?? "");
    }, 900);
    return () => clearTimeout(timer);
  }, [draft, step, token]);

  const go = (to: number) => {
    if (to > step) {
      const found = stepProblems(draft, step, today);
      setProblems(found);
      if (found.length) return;
    } else setProblems([]);
    setDirection(to > step ? 1 : -1);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const put = (changes: Partial<AppDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const putGuarantor = (index: number, changes: Partial<GuarantorInfo>) => setDraft((current) => ({ ...current, guarantors: current.guarantors.map((item, at) => (at === index ? { ...item, ...changes } : item)) }));
  const sign = async () => {
    const found = signProblems(draft, today);
    setProblems(found);
    if (found.length) return;
    if (!token && !portal) { setDone(true); return; }
    setSigning(true);
    const sent: Promise<{ error?: string; dealId?: string }> = portal ? portal.submit(draft, consents, signature) : signApplication(token!, draft, consents, signature);
    const reply = await sent.catch(() => ({ error: "That didn't go through. Check your connection and try again.", dealId: undefined }));
    setSigning(false);
    if (reply.error) return setProblems([reply.error]);
    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    portal?.onDone(reply.dealId);
  };

  const address = draft.property.address;
  const rehab = draft.loanType === "fix_flip" || draft.loanType === "ground_up";
  const rental = draft.loanType.startsWith("dscr") || draft.loanType === "second";
  const input = (value: string, onChange: (value: string) => void, extra: { type?: string; testid?: string; auto?: string; mode?: "numeric" | "decimal" | "tel" | "email"; placeholder?: string; max?: number } = {}) => (
    <input className="desk-input" type={extra.type ?? "text"} data-testid={extra.testid} autoComplete={extra.auto ?? "off"} inputMode={extra.mode} placeholder={extra.placeholder} maxLength={extra.max ?? 160} value={value} onChange={(event) => onChange(event.target.value)} />
  );
  const loanMoney = (label: string, key: keyof AppDraft["loan"], hint?: string) => (
    <Field label={label}>{input(draft.loan[key] as string, (value) => put({ loan: { ...draft.loan, [key]: money(value) } }), { mode: "numeric", testid: `app-${key}`, placeholder: "$0" })}{hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}</Field>
  );

  const page = (
      <>
        <section className="glass p-5">
          <h1 className="text-2xl font-normal tracking-tight">{done ? "Your application is signed" : portal ? "Apply for a loan" : "Complete your loan application"}</h1>
          {!done && portal && <p className="mt-1 text-sm text-muted-foreground"><span className="max-sm:hidden">Tell us about you, the property and the loan, then review it and sign. </span><b className="text-foreground">Your progress saves automatically</b>: close this page and pick up where you left off any time.</p>}
          {!done && !portal && <p className="mt-1 text-sm text-muted-foreground">Your loan officer <b className="text-foreground">{officer}</b> has asked for the details below to finish your application. <b className="text-foreground">Your progress saves automatically</b>: close this page and come back any time until {longDay(expiresAt)}.</p>}
          {address.street && <p className="mt-3 inline-flex items-center gap-1.5 rounded-[2px] bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground"><MapPin size={12} aria-hidden="true" /> {[address.street, address.city, address.state, address.zip].filter(Boolean).join(", ")}</p>}
          {/* Where they are in the five steps, in the same card, so the first question shows sooner. */}
          {!done && <div className="mt-4 border-t border-border pt-3">
              <div className="flex items-center justify-between text-[11px] font-medium tracking-wider uppercase"><span className="text-muted-foreground">{STEPS[step]}</span><span className="text-link" data-testid="app-step">Step {step + 1} of {STEPS.length}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-link" initial={false} animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} /></div>
            </div>}
        </section>

        {done ? (
          <Arrive className="glass space-y-3 p-6" >
            <div data-testid="application-signed">
              <span className="grid size-10 place-items-center rounded-full bg-good/10 text-good"><Check aria-hidden="true" /></span>
              <h2 className="mt-3 text-xl font-normal">Thank you{draft.contact.firstName ? `, ${draft.contact.firstName}` : ""}. {portal ? "LendHous" : officer} has your application.</h2>
              <p className="mt-2 text-sm text-muted-foreground">Next, your loan officer reviews it and lists the documents they need. {portal ? "Taking you to your loan, where you'll see them and can add photos of the property." : token ? "We've emailed you an invitation to the LendHous portal, where you can upload them and follow the loan." : "(Preview: nothing was sent.)"}</p>
            </div>
          </Arrive>
        ) : (
          <>


            <StepSwap step={step} direction={direction} className="glass space-y-5 p-5">
              {step === 0 && (<>
                <h2 className="text-lg font-normal">About you</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First name">{input(draft.contact.firstName, (firstName) => put({ contact: { ...draft.contact, firstName } }), { testid: "app-first", auto: "given-name" })}</Field>
                  <Field label="Last name">{input(draft.contact.lastName, (lastName) => put({ contact: { ...draft.contact, lastName } }), { testid: "app-last", auto: "family-name" })}</Field>
                  <Field label="Email">{input(draft.contact.email, (email) => put({ contact: { ...draft.contact, email } }), { type: "email", testid: "app-email", auto: "email", mode: "email" })}</Field>
                  <Field label="Phone">{input(draft.contact.phone, (phone) => put({ contact: { ...draft.contact, phone } }), { type: "tel", testid: "app-phone", auto: "tel", mode: "tel", max: 40 })}</Field>
                </div>
                {!portal && <div><span className="label">Who you&apos;ve been working with</span><p className="desk-input flex items-center bg-muted/50 text-sm text-muted-foreground">{officer}</p><span className="mt-1 block text-[11px] text-faint">Set by your loan officer.</span></div>}
                <div><span className="label">What kind of loan do you need?</span><Pills value={draft.loanType} testid="app-loan" onChange={(loanType: LoanType) => put({ loanType })} options={(Object.entries(LOAN_TYPES) as [LoanType, string][]).map(([v, l]) => ({ v, l }))} /></div>
              </>)}

              {step === 1 && (<>
                <h2 className="text-lg font-normal">The property</h2>
                <AddressField testid="app-address" value={address} onChange={(next: AddressValue) => put({ property: { ...draft.property, address: next } })} />
                <div>
                  <span className="label">Photos of the property</span>
                  {portal ? <p className="text-sm text-muted-foreground" data-testid="app-photos-later">Once you&apos;ve sent this, add photos of the property from your loan page.</p> : token ? (
                    <PropertyPhotoPicker testid="app-photos" initial={photos}
                      upload={async (file) => { const form = new FormData(); form.set("file", file); const response = await fetch(`/api/application-links/${token}/photos`, { method: "POST", body: form }); const body = await response.json().catch(() => ({})); return response.ok ? { id: body.photo?.id } : { error: body.error ?? "That photo didn't go through." }; }}
                      remove={async (id) => (await fetch(`/api/application-links/${token}/photos/${id}`, { method: "DELETE" })).ok}
                      note="Optional, up to 12: the front, the street, and the rooms or areas that need work. Each is sent as you add it." />
                  ) : <PropertyPhotoPicker testid="app-photos" note="In this preview the photos stay in your browser." />}
                </div>
                <div><span className="label">Is the property in a flood zone?</span><Pills value={draft.property.floodZone} testid="app-flood" onChange={(floodZone) => put({ property: { ...draft.property, floodZone } })} options={[{ v: "yes" as const, l: "Yes" }, { v: "no" as const, l: "No" }, { v: "unsure" as const, l: "I'm not sure" }]} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Property type"><select className="desk-input" data-testid="app-type" value={draft.property.propertyType} onChange={(event) => put({ property: { ...draft.property, propertyType: event.target.value as AppDraft["property"]["propertyType"] } })}><option value="">Select</option><option value="sfr">Single-family home</option><option value="2_4">2–4 units</option><option value="condo">Condo</option><option value="townhome">Townhome</option></select></Field>
                  <Field label="Right now it's"><select className="desk-input" data-testid="app-occupancy" value={draft.property.occupancy} onChange={(event) => put({ property: { ...draft.property, occupancy: event.target.value as AppDraft["property"]["occupancy"] } })}><option value="">Select</option><option value="vacant">Vacant</option><option value="tenant">Rented to a tenant</option></select></Field>
                  <Field label="Bedrooms">{input(draft.property.beds, (beds) => put({ property: { ...draft.property, beds: beds.replace(/\D/g, "") } }), { mode: "numeric", max: 3 })}</Field>
                  <Field label="Bathrooms">{input(draft.property.baths, (baths) => put({ property: { ...draft.property, baths: baths.replace(/[^0-9.]/g, "") } }), { mode: "decimal", max: 4 })}</Field>
                  <Field label="Square footage">{input(draft.property.sqft, (sqft) => put({ property: { ...draft.property, sqft: money(sqft) } }), { mode: "numeric", max: 9 })}</Field>
                  <Field label="Lot size in acres (if over 1 acre)">{input(draft.property.lotAcres, (lotAcres) => put({ property: { ...draft.property, lotAcres: lotAcres.replace(/[^0-9.]/g, "") } }), { mode: "decimal", max: 8 })}</Field>
                </div>
              </>)}

              {step === 2 && (<>
                <h2 className="text-lg font-normal">The loan</h2>
                <div><span className="label">Purpose</span><Pills value={draft.loan.purpose} testid="app-purpose" onChange={(purpose) => put({ loan: { ...draft.loan, purpose } })} options={[{ v: "purchase" as const, l: "Purchase" }, { v: "refinance" as const, l: "Refinance" }, { v: "cash_out" as const, l: "Cash-out refinance" }]} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {loanMoney(draft.loan.purpose === "purchase" ? "Purchase price" : "What you paid for it", "purchasePrice")}
                  {draft.loan.purpose !== "purchase" && loanMoney("What it's worth today", "asIsValue")}
                  {rehab && loanMoney(draft.loanType === "ground_up" ? "Construction budget" : "Renovation budget", "rehab")}
                  {rehab && loanMoney("After-repair value (ARV)", "arv", "What it sells for once the work is done.")}
                  {rental && <>{loanMoney("Monthly rent", "monthlyRent")}{loanMoney("Property taxes a year", "taxesAnnual")}{loanMoney("Insurance a year", "insuranceAnnual")}</>}
                  {loanMoney("Loan amount you'd like", "requestedAmount", "Leave blank for the most it qualifies for.")}
                  {loanMoney("Cash you can show on bank statements", "liquidity", "For closing costs and reserves.")}
                  <Field label="Closing date you'd like">{input(draft.loan.closeDate, (closeDate) => put({ loan: { ...draft.loan, closeDate } }), { type: "date", testid: "app-close" })}</Field>
                </div>
                <Field label="Your plan for the project"><textarea className="desk-input h-auto! min-h-20 py-2" data-testid="app-plan" maxLength={1500} value={draft.loan.plan} onChange={(event) => put({ loan: { ...draft.loan, plan: event.target.value } })} placeholder="What you'll do, how long it takes, and who's doing the work." /></Field>
                <div><span className="label">Exit strategy</span><Pills value={draft.loan.exit} testid="app-exit" onChange={(exit) => put({ loan: { ...draft.loan, exit } })} options={[{ v: "sell" as const, l: "Sell" }, { v: "refinance" as const, l: "Refinance" }, { v: "hold" as const, l: "Hold as a rental" }, { v: "cash" as const, l: "Pay off in cash" }]} /></div>
              </>)}

              {step === 3 && (<>
                <h2 className="text-lg font-normal">Vesting and guarantors</h2>
                <div><span className="label">Are you buying in (or is the property owned by) an LLC?</span><Pills value={draft.vesting.hasLlc} testid="app-llc" onChange={(hasLlc: boolean) => put({ vesting: { ...draft.vesting, hasLlc } })} options={yesNo} /></div>
                <Reveal open={draft.vesting.hasLlc === true}>
                  <div className="space-y-3 pt-1">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Name of the LLC">{input(draft.vesting.entityName, (entityName) => put({ vesting: { ...draft.vesting, entityName } }), { testid: "app-llc-name", auto: "organization" })}</Field>
                      <Field label="State it's registered in">{input(draft.vesting.entityState, (entityState) => put({ vesting: { ...draft.vesting, entityState: entityState.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) } }), { testid: "app-llc-state", max: 2 })}</Field>
                      <Field label="EIN (if it has one)">{input(draft.vesting.ein, (ein) => put({ vesting: { ...draft.vesting, ein: ein.replace(/[^0-9-]/g, "").slice(0, 10) } }), { testid: "app-ein", mode: "numeric", placeholder: "12-3456789" })}</Field>
                    </div>
                    <AddressField testid="app-llc-address" label="LLC's registered address" value={draft.vesting.address} onChange={(next) => put({ vesting: { ...draft.vesting, address: next } })} />
                  </div>
                </Reveal>
                <Reveal open={draft.vesting.hasLlc === false}><p className="rounded-[2px] bg-warn/10 p-3 text-sm">LendHous lends to LLCs and other entities. You can apply now; you&apos;ll need to form one before closing, and your loan officer can help.</p></Reveal>

                <div><span className="label">How many guarantors?</span><Pills value={String(draft.guarantors.length)} testid="app-guarantors" onChange={(count) => put({ guarantors: Array.from({ length: Number(count) }, (_, index) => draft.guarantors[index] ?? blankGuarantor()) })} options={["1", "2", "3", "4"].map((v) => ({ v, l: v }))} /><span className="mt-1 block text-[11px] text-faint">Everyone who owns more than 20% of the LLC guarantees the loan.</span></div>
                {draft.guarantors.map((g, index) => (
                  <Arrive key={index} className="space-y-4 rounded-[2px] border border-border p-4">
                    <p className="text-[11px] font-medium tracking-wider text-link uppercase">Guarantor {index + 1}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="First name">{input(g.firstName, (firstName) => putGuarantor(index, { firstName }), { testid: `g${index}-first` })}</Field>
                      <Field label="Last name">{input(g.lastName, (lastName) => putGuarantor(index, { lastName }), { testid: `g${index}-last` })}</Field>
                      <Field label="Email">{input(g.email, (email) => putGuarantor(index, { email }), { type: "email", testid: `g${index}-email`, mode: "email" })}</Field>
                      <Field label="Phone">{input(g.phone, (phone) => putGuarantor(index, { phone }), { type: "tel", testid: `g${index}-phone`, mode: "tel", max: 40 })}</Field>
                      <Field label="Date of birth">{input(g.dob, (dob) => putGuarantor(index, { dob }), { type: "date", testid: `g${index}-dob` })}</Field>
                      <Field label="Estimated credit score">{input(g.fico, (fico) => putGuarantor(index, { fico: fico.replace(/\D/g, "").slice(0, 3) }), { testid: `g${index}-fico`, mode: "numeric", max: 3 })}</Field>
                      <Field label="Social Security number" wide>{input(ssnShown(g.ssn), (ssn) => putGuarantor(index, { ssn: ssn.replace(/\D/g, "").slice(0, 9) }), { testid: `g${index}-ssn`, mode: "numeric", placeholder: "XXX-XX-XXXX", max: 11 })}<span className="mt-1 flex items-center gap-1 text-[11px] text-faint"><Lock size={11} aria-hidden="true" /> Encrypted as soon as it&apos;s saved. Only used for this application.</span></Field>
                    </div>
                    <AddressField testid={`g${index}-home`} label="Home address" value={g.home} onChange={(home) => putGuarantor(index, { home })} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div><span className="label">Lived there 2 years or more?</span><Pills value={g.twoYears} testid={`g${index}-two`} onChange={(twoYears: boolean) => putGuarantor(index, { twoYears })} options={yesNo} /></div>
                      <div><span className="label">Mail goes to the home address?</span><Pills value={g.mailingSame} testid={`g${index}-mail`} onChange={(mailingSame: boolean) => putGuarantor(index, { mailingSame })} options={yesNo} /></div>
                      <div><span className="label">Marital status</span><Pills value={g.marital} testid={`g${index}-marital`} onChange={(marital) => putGuarantor(index, { marital })} options={[{ v: "married" as const, l: "Married" }, { v: "unmarried" as const, l: "Not married" }]} /></div>
                      <Field label="Citizenship"><select className="desk-input" data-testid={`g${index}-citizen`} value={g.citizenship} onChange={(event) => putGuarantor(index, { citizenship: event.target.value as GuarantorInfo["citizenship"] })}><option value="">Select</option>{Object.entries(CITIZENSHIP).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                      <Field label="Ownership of the LLC (%)">{input(g.ownershipPct, (ownershipPct) => putGuarantor(index, { ownershipPct: ownershipPct.replace(/[^0-9.]/g, "").slice(0, 5) }), { testid: `g${index}-own`, mode: "decimal", max: 5 })}</Field>
                    </div>
                    <Reveal open={g.mailingSame === false}><AddressField testid={`g${index}-mailing`} label="Mailing address" value={g.mailing} onChange={(mailing) => putGuarantor(index, { mailing })} /></Reveal>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Declarations</p>
                      <p className="text-xs text-muted-foreground">Answer each one truthfully: these are part of your application. A yes doesn&apos;t mean no; it means someone reads your explanation.</p>
                      <ul className="divide-y divide-border rounded-[2px] border border-border">
                        {[...DECLARATIONS.map((item) => ({ key: item.key as string, question: item.question, value: g.answers[item.key], set: (value: boolean) => putGuarantor(index, { answers: { ...g.answers, [item.key]: value } }) })), { key: "occupy", question: "Will you or a family member live in the property?", value: g.occupy ?? undefined, set: (value: boolean) => putGuarantor(index, { occupy: value }) }].map((item) => (
                          <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 p-3"><span className="min-w-0 flex-1 basis-56 text-sm">{item.question}</span><Pills value={item.value ?? null} testid={`g${index}-decl-${item.key}`} onChange={item.set} options={yesNo} /></li>
                        ))}
                      </ul>
                      <Reveal open={g.occupy === true}><p className="rounded-[2px] bg-bad/10 p-3 text-sm text-bad" data-testid="app-owner-occ">LendHous makes business-purpose loans only. For a home you or your family will live in, please talk to a licensed consumer mortgage lender.</p></Reveal>
                      <Reveal open={DECLARATIONS.some((item) => g.answers[item.key]) || g.occupy === true}><Field label="Explain each yes: what happened and where it stands now"><textarea className="desk-input h-auto! min-h-16 py-2" data-testid={`g${index}-explanation`} maxLength={2000} value={g.explanation} onChange={(event) => putGuarantor(index, { explanation: event.target.value })} /></Field></Reveal>
                    </div>
                  </Arrive>
                ))}
                <div className="space-y-2"><p className="text-sm font-medium">Projects finished in the last 3 years</p><TrackRecordFields deals={draft.trackRecord} onChange={(trackRecord) => put({ trackRecord })} /></div>
              </>)}

              {step === 4 && (<>
                <h2 className="text-lg font-normal">Review and sign</h2>
                <p className="text-sm text-muted-foreground">Check what you entered. When it&apos;s right, read and agree to each section below and sign with your full legal name.</p>
                <Review draft={draft} onEdit={(to) => go(to)} />
                {estimate && (
                  <div className="rounded-[2px] border border-border p-3" data-testid="needs-preview">
                    <p className="text-[11px] font-medium tracking-wider text-link uppercase">After you sign, we&apos;ll ask for</p>
                    <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">{estimate.needs.map((item) => <li key={item.id}>· {item.name}</li>)}</ul>
                  </div>
                )}
                {CONSENTS.map((consent) => (
                  <div key={consent.key} className="space-y-2 rounded-[2px] border border-border p-4" data-testid={`consent-${consent.key}`}>
                    <p className="text-[11px] font-medium tracking-wider text-link uppercase">{consent.title}</p>
                    <div className="max-h-40 space-y-2 overflow-y-auto rounded-[2px] border border-border bg-muted/40 p-3 font-serif text-[13px] leading-relaxed" tabIndex={0}>{consent.text.map((line) => <p key={line}>{line}</p>)}</div>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid={`agree-${consent.key}`} checked={consents[consent.key]} onChange={(event) => setConsents({ ...consents, [consent.key]: event.target.checked })} />{consent.agree}</label>
                  </div>
                ))}
                <div className="rounded-[2px] border-2 border-link/40 p-4">
                  <span className="label text-link">Type your full legal name to sign</span>
                  <input className="w-full border-0 border-b border-rule bg-transparent py-2 font-serif text-2xl italic text-foreground outline-none" data-testid="app-signature" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder={`${draft.contact.firstName} ${draft.contact.lastName}`.trim()} autoComplete="off" />
                  <p className="mt-2 text-[11px] text-faint">By typing your name and pressing Sign, you sign all four sections above electronically, with the same effect as a handwritten signature.</p>
                </div>
              </>)}
            </StepSwap>

            {/* While the numbers and guarantors go in. The review step has the signature to keep in view. */}
            {estimate && step >= 2 && step < STEPS.length - 1 && (
              <div data-testid="app-estimate">
                <EstimatePanel e={estimate.e} product={estimate.product} />
                <p className="mt-2 px-1 text-xs text-muted-foreground" data-testid="priced-on">{estimate.assumed ? "Assumes a 700 credit score until you add your guarantors" : `Priced on a ${estimate.fico} credit score, the lowest of your guarantors'`}, and {estimate.deals} past deal{estimate.deals === 1 ? "" : "s"}. An estimate, not an offer.</p>
              </div>
            )}

            <Reveal open={problems.length > 0}>
              <div className="rounded-[2px] border border-bad/30 bg-bad/5 p-3 text-sm" role="alert" data-testid="app-problems"><p className="font-medium text-bad">Before you go on:</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-bad">{problems.slice(0, 8).map((problem) => <li key={problem}>{problem}</li>)}</ul>{problems.length > 8 && <p className="mt-1 text-xs text-bad">and {problems.length - 8} more.</p>}</div>
            </Reveal>

            {/* On a phone, Back and Next stay under the thumb at the foot of the screen. */}
            <div className="flex items-center justify-between gap-3 max-sm:sticky max-sm:bottom-0 max-sm:z-20 max-sm:border-t max-sm:border-rule max-sm:bg-background/95 max-sm:py-3 max-sm:backdrop-blur">
              <motion.button whileTap={{ scale: 0.97 }} type="button" className="btn-ghost rounded-full! px-5!" data-testid="app-back" disabled={step === 0} onClick={() => go(step - 1)}>← Back</motion.button>
              <span className="min-w-0 truncate text-center text-xs text-good" data-testid="app-saved" aria-live="polite">{saved}</span>
              {step < STEPS.length - 1
                ? <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} type="button" className="btn-primary rounded-full! px-6!" data-testid="app-next" onClick={() => go(step + 1)}>Next →</motion.button>
                : <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} type="button" className="btn-primary rounded-full! px-6!" data-testid="app-sign" disabled={signing || !signature.trim() || !Object.values(consents).every(Boolean)} onClick={() => void sign()}>{signing ? "Signing…" : "Sign application"}</motion.button>}
            </div>
          </>
        )}
      </>
  );
  if (portal) return <div className="max-w-3xl space-y-4" data-testid="borrower-application">{page}</div>;
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground"><div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3"><span className="[&_*]:text-primary-foreground!"><Logo /></span><span className="flex items-center gap-1.5 text-xs opacity-80"><Lock size={12} aria-hidden="true" /> Secure borrower application</span></div></header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6" data-testid="borrower-application">{page}</main>
    </div>
  );
}

/** What the borrower entered, by section, with a way back to each one. */
function Review({ draft, onEdit }: { draft: AppDraft; onEdit: (step: number) => void }) {
  const a = draft.property.address;
  const rows: [string, number, [string, string][]][] = [
    ["Contact", 0, [["Name", `${draft.contact.firstName} ${draft.contact.lastName}`], ["Email", draft.contact.email], ["Phone", draft.contact.phone], ["Loan type", LOAN_TYPES[draft.loanType]]]],
    ["Property", 1, [["Address", [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ")], ["Type", draft.property.propertyType], ["Flood zone", draft.property.floodZone], ["Beds / baths / sq ft", [draft.property.beds, draft.property.baths, draft.property.sqft].map((x) => x || "—").join(" / ")]]],
    ["Loan", 2, [["Purpose", draft.loan.purpose], ["Price", draft.loan.purchasePrice && `$${draft.loan.purchasePrice}`], ["Renovation", draft.loan.rehab && `$${draft.loan.rehab}`], ["ARV", draft.loan.arv && `$${draft.loan.arv}`], ["Requested", draft.loan.requestedAmount ? `$${draft.loan.requestedAmount}` : "The most it qualifies for"], ["Close by", draft.loan.closeDate], ["Exit", draft.loan.exit]]],
    ["Vesting & guarantors", 3, [["LLC", draft.vesting.hasLlc ? `${draft.vesting.entityName} (${draft.vesting.entityState})` : "To be formed"], ...draft.guarantors.map((g, index): [string, string] => [`Guarantor ${index + 1}`, `${g.firstName} ${g.lastName}, ${g.ownershipPct || 0}%, score ${g.fico || "—"}, SSN ${g.ssn.length === 9 ? `•••-••-${g.ssn.slice(5)}` : "missing"}`]), ["Past deals", String(draft.trackRecord.length)]]],
  ];
  return (
    <div className="space-y-3" data-testid="app-review">
      {rows.map(([title, step, items]) => (
        <div key={title} className="rounded-[2px] border border-border p-3">
          <div className="flex items-center justify-between"><p className="text-[11px] font-medium tracking-wider text-link uppercase">{title}</p><button type="button" className="text-xs text-link underline" onClick={() => onEdit(step)}>Edit</button></div>
          <dl className="mt-2 divide-y divide-dashed divide-border text-sm">{items.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 py-1"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 text-right wrap-anywhere">{value || "—"}</dd></div>)}</dl>
        </div>
      ))}
    </div>
  );
}
