"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { evaluate, type Application, type Product } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing-config";
import { useStore } from "@/lib/store";
import EstimatePanel from "@/components/EstimatePanel";
import { productLabel } from "@/components/ui";

const steps = ["Loan type", "Property", "Deal numbers", "Loan request", "Borrower & experience", "Review & submit"];
const counties = [...pricingConfig.geography.core, ...pricingConfig.geography.expansion, "Out of state"];

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

export default function Apply() {
  const router = useRouter(); const { dispatch, demo } = useStore();
  const [step, setStep] = useState(0);
  const [addr, setAddr] = useState({ address: "", city: "", zip: "", entityName: "", exit: "Sell" });
  const [certs, setCerts] = useState({ bp: false, noo: false, consent: false });
  const [a, setA] = useState<Application>({ product: "fix_flip", purpose: "purchase", county: "Broward", state: "FL", propertyType: "sfr", occupancy: "vacant", purchasePrice: 300_000, rehab: 100_000, arv: 550_000, interestReserve: "none", accrual: "full_boat", fico: 720, verifiedDeals: 3, liquidity: 150_000, valuationSource: "borrower_estimate", monthlyRent: 3_200, taxesAnnual: 6_000, insuranceAnnual: 4_800, hoaMonthly: 0, groundUpBuilds: 0 });
  const set = (p: Partial<Application>) => setA((x) => ({ ...x, ...p }));
  const e = useMemo(() => evaluate(a), [a]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);
  const ownerOcc = a.occupancy === "owner_occupied";
  const canNext = step !== 1 || !ownerOcc;
  const submit = () => { dispatch({ t: "submitApp", app: a, address: addr.address, city: addr.city, zip: addr.zip, entityName: addr.entityName, exitStrategy: addr.exit }); router.push("/borrower"); };

  return (
    <div className="grid gap-5 pb-16 lg:grid-cols-[1fr_380px] lg:pb-0">
      <div className="space-y-4">
        <div className="glass p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="whitespace-nowrap">Step {step + 1} of {steps.length}</span><span>Progress isn&apos;t saved if you leave this page</span></div>
          <div className="mt-2 flex gap-1">{steps.map((s, i) => <button key={s} onClick={() => setStep(i)} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-accent"}`} aria-label={s} />)}</div>
          <h1 className="mt-3 text-xl font-normal tracking-tight">{steps[step]}</h1>
        </div>
        <div className="glass space-y-4 p-4 sm:p-5" data-testid={`step-${step}`}>
          {step === 0 && (<>
            <Choice value={a.product} onChange={(v: Product) => set({ product: v, rehab: v === "bridge" || v === "dscr" ? 0 : a.rehab || 100_000, purpose: "purchase" })} options={[
              { v: "fix_flip", l: "Fix & Flip", d: "Purchase + rehab, interest-only, 6–18 months" }, { v: "bridge", l: "Bridge", d: "Light or no rehab, 6–24 months" },
              { v: "ground_up", l: "Ground-Up Construction", d: "Land + build, 12–24 months" }, { v: "dscr", l: "DSCR Rental", d: "30-year, qualifies on the property's rent" }]} />
            <div><span className="label">Purpose</span><Choice value={a.purpose} onChange={(v) => set({ purpose: v })} options={[{ v: "purchase", l: "Purchase" }, { v: "refi_rt", l: "Rate/term refinance" }, ...(a.product === "dscr" || a.product === "bridge" ? [{ v: "refi_co" as const, l: "Cash-out refinance" }] : [])]} /></div>
          </>)}
          {step === 1 && (<>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="label">Property address</span><input className="desk-input" placeholder="e.g. 100 Main St" value={addr.address} onChange={(x) => setAddr({ ...addr, address: x.target.value })} /></label>
              <label className="block"><span className="label">City</span><input className="desk-input" value={addr.city} onChange={(x) => setAddr({ ...addr, city: x.target.value })} /></label>
              <label className="block"><span className="label">ZIP</span><input className="desk-input" value={addr.zip} onChange={(x) => setAddr({ ...addr, zip: x.target.value })} /></label>
              <label className="block"><span className="label">County</span><select data-testid="county" className="desk-input" value={a.state === "FL" ? a.county : "Out of state"} onChange={(x) => x.target.value === "Out of state" ? set({ county: "Out of state", state: "GA" }) : set({ county: x.target.value, state: "FL" })}>{counties.map((c) => <option key={c}>{c}</option>)}</select></label>
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
          {step === 4 && (<div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label">Borrowing entity (LLC)</span><input className="desk-input" placeholder="e.g. Sunrise Holdings LLC" value={addr.entityName} onChange={(x) => setAddr({ ...addr, entityName: x.target.value })} /></label>
            <Num testid="fico" label="Credit score (self-reported)" value={a.fico} onChange={(v) => set({ fico: v ?? 0 })} hint="A soft pull (no score impact) happens after you consent" />
            <Num testid="deals" label="Completed deals, last 36 months" value={a.verifiedDeals} onChange={(v) => set({ verifiedDeals: v ?? 0 })} hint="Flips, builds or rentals with HUD/closing statements" />
            <Num label="Verified liquidity (cash + reserves)" value={a.liquidity} onChange={(v) => set({ liquidity: v ?? 0 })} />
            <Num label="Earnest money already paid" value={a.earnestMoney} onChange={(v) => set({ earnestMoney: v })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!a.foreignNational} onChange={(x) => set({ foreignNational: x.target.checked })} /> Foreign national guarantor</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!a.repeatBorrower} onChange={(x) => set({ repeatBorrower: x.target.checked })} /> Repeat LendHous borrower</label>
          </div>)}
          {step === 5 && (<div className="space-y-3 text-sm">
            <div className="grid gap-2 rounded-lg bg-muted p-3 sm:grid-cols-2">
              <div><b>{productLabel[a.product]}</b> · {a.purpose.replace("_", " ")}</div><div>{addr.address || "(no address)"} {addr.city} · {a.county}</div>
              <div>Price {a.purchasePrice.toLocaleString()} · Rehab {a.rehab.toLocaleString()} · ARV {a.arv.toLocaleString()}</div><div>FICO {a.fico} · {a.verifiedDeals} deals · Tier {e.tier}</div>
            </div>
            {[["bp", "I certify this loan is for business/investment purposes only."], ["noo", "Neither I nor any family member will occupy the property."], ["consent", "I consent to a soft credit pull and identity/OFAC checks (FCRA disclosure)."]].map(([key, txt]) => (
              <label key={key} className="flex items-start gap-2"><input data-testid={`cert-${key}`} type="checkbox" className="mt-1" checked={certs[key as keyof typeof certs]} onChange={(x) => setCerts({ ...certs, [key]: x.target.checked })} /> {txt}</label>))}
            {demo ? <p className="text-xs text-muted-foreground">Demo account: the application is saved to the demo data in this browser only.</p>
              : <p className="text-xs text-muted-foreground" data-testid="submit-closed">Online submission isn&apos;t open for this account yet. Contact your LendHous loan officer to apply.</p>}
          </div>)}
        </div>
        <div className="flex justify-between gap-2">
          <button className="btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < steps.length - 1 ? <button data-testid="next" className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button>
            : <button data-testid="submit" className="btn-primary" disabled={!demo || !e.eligible || !certs.bp || !certs.noo || !certs.consent} onClick={submit}>Submit application</button>}
        </div>
      </div>
      <div className="lg:sticky lg:top-5 lg:self-start"><EstimatePanel e={e} product={a.product} /></div>
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-border bg-card px-4 py-2 shadow-[var(--shadow)] lg:hidden">
        <div><div className="text-xs text-muted-foreground">Estimate</div><div className="text-base font-semibold tracking-tight text-foreground">{e.eligible ? `$${e.noteAmount.toLocaleString()} · ${e.rate.toFixed(2)}%` : "Not eligible"}</div></div>
        <div className="text-right text-xs text-muted-foreground">Cash to close<br /><b className="text-foreground">${Math.round(e.cashToClose).toLocaleString()}</b></div>
      </div>
    </div>
  );
}
