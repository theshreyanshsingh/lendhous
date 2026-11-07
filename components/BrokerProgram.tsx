"use client";
import { useEffect, useState } from "react";
import { brokerLetters, issueBrokerLetter } from "@/actions/letters";
import { Badge, Section, usd } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { brandProblem, BROKER_LETTER_DAYS, BROKER_TIERS, brokerLetterProblem, brokerStanding } from "@/lib/broker-program";
import type { Product } from "@/lib/engine";
import { shortDay } from "@/lib/format";
import type { Broker } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const PRODUCTS: [Product, string][] = [["fix_flip", "Fix and flip"], ["bridge", "Bridge"], ["ground_up", "New construction"], ["dscr", "DSCR rental"]];
const amountOf = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, "")) || 0);

/** Where the brokerage stands: its tier from the last 12 months' funded loans, and what the next one takes. */
export function BrokerStanding({ firm }: { firm: Broker }) {
  const { s } = useStore();
  const standing = brokerStanding(s.deals, firm.id, serviceDay(s));
  return (
    <div className="glass flex flex-wrap items-start justify-between gap-3 p-4" data-testid="broker-standing">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-base font-medium">{standing.tier ? `${standing.tier.name} broker` : "Your broker tier"}</h2>
        <p className="text-sm text-muted-foreground" data-testid="broker-volume">{usd(standing.funded)} funded across {standing.loans} loan{standing.loans === 1 ? "" : "s"} in the last 12 months{standing.next ? `; ${usd(standing.next.more)} more reaches ${standing.next.name}` : ""}.</p>
        {standing.tier && <ul className="mt-1 list-disc pl-5 text-sm">{standing.tier.perks.map((perk) => <li key={perk}>{perk}</li>)}</ul>}
      </div>
      <ul className="text-xs text-muted-foreground">{BROKER_TIERS.map((tier) => <li key={tier.name}><b className="text-foreground">{tier.name}</b>: {usd(tier.funded)} a year, {Math.round(tier.maxLate * 100)}% or less behind</li>)}</ul>
    </div>
  );
}

