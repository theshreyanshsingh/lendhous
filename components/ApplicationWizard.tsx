"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { startLoan } from "@/actions/book";
import { DECLARATIONS, needsList, qualifyingFico, withSponsor } from "@/lib/credit";
import { evaluate, type Application, type Product } from "@/lib/engine";
import { currentPricing } from "@/lib/pricing-versions";
import { useStore } from "@/lib/store";
import { motion } from "framer-motion";
import { AddressField } from "@/components/AddressField";
import EstimatePanel from "@/components/EstimatePanel";
import { StepSwap } from "@/components/motion";
import { allAnswered, DeclarationFields, emptyProfile, GuarantorFields, toSponsor, TrackRecordFields } from "@/components/SponsorForm";
import { productLabel } from "@/components/ui";

const steps = ["Loan type", "Property", "Deal numbers", "Loan request", "Borrower & guarantors", "Past deals", "Credit questions", "Review & submit"];
const REVIEW = steps.length - 1;

function Num({ label, value, onChange, hint, testid }: { label: string; value: number | undefined; onChange: (n: number | undefined) => void; hint?: string; testid?: string }) {
  return (
    <label className="block"><span className="label">{label}</span>
      <input data-testid={testid} inputMode="numeric" className="desk-input" value={value === undefined ? "" : value.toLocaleString("en-US")} placeholder="0"
        onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); onChange(v === "" ? undefined : Number(v)); }} />
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}
function Choice<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string; d?: string }[]; onChange: (v: T) => void }) {
  return <div className="grid gap-2 sm:grid-cols-2">{options.map((o) => (
    <button type="button" key={o.v} onClick={() => onChange(o.v)} className={`rounded-xl border p-3 text-left transition ${value === o.v ? "border-primary bg-active" : "border-border bg-card hover:border-faint"}`}>
      <div className="text-sm font-semibold">{o.l}</div>{o.d && <div className="text-xs text-muted-foreground">{o.d}</div>}</button>))}</div>;
}

export type LoanPrefill = { leadId: string; name: string; email: string; product: Product; city: string; state: string; purchasePrice: number; rehab: number; requestedAmount?: number; notes: string; address?: string; zip?: string; county?: string; arv?: number };

