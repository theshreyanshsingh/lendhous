"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitW8, submitW9, type myTaxForm } from "@/actions/tax";
import { Section } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { CLASSIFICATIONS, type Classification, type W8, type W9 } from "@/lib/tax-forms";

type OnFile = Awaited<ReturnType<typeof myTaxForm>>;
const blankW9 = (): W9 => ({ legalName: "", businessName: "", classification: "individual", tinType: "ssn", tin: "", exemptPayeeCode: "", address: { street: "", city: "", state: "", zip: "" } });
const blankW8 = (): W8 => ({ name: "", entity: false, country: "", foreignTin: "", address: "" });

// PLACEHOLDER: the substance of the IRS's Part II certification. The CPA or attorney confirms the substitute form.
const W9_CERTIFICATION = "Under penalties of perjury, I certify that the number shown is my correct taxpayer identification number; that I am not subject to backup withholding (or the IRS has told me I'm no longer subject to it); that I am a U.S. citizen or other U.S. person; and that any exempt payee code I entered is correct.";
const W8_CERTIFICATION = "Under penalties of perjury, I certify that I am the beneficial owner of the income this form relates to, that I am not a U.S. person, and that the information on this form is true, correct and complete.";

/** A partner's, buyer's or broker's W-9 (or W-8BEN for a foreign person), signed in the portal before LendHous pays them. */
export function TaxFormPanel({ onFile, demo }: { onFile: OnFile; demo: boolean }) {
  const router = useRouter();
  const [foreign, setForeign] = useState(false);
  const [w9, setW9] = useState<W9>(blankW9);
  const [w8, setW8] = useState<W8>(blankW8);
  const [signature, setSignature] = useState("");
  const [certified, setCertified] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!onFile);
  const send = async () => {
    setBusy(true); setError("");
    const reply = await (foreign ? submitW8(w8, signature, certified) : submitW9(w9, signature, certified)).catch(() => ({ error: "That didn't go through. Check your connection and try again." }));
    setBusy(false);
    if (reply.error) return setError(reply.error);
    setEditing(false);
    router.refresh();
  };
  const field = (label: string, value: string, onChange: (value: string) => void, extra: { testid: string; mode?: "numeric"; max?: number; wide?: boolean; placeholder?: string } ) => (
    <label className={`block min-w-0 ${extra.wide ? "sm:col-span-2" : ""}`}><span className="label">{label}</span><input className="desk-input" data-testid={extra.testid} inputMode={extra.mode} maxLength={extra.max ?? 160} placeholder={extra.placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></label>
  );

  if (demo) return <Section title="Your tax form"><p className="text-sm text-muted-foreground" data-testid="tax-demo">Demo accounts don&apos;t file tax forms. A real partner, buyer or broker signs a W-9 here before LendHous pays them.</p></Section>;

  return (
    <div className="space-y-4">
      <Section title="On file">
        {onFile ? (
          <div className="text-sm" data-testid="tax-on-file">
            {onFile.kind === "w9" ? <p><b>W-9</b> for {onFile.name} ({onFile.classification}), TIN {onFile.tin}, signed {shortDay(onFile.signedAt)}.</p> : <p><b>W-8</b> for {onFile.name} ({onFile.country}), signed {shortDay(onFile.signedAt)}, good through {shortDay(onFile.expiresOn)}.</p>}
            {!editing && <button type="button" className="mt-2 text-link underline" data-testid="tax-update" onClick={() => setEditing(true)}>Something changed? Sign a new one</button>}
          </div>
        ) : <p className="text-sm text-warn" data-testid="tax-missing">Nothing yet. Until LendHous has your W-9, it has to hold back 24% of what it pays you for the IRS (backup withholding).</p>}
      </Section>
      {editing && (
        <Section title={foreign ? "Form W-8BEN (not a U.S. person)" : "Form W-9 (U.S. person)"}>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="tax-foreign" checked={foreign} onChange={(event) => setForeign(event.target.checked)} /> I&apos;m not a U.S. citizen, resident or U.S. business</label>
            {!foreign ? (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="w9-form">
                {field("Name on your tax return", w9.legalName, (legalName) => setW9({ ...w9, legalName }), { testid: "w9-name", max: 120 })}
                {field("Business name, if different (optional)", w9.businessName, (businessName) => setW9({ ...w9, businessName }), { testid: "w9-business", max: 120 })}
                <label className="block min-w-0"><span className="label">Federal tax classification</span><select className="desk-input" data-testid="w9-classification" value={w9.classification} onChange={(event) => setW9({ ...w9, classification: event.target.value as Classification, tinType: ["individual", "llc_disregarded"].includes(event.target.value) ? w9.tinType : "ein" })}>{(Object.keys(CLASSIFICATIONS) as Classification[]).map((key) => <option key={key} value={key}>{CLASSIFICATIONS[key]}</option>)}</select></label>
                <label className="block min-w-0"><span className="label">Taxpayer ID</span><select className="desk-input" data-testid="w9-tin-type" value={w9.tinType} onChange={(event) => setW9({ ...w9, tinType: event.target.value as W9["tinType"] })}><option value="ssn">Social Security number</option><option value="ein">Employer ID number (EIN)</option></select></label>
                {field(w9.tinType === "ein" ? "EIN" : "Social Security number", w9.tin, (tin) => setW9({ ...w9, tin: tin.replace(/[^\d-]/g, "") }), { testid: "w9-tin", mode: "numeric", max: 11 })}
                {field("Exempt payee code (optional)", w9.exemptPayeeCode, (exemptPayeeCode) => setW9({ ...w9, exemptPayeeCode }), { testid: "w9-exempt", max: 4, placeholder: "e.g. 1 for an IRA" })}
                {field("Street address", w9.address.street, (street) => setW9({ ...w9, address: { ...w9.address, street } }), { testid: "w9-street", wide: true })}
                {field("City", w9.address.city, (city) => setW9({ ...w9, address: { ...w9.address, city } }), { testid: "w9-city", max: 80 })}
                <div className="grid grid-cols-2 gap-3">{field("State", w9.address.state, (state) => setW9({ ...w9, address: { ...w9.address, state: state.toUpperCase() } }), { testid: "w9-state", max: 2 })}{field("ZIP", w9.address.zip, (zip) => setW9({ ...w9, address: { ...w9.address, zip } }), { testid: "w9-zip", mode: "numeric", max: 10 })}</div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="w8-form">
                {field("Name", w8.name, (name) => setW8({ ...w8, name }), { testid: "w8-name", max: 120 })}
                {field("Country of citizenship or organization", w8.country, (country) => setW8({ ...w8, country }), { testid: "w8-country", max: 60 })}
                {field("Permanent address (not a P.O. box)", w8.address, (address) => setW8({ ...w8, address }), { testid: "w8-address", wide: true, max: 240 })}
                {field("Foreign tax ID (optional)", w8.foreignTin, (foreignTin) => setW8({ ...w8, foreignTin }), { testid: "w8-tin", max: 40 })}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={w8.entity} onChange={(event) => setW8({ ...w8, entity: event.target.checked })} /> This is for a business (Form W-8BEN-E)</label>
              </div>
            )}
            <p className="rounded-[2px] border border-border bg-muted/40 p-3 font-serif text-[13px] leading-relaxed">{foreign ? W8_CERTIFICATION : W9_CERTIFICATION}</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="tax-certify" checked={certified} onChange={(event) => setCertified(event.target.checked)} /> I certify the above.</label>
            <label className="block"><span className="label">Type your full name to sign</span><input className="w-full border-0 border-b border-rule bg-transparent py-2 font-serif text-xl italic text-foreground outline-none" data-testid="tax-signature" value={signature} onChange={(event) => setSignature(event.target.value)} /></label>
            {error && <p className="text-sm text-bad" role="alert" data-testid="tax-error">{error}</p>}
            <button type="button" className="btn-primary" data-testid="tax-submit" disabled={busy} onClick={() => void send()}>{busy ? "Signing…" : "Sign and send"}</button>
            <p className="text-xs text-muted-foreground">Your taxpayer ID is encrypted and only used for the tax forms LendHous files for you each January.</p>
          </div>
        </Section>
      )}
    </div>
  );
}