/** How the brokerage shows on the quotes and term sheets it gives clients. LendHous stays named as the lender. */
export function BrokerBrandForm({ firm }: { firm: Broker }) {
  const { dispatch } = useStore();
  const [brand, setBrand] = useState(firm.brand ?? { name: firm.name, phone: "", email: "", website: "" });
  const [saved, setSaved] = useState(false);
  const problem = brandProblem(brand);
  const field = (key: keyof typeof brand, label: string, extra: { type?: string; placeholder?: string } = {}) => (
    <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" data-testid={`brand-${key}`} type={extra.type ?? "text"} placeholder={extra.placeholder} value={brand[key]} onChange={(event) => { setSaved(false); setBrand({ ...brand, [key]: event.target.value }); }} /></label>
  );
  return (
    <Section title="Your brand on quotes and term sheets" right={firm.brand ? <Badge tone="green">On</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="broker-brand">
        <p className="text-muted-foreground">Quotes you make, and the term sheets on your clients&apos; loans, carry your name and contact details on top. LendHous is still named as the lender, as the broker agreement requires.</p>
        <div className="grid gap-3 sm:grid-cols-2">{field("name", "Name your clients know you by")}{field("phone", "Phone", { type: "tel" })}{field("email", "Email", { type: "email" })}{field("website", "Website", { placeholder: "https://" })}</div>
        {problem && brand.name && <p className="text-xs text-warn" data-testid="brand-problem">{problem}</p>}
        {saved && <p className="text-xs text-good" role="status" data-testid="brand-saved">Saved. Your next quote and term sheet carry it.</p>}
        <button type="button" className="btn-primary w-full sm:w-auto" data-testid="save-brand" disabled={Boolean(problem)} onClick={async () => { if (await dispatch({ t: "saveBrokerBrand", brokerId: firm.id, brand })) setSaved(true); }}>Save</button>
      </div>
    </Section>
  );
}

type Letter = Awaited<ReturnType<typeof brokerLetters>>[number];

/** The brokerage's own pre-qualification letters, up to the limit an owner set, checked by sellers like LendHous's own. */
export function BrokerLetters({ firm }: { firm: Broker }) {
  const { local } = useStore();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [form, setForm] = useState({ name: "", email: "", entityName: "", product: "fix_flip" as Product, maxPurchasePrice: "", maxLoan: "", propertyAddress: "", validDays: String(BROKER_LETTER_DAYS) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState("");
  useEffect(() => { if (!local) void brokerLetters().then(setLetters).catch(() => setLetters([])); }, [local]);
  if (!firm.letterLimit) return (
    <Section title="Pre-qualification letters"><p className="text-sm text-muted-foreground" data-testid="broker-letters-off">LendHous sets a limit before your brokerage issues its own pre-qualification letters. Ask your contact there.</p></Section>
  );
  const problem = brokerLetterProblem(firm, amountOf(form.maxLoan), Number(form.validDays));
  const send = async () => {
    setBusy(true); setError(""); setIssued("");
    const reply = await issueBrokerLetter({ ...form, maxPurchasePrice: amountOf(form.maxPurchasePrice), maxLoan: amountOf(form.maxLoan), validDays: Number(form.validDays) }).catch(() => ({ error: "That didn't go through. Try again." }));
    setBusy(false);
    if ("error" in reply && reply.error) return setError(reply.error);
    setIssued(("number" in reply && reply.number) || "");
    setLetters(await brokerLetters().catch(() => letters));
  };
  const input = (key: keyof typeof form, label: string, extra: { mode?: "numeric" | "email"; placeholder?: string } = {}) => (
    <label className="block min-w-0"><span className="label">{label}</span><input className="desk-input" data-testid={`broker-letter-${key}`} inputMode={extra.mode} placeholder={extra.placeholder} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>
  );
  return (
    <Section title="Pre-qualification letters" right={<Badge tone="blue">Up to {usd(firm.letterLimit)}</Badge>}>
      <div className="space-y-3 text-sm" data-testid="broker-letters">
        <p className="text-muted-foreground">A letter for a client to show a seller, from your brokerage through LendHous, for a loan up to {usd(firm.letterLimit)} and up to {BROKER_LETTER_DAYS} days. It&apos;s emailed to them as a PDF with a code sellers can check. It isn&apos;t an approval: only LendHous approves a loan.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {input("name", "Client's name")}{input("email", "Client's email (optional)", { mode: "email" })}{input("entityName", "Their LLC (optional)")}
          <label className="block min-w-0"><span className="label">Loan</span><select className="desk-input" data-testid="broker-letter-product" value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value as Product })}>{PRODUCTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {input("maxPurchasePrice", "Purchase price up to", { mode: "numeric", placeholder: "$0" })}{input("maxLoan", "Loan up to", { mode: "numeric", placeholder: "$0" })}
          {input("propertyAddress", "Property (optional)")}{input("validDays", "Valid for (days)", { mode: "numeric" })}
        </div>
        {form.maxLoan && problem && <p className="text-xs text-warn" data-testid="broker-letter-problem">{problem}</p>}
        {error && <p className="text-xs text-bad" role="alert" data-testid="broker-letter-error">{error}</p>}
        {issued && <p className="text-xs text-good" role="status" data-testid="broker-letter-issued">Letter {issued} issued{form.email ? ` and emailed to ${form.email}` : ""}.</p>}
        <button type="button" className="btn-primary w-full sm:w-auto" data-testid="issue-broker-letter" disabled={busy || Boolean(problem) || !form.name.trim()} onClick={() => void send()}>{busy ? "Issuing…" : "Issue the letter"}</button>
        {letters.length > 0 && <ul className="divide-y divide-border border-t border-border pt-2" data-testid="broker-letter-list">{letters.map((letter) => <li key={letter.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{letter.number} · {letter.entityName || letter.name} · up to {usd(letter.maxLoan)}</span><span className="text-xs text-muted-foreground">{letter.state === "valid" ? `valid through ${shortDay(letter.expiresOn)}` : letter.state}</span></li>)}</ul>}
      </div>
    </Section>
  );
}