/** The loan application. A broker or staff member fills in the same one for a client, with the client's details added. */
export default function ApplicationWizard({ mode = "borrower", prefill }: { mode?: "borrower" | "broker" | "staff"; prefill?: LoanPrefill }) {
  const router = useRouter(); const { dispatch, applyReply, local, s } = useStore();
  const broker = mode === "broker";
  const staff = mode === "staff";
  const [client, setClient] = useState({ name: prefill?.name ?? "", email: prefill?.email ?? "", invite: Boolean(prefill?.email), points: 1 });
  const [sending, setSending] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteNote, setQuoteNote] = useState("");
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const move = (to: number) => { setDirection(to >= step ? 1 : -1); setStep(to); };
  const [addr, setAddr] = useState({ address: prefill?.address ?? "", city: prefill?.city ?? "", zip: prefill?.zip ?? "", entityName: "", exit: "Sell" });
  const [certs, setCerts] = useState({ bp: false, noo: false, consent: false, true: false });
  const [profile, setProfile] = useState<ReturnType<typeof emptyProfile>>(() => ({ ...emptyProfile(), guarantors: [{ name: prefill?.name ?? "", ownershipPct: 100, fico: 700, citizenship: "us" }] }));
  // Staff starting a loan from a phone call may not have this yet; the borrower is then asked for it on their loan page.
  const [collect, setCollect] = useState(!staff);
  const sponsor = useMemo(() => toSponsor(profile), [profile]);
  const [a, setA] = useState<Application>({ product: prefill?.product ?? "fix_flip", purpose: "purchase", county: prefill && prefill.state !== "FL" ? "Out of state" : prefill?.county || "Broward", state: prefill?.state ?? "FL", propertyType: "sfr", occupancy: "vacant", purchasePrice: prefill?.purchasePrice ?? 300_000, rehab: prefill?.rehab ?? 100_000, arv: prefill ? prefill.arv ?? prefill.purchasePrice + prefill.rehab : 550_000, requestedAmount: prefill?.requestedAmount, interestReserve: "none", accrual: "full_boat", fico: 720, verifiedDeals: 3, liquidity: 150_000, valuationSource: "borrower_estimate", monthlyRent: 3_200, taxesAnnual: 6_000, insuranceAnnual: 4_800, hoaMonthly: 0, groundUpBuilds: 0 });
  const set = (p: Partial<Application>) => setA((x) => ({ ...x, ...p }));
  // Priced on the people and deals listed, the same way the server will price it.
  const priced = useMemo(() => (collect ? withSponsor(a, sponsor, new Date()) : a), [a, sponsor, collect]);
  const e = useMemo(() => evaluate(priced), [priced]);
  const owned = profile.guarantors.reduce((sum, item) => sum + item.ownershipPct, 0);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);
  const ownerOcc = a.occupancy === "owner_occupied";
  const canNext = step !== 1 || !ownerOcc;
  // Demo and sample data fill in placeholders; a real loan needs the real details.
  const missing = [
    ...(local ? [] : [!addr.address.trim() && "property address", !addr.city.trim() && "city", !addr.zip.trim() && "ZIP", !addr.entityName.trim() && "borrowing entity"]),
    ...(collect ? [
      profile.guarantors.some((item) => !item.name.trim()) && "each guarantor's name",
      profile.guarantors.some((item) => item.fico < 300 || item.fico > 850) && "a credit score between 300 and 850 for each guarantor",
      owned > 100 && "ownership that adds up to 100% or less",
      profile.trackRecord.some((item) => !item.address.trim() || !/^\d{4}-\d{2}$/.test(item.completed) || !item.purchasePrice) && "the address, month finished and price for each past deal",
      !allAnswered(profile.answers) && "an answer to every credit question",
      DECLARATIONS.some((item) => profile.answers[item.key]) && !profile.answers.explanation.trim() && "an explanation for each yes",
    ] : []),
  ].filter((item): item is string => Boolean(item));
  const needsClient = (broker || staff) && !client.name.trim();
  // The broker's quote PDF for their client, priced on the server on today's numbers.
  const downloadQuote = async () => {
    setQuoting(true); setQuoteNote("");
    const reply = await fetch("/api/broker-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: priced, client: client.name, points: client.points, address: [addr.address, addr.city, addr.zip].filter(Boolean).join(", ") }) }).catch(() => null);
    setQuoting(false);
    if (!reply?.ok) return setQuoteNote(reply ? await reply.text() : "That didn't go through. Check your connection and try again.");
    const url = URL.createObjectURL(await reply.blob());
    const link = document.createElement("a");
    link.href = url; link.download = "lendhous-quote.pdf"; link.click();
    URL.revokeObjectURL(url);
    setQuoteNote("Downloaded. It says it's an estimate, not a commitment.");
  };
  const submit = async () => {
    setSending(true);
    const action = { t: "submitApp" as const, app: priced, address: addr.address, city: addr.city, zip: addr.zip, entityName: addr.entityName, exitStrategy: addr.exit, client: broker ? { name: client.name.trim(), brokerId: s.brokerId, brokerPoints: client.points } : staff ? { name: client.name.trim() } : undefined, source: staff ? "staff" : undefined, sponsor: collect ? sponsor : undefined };
    if (staff && !local) {
      const reply = await startLoan({ action, clientEmail: client.email, invite: client.invite, leadId: prefill?.leadId });
      applyReply(reply);
      setSending(false);
      if (reply.dealId) router.push(`/admin/deals/${reply.dealId}`);
      return;
    }
    const done = await dispatch(action);
    setSending(false);
    if (done) router.push(broker ? "/admin/broker" : staff ? "/admin" : "/admin/borrower");
  };

  return (
    <div className="grid gap-5 pb-16 lg:grid-cols-[1fr_380px] lg:pb-0">
      <div className="space-y-4">
        <div className="glass p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="whitespace-nowrap">Step {step + 1} of {steps.length}</span><span>Progress isn&apos;t saved if you leave this page</span></div>
          <div className="mt-2 flex gap-1">{steps.map((s, i) => <button key={s} onClick={() => move(i)} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-accent" aria-label={s}><motion.span className="absolute inset-0 origin-left rounded-full bg-primary" initial={false} animate={{ scaleX: i <= step ? 1 : 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} /></button>)}</div>
          <h1 className="mt-3 text-xl font-normal tracking-tight">{steps[step]}</h1>
        </div>
        <StepSwap step={step} direction={direction} className="glass space-y-4 p-4 sm:p-5">
        <div className="space-y-4" data-testid={`step-${step}`}>
          {step === 0 && (<>
            <Choice value={a.product} onChange={(v: Product) => set({ product: v, rehab: v === "bridge" || v === "dscr" ? 0 : a.rehab || 100_000, purpose: "purchase" })} options={[
              { v: "fix_flip", l: "Fix & Flip", d: "Purchase + rehab, interest-only, 6–18 months" }, { v: "bridge", l: "Bridge", d: "Light or no rehab, 6–24 months" },
              { v: "ground_up", l: "Ground-Up Construction", d: "Land + build, 12–24 months" }, { v: "dscr", l: "DSCR Rental", d: "30-year, qualifies on the property's rent" }]} />
            <div><span className="label">Purpose</span><Choice value={a.purpose} onChange={(v) => set({ purpose: v })} options={[{ v: "purchase", l: "Purchase" }, { v: "refi_rt", l: "Rate/term refinance" }, ...(a.product === "dscr" || a.product === "bridge" ? [{ v: "refi_co" as const, l: "Cash-out refinance" }] : [])]} /></div>
          </>)}
          {step === 1 && (<>
            {/* Google's suggestions fill the city, ZIP and, in Florida, the county that decides pricing. */}
            <AddressField testid="wizard-address" county={false} required={!local} value={{ street: addr.address, city: addr.city, state: a.state, zip: addr.zip, county: a.county }}
              onChange={(next) => { setAddr({ ...addr, address: next.street, city: next.city, zip: next.zip }); if (next.state && next.state !== a.state) set(next.state === "FL" ? { state: "FL", county: next.county || "Other FL" } : { state: next.state, county: "Out of state" }); else if (next.county && next.county !== a.county && next.state === "FL") set({ county: next.county }); }} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">County</span><select data-testid="county" className="desk-input" value={a.state === "FL" ? a.county : "Out of state"} onChange={(x) => x.target.value === "Out of state" ? set({ county: "Out of state", state: "GA" }) : set({ county: x.target.value, state: "FL" })}>{[...currentPricing().geography.core, ...currentPricing().geography.expansion, "Out of state"].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="block"><span className="label">Property type</span><select className="desk-input" value={a.propertyType} onChange={(x) => set({ propertyType: x.target.value as Application["propertyType"] })}><option value="sfr">Single-family</option><option value="2_4">2–4 units</option><option value="condo">Condo</option><option value="townhome">Townhome</option></select></label>
            </div>
            <div><span className="label">Occupancy</span><Choice value={a.occupancy} onChange={(v) => set({ occupancy: v })} options={[{ v: "vacant", l: "Vacant" }, { v: "tenant", l: "Tenant-occupied" }, { v: "owner_occupied", l: "I or a family member will live here" }]} /></div>
            {ownerOcc && <div className="rounded-lg bg-bad/10 p-3 text-sm text-bad" data-testid="owner-occ-stop"><b>We can&apos;t continue with this one.</b> LendHous makes business-purpose investment loans only. For a home you&apos;ll live in, please talk to a licensed consumer mortgage lender.</div>}
          </>)}
          {step === 2 && (<div className="grid gap-3 sm:grid-cols-2">
            {a.product === "ground_up" ? (<>
              <Num label="Land cost / value" value={a.landValue ?? a.purchasePrice} onChange={(v) => set({ landValue: v ?? 0, purchasePrice: v ?? 0 })} />
              <Num label="Hard costs" value={a.hardCosts} onChange={(v) => set({ hardCosts: v, rehab: (v ?? 0) + (a.softCosts ?? 0) })} />
              <Num label="Soft costs" value={a.softCosts} onChange={(v) => set({ softCosts: v, rehab: (a.hardCosts ?? 0) + (v ?? 0) })} />
              <Num label="Completed ground-up builds" value={a.groundUpBuilds} onChange={(v) => set({ groundUpBuilds: v ?? 0 })} />
              <Num label="As-completed value (ARV)" value={a.arv} onChange={(v) => set({ arv: v ?? 0 })} />
            </>) : (<>
              <Num testid="purchase" label={a.purpose === "purchase" ? "Purchase price" : "Current value (as-is)"} value={a.purchasePrice} onChange={(v) => set({ purchasePrice: v ?? 0, ...(a.product === "bridge" || a.product === "dscr" ? { arv: v ?? 0 } : {}) })} />
              {(a.product === "fix_flip") && <Num testid="rehab" label="Rehab budget" value={a.rehab} onChange={(v) => set({ rehab: v ?? 0 })} />}
              {(a.product === "fix_flip") && <Num testid="arv" label="After-repair value (ARV)" value={a.arv} onChange={(v) => set({ arv: v ?? 0 })} hint="Upload comps later in the document center" />}
              {a.purpose !== "purchase" && <><Num label="Original purchase price" value={a.originalPurchasePrice} onChange={(v) => set({ originalPurchasePrice: v })} /><Num label="Existing liens to pay off" value={a.existingLiens} onChange={(v) => set({ existingLiens: v })} />{a.product === "fix_flip" && <Num label="Rehab already spent" value={a.rehabSpent} onChange={(v) => set({ rehabSpent: v })} />}</>}
              {a.product === "dscr" && <><Num label="Monthly rent (lease or market)" value={a.monthlyRent} onChange={(v) => set({ monthlyRent: v })} /><Num label="Property taxes / year" value={a.taxesAnnual} onChange={(v) => set({ taxesAnnual: v })} /><Num label="Insurance / year" value={a.insuranceAnnual} onChange={(v) => set({ insuranceAnnual: v })} /><Num label="HOA / month" value={a.hoaMonthly} onChange={(v) => set({ hoaMonthly: v })} /></>}
            </>)}
            <div className="sm:col-span-2 text-xs text-muted-foreground">Ratios in the estimate update live as you type. Green = comfortable, yellow = close to the limit, red = over the limit.</div>
          </div>)}
          {step === 3 && (<div className="grid gap-3 sm:grid-cols-2">
            <Num testid="requested" label="Requested loan amount (blank = max)" value={a.requestedAmount} onChange={(v) => set({ requestedAmount: v })} />
            <label className="block"><span className="label">Term (months)</span><select className="desk-input" value={a.termMonths ?? (a.product === "ground_up" ? 18 : 12)} onChange={(x) => set({ termMonths: Number(x.target.value) })}>{[6, 9, 12, 18, 24].map((m) => <option key={m}>{m}</option>)}</select></label>
            {a.product !== "dscr" && <><div><span className="label">Interest reserve</span><Choice value={a.interestReserve} onChange={(v) => set({ interestReserve: v })} options={[{ v: "none", l: "No, I'll pay monthly" }, { v: "financed", l: "Yes, carve it out of the loan" }]} /></div>
            <div><span className="label">Interest on</span><Choice value={a.accrual} onChange={(v) => set({ accrual: v })} options={[{ v: "full_boat", l: "Full loan (full-boat)" }, { v: "dutch", l: "Disbursed funds only (Dutch)" }]} /></div></>}
            <label className="block"><span className="label">Exit strategy</span><select className="desk-input" value={addr.exit} onChange={(x) => setAddr({ ...addr, exit: x.target.value })}><option>Sell</option><option>Refi</option><option>Hold</option></select></label>
          </div>)}
          {step === 4 && (<div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {staff && <>
                <label className="block"><span className="label">Borrower&apos;s name</span><input data-testid="client-name" className="desk-input" value={client.name} onChange={(x) => setClient({ ...client, name: x.target.value })} /></label>
                <label className="block"><span className="label">Borrower&apos;s email (optional)</span><input data-testid="client-email" type="email" className="desk-input" value={client.email} onChange={(x) => setClient({ ...client, email: x.target.value })} /></label>
                {!local && client.email.trim() && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input data-testid="client-invite" type="checkbox" checked={client.invite} onChange={(x) => setClient({ ...client, invite: x.target.checked })} /> Invite them to the portal if they don&apos;t have an account</label>}
                {prefill?.notes && <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground sm:col-span-2">From their website brief: {prefill.notes}</p>}
              </>}
              {broker && <>
                <label className="block"><span className="label">Client&apos;s name</span><input data-testid="client-name" className="desk-input" value={client.name} onChange={(x) => setClient({ ...client, name: x.target.value })} /></label>
                <label className="block"><span className="label">Your fee (points, paid at closing)</span><input data-testid="client-points" className="desk-input" type="number" inputMode="decimal" min={0} max={5} step={0.25} value={client.points} onChange={(x) => setClient({ ...client, points: Number(x.target.value) || 0 })} /></label>
              </>}
              <label className="block"><span className="label">Borrowing entity (LLC)</span><input className="desk-input" placeholder="e.g. Sunrise Holdings LLC" value={addr.entityName} onChange={(x) => setAddr({ ...addr, entityName: x.target.value })} /></label>
              <label className="block"><span className="label">State the LLC was formed in</span><input className="desk-input" data-testid="entity-state" maxLength={2} value={profile.entityState} onChange={(x) => setProfile({ ...profile, entityState: x.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase() })} /></label>
              <Num label="Cash and reserves you can show on bank statements" value={a.liquidity} onChange={(v) => set({ liquidity: v ?? 0 })} hint={`This loan needs about $${Math.round(e.cashToClose).toLocaleString()} to close, plus reserves`} />
              <Num label="Earnest money already paid" value={a.earnestMoney} onChange={(v) => set({ earnestMoney: v })} />
              {staff && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!a.repeatBorrower} onChange={(x) => set({ repeatBorrower: x.target.checked })} /> Paid a LendHous loan before this system (counts as one; loans here are counted on their own)</label>}
              {staff && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" data-testid="collect-profile" checked={collect} onChange={(x) => setCollect(x.target.checked)} /> I have the guarantors, past deals and credit answers now. Otherwise the borrower is asked for them on their loan page.</label>}
              {staff && !collect && <>
                <Num testid="fico" label="Credit score (estimate)" value={a.fico} onChange={(v) => set({ fico: v ?? 0 })} />
                <Num testid="deals" label="Completed deals, last 36 months (estimate)" value={a.verifiedDeals} onChange={(v) => set({ verifiedDeals: v ?? 0 })} />
              </>}
            </div>
            {collect && <GuarantorFields guarantors={profile.guarantors} onChange={(guarantors) => setProfile({ ...profile, guarantors })} />}
          </div>)}
          {step === 5 && (collect ? <TrackRecordFields deals={profile.trackRecord} onChange={(trackRecord) => setProfile({ ...profile, trackRecord })} /> : <p className="text-sm text-muted-foreground">The borrower lists their past deals on their loan page.</p>)}
          {step === 6 && (collect ? <DeclarationFields answers={profile.answers} onChange={(answers) => setProfile({ ...profile, answers })} /> : <p className="text-sm text-muted-foreground">The borrower answers the credit questions on their loan page.</p>)}
          {step === REVIEW && (<div className="space-y-4 text-sm">
            <div className="grid gap-2 rounded-lg bg-muted p-3 sm:grid-cols-2" data-testid="review-summary">
              <div><b>{productLabel[a.product]}</b> · {a.purpose.replace("_", " ")}</div><div>{addr.address || "(no address)"} {addr.city} · {a.county}</div>
              <div>Price {a.purchasePrice.toLocaleString()} · Rehab {a.rehab.toLocaleString()} · ARV {a.arv.toLocaleString()}</div>
              <div>{collect ? `${profile.guarantors.length} guarantor${profile.guarantors.length === 1 ? "" : "s"} · qualifying score ${qualifyingFico(sponsor.guarantors)}` : `Score ${a.fico}`} · {priced.verifiedDeals} past deal{priced.verifiedDeals === 1 ? "" : "s"} · Tier {e.tier}</div>
            </div>
            {broker && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3" data-testid="broker-quote">
                <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">A quote for your client with your brokerage&apos;s name, LendHous as the lender, and your fee shown. Nothing is sent to LendHous until you submit.</p>
                <button type="button" className="btn-ghost" data-testid="broker-quote-pdf" disabled={quoting || !client.name.trim()} onClick={() => void downloadQuote()}>{quoting ? "Making it…" : "Download a quote (PDF)"}</button>
                {quoteNote && <p className="w-full text-xs text-muted-foreground" role="status" data-testid="broker-quote-note">{quoteNote}</p>}
              </div>
            )}
            <div data-testid="needs-preview">
              <h2 className="text-sm font-medium">After you submit, we&apos;ll ask for</h2>
              <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">{needsList(priced, collect ? sponsor : undefined).map((item) => <li key={item.id}>· {item.name}</li>)}</ul>
            </div>
            <div className="space-y-2">
              {[["bp", "This loan is for business or investment purposes only."], ["noo", "Neither I nor any family member will live in the property."], ["consent", "I consent to a soft credit pull and identity and OFAC checks for each guarantor (FCRA disclosure)."], ["true", "Everything in this application is true and complete as far as I know."]].map(([key, txt]) => (
                <label key={key} className="flex items-start gap-2"><input data-testid={`cert-${key}`} type="checkbox" className="mt-1" checked={certs[key as keyof typeof certs]} onChange={(x) => setCerts({ ...certs, [key]: x.target.checked })} /> {txt}</label>))}
            </div>
            {local ? <p className="text-xs text-muted-foreground">Sample data: the application is saved in this browser only.</p>
              : <p className="text-xs text-muted-foreground" data-testid="submit-real">{staff ? "This creates the loan in the pipeline." : "This goes to the LendHous team, who will be in touch."}</p>}
            {missing.length > 0 && <p role="alert" className="text-sm text-bad" data-testid="submit-missing">Still needed: {missing.join(", ")}.</p>}
            {needsClient && <p role="alert" className="text-sm text-bad">Add {staff ? "the borrower's" : "your client's"} name on the Borrower &amp; guarantors step.</p>}
          </div>)}
        </div>
        </StepSwap>
        <div className="flex justify-between gap-2">
          <button className="btn-ghost" disabled={step === 0} onClick={() => move(step - 1)}>Back</button>
          {step < REVIEW ? <button data-testid="next" className="btn-primary" disabled={!canNext} onClick={() => move(step + 1)}>Continue</button>
            : <button data-testid="submit" className="btn-primary" disabled={sending || !e.eligible || !certs.bp || !certs.noo || !certs.consent || !certs.true || needsClient || missing.length > 0} onClick={() => void submit()}>{sending ? "Sending…" : staff ? "Create loan" : "Submit application"}</button>}
        </div>
      </div>
      <div className="lg:sticky lg:top-5 lg:self-start">
        <EstimatePanel e={e} product={a.product} />
        <p className="mt-2 px-1 text-xs text-muted-foreground" data-testid="priced-on">Priced on {priced.verifiedDeals} past deal{priced.verifiedDeals === 1 ? "" : "s"} and a {priced.fico} credit score.{collect && step < 5 ? " List your guarantors and past deals in the next steps to see your own terms." : ""}</p>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-border bg-card px-4 py-2 shadow-[var(--shadow)] lg:hidden">
        <div><div className="text-xs text-muted-foreground">Estimate</div><div className="text-base font-semibold tracking-tight text-foreground">{e.eligible ? `$${e.noteAmount.toLocaleString()} · ${e.rate.toFixed(2)}%` : "Not eligible"}</div></div>
        <div className="text-right text-xs text-muted-foreground">Cash to close<br /><b className="text-foreground">${Math.round(e.cashToClose).toLocaleString()}</b></div>
      </div>
    </div>
  );
}
