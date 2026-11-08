"use client";

import { EmptyState } from "@/components/EmptyState";
import { FirmScreening } from "@/components/FirmScreening";
import { useState } from "react";
import { PageIntro } from "@/components/page-intro";
import { Badge, productLabel, usd } from "@/components/ui";
import type { BuyBox, Product } from "@/lib/engine";
import { useStore } from "@/lib/store";

export type FirmAccount = { firmId: string; kind: "partner" | "buyer"; name: string; email: string };

type Firm = { id: string; kind: "partner" | "buyer"; name: string; emails: string[]; ndaSigned?: boolean; buyBox?: BuyBox; principals?: string[] };

const DEFAULT_BOX: BuyBox = { products: ["fix_flip", "bridge"], states: ["FL"], minLoan: 100_000, maxLoan: 2_000_000, maxLTARV: 0.7, minFico: 660, minTier: 1, targetYield: 9.5 };
const KIND = { partner: "Partner lender", buyer: "Loan buyer" };

/** The firms LendHous sends deals to or sells loans to, and what each one buys. Accounts come from Members. */
export function PartnersBoard({ accounts }: { accounts: FirmAccount[] }) {
  const { s, local } = useStore();
  const [editing, setEditing] = useState<Firm | null>(null);
  const saved = (kind: Firm["kind"]) => (kind === "partner" ? s.partners : s.buyers);
  const firms = new Map<string, Firm>();
  for (const kind of ["partner", "buyer"] as const) for (const firm of saved(kind)) firms.set(firm.id, { id: firm.id, kind, name: firm.name, emails: [], ndaSigned: firm.ndaSigned, buyBox: firm.buyBox, principals: firm.principals });
  // Demo and sample firms aren't tied to accounts, so only real records list the people behind them.
  if (!local) {
    for (const account of accounts) {
      const firm = firms.get(account.firmId) ?? { id: account.firmId, kind: account.kind, name: account.name, emails: [] };
      firm.emails.push(account.email);
      firms.set(account.firmId, firm);
    }
  }
  const rows = [...firms.values()];
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Money" title="Partners & buyers" lede="The firms you send deals to and sell loans to. Set what each one buys and who owns it: each firm, its owners and its people are screened against the OFAC list when it's saved and every night. To add one, invite them from Members with the Partner lender or Loan buyer role." />
      {editing && <FirmForm firm={editing} onClose={() => setEditing(null)} />}
      {rows.length === 0 && <EmptyState testid="no-firms">No partner lenders or loan buyers yet. Invite one from Members.</EmptyState>}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((firm) => (
          <section key={firm.id} className="glass min-w-0 p-5" data-testid="firm-row">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-semibold wrap-anywhere">{firm.name}</div><div className="text-xs text-muted-foreground">{KIND[firm.kind]}{firm.emails.length ? ` · ${firm.emails.join(", ")}` : ""}</div></div>
              {!firm.buyBox ? <Badge tone="amber">Needs setup</Badge> : firm.ndaSigned ? <Badge tone="green">NDA signed</Badge> : <Badge tone="amber">NDA not signed</Badge>}
            </div>
            {firm.buyBox ? (
              <p className="mt-2 text-sm text-muted-foreground">{firm.buyBox.products.map((product) => productLabel[product]).join(", ")} · {firm.buyBox.states.join("/")} · {usd(firm.buyBox.minLoan)}–{usd(firm.buyBox.maxLoan)} · min FICO {firm.buyBox.minFico} · target yield {firm.buyBox.targetYield}%</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">They see nothing until you set what they buy.</p>
            )}
            {firm.principals?.length ? <p className="mt-1 text-xs text-muted-foreground">Owners and officers: {firm.principals.join(", ")}</p> : firm.buyBox ? <p className="mt-1 text-xs text-warn">Add its owners and officers so they're screened too.</p> : null}
            {(() => { const record = saved(firm.kind).find((item) => item.id === firm.id); return record ? <div className="mt-3 border-t border-border pt-3"><FirmScreening kind={firm.kind} firm={record} /></div> : null; })()}
            {firm.kind === "partner" && s.partners.some((item) => item.id === firm.id) && <DrawFunding partnerId={firm.id} />}
            <button type="button" className="btn-ghost mt-3 h-9! px-3! text-xs!" data-testid="edit-firm" onClick={() => setEditing(firm)}>{firm.buyBox ? "Edit" : "Set up"}</button>
          </section>
        ))}
      </div>
    </div>
  );
}

function FirmForm({ firm, onClose }: { firm: Firm; onClose: () => void }) {
  const { dispatch } = useStore();
  const start = firm.buyBox ?? DEFAULT_BOX;
  const [name, setName] = useState(firm.name);
  const [box, setBox] = useState(start);
  const [states, setStates] = useState(start.states.join(", "));
  const [principals, setPrincipals] = useState((firm.principals ?? []).join("\n"));
  const number = (key: "minLoan" | "maxLoan" | "minFico" | "targetYield", label: string) => (
    <label className="block"><span className="label">{label}</span><input data-testid={`firm-${key}`} className="desk-input" type="number" inputMode="decimal" min={0} value={box[key]} onChange={(event) => setBox({ ...box, [key]: Number(event.target.value) || 0 })} /></label>
  );
  const percent = (key: "maxLTARV" | "maxLTV", label: string) => (
    <label className="block"><span className="label">{label}</span><input className="desk-input" type="number" inputMode="decimal" min={0} max={100} placeholder="No limit" value={box[key] === undefined ? "" : Math.round(box[key]! * 100)} onChange={(event) => setBox({ ...box, [key]: event.target.value === "" ? undefined : Number(event.target.value) / 100 })} /></label>
  );
  const parsedStates = states.split(/[\s,/]+/).map((state) => state.trim().toUpperCase()).filter((state) => /^[A-Z]{2}$/.test(state));
  const save = async () => {
    if (await dispatch({ t: "saveFirm", kind: firm.kind, id: firm.id, name: name.trim(), buyBox: { ...box, states: parsedStates }, principals: principals.split(/\n|;/).map((item) => item.trim()).filter(Boolean).slice(0, 20) })) onClose();
  };
  return (
    <section className="glass min-w-0 p-5" data-testid="firm-form">
      <h2 className="eyebrow">{KIND[firm.kind]}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Firm name</span><input data-testid="firm-name" className="desk-input" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="label">Owners and officers, one per line (screened against the OFAC list)</span><textarea data-testid="firm-principals" className="desk-input min-h-16" maxLength={3200} value={principals} onChange={(event) => setPrincipals(event.target.value)} /></label>
        <fieldset className="sm:col-span-2">
          <legend className="label">Loan types</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(Object.keys(productLabel) as Product[]).map((product) => <label key={product} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={box.products.includes(product)} onChange={(event) => setBox({ ...box, products: event.target.checked ? [...box.products, product] : box.products.filter((item) => item !== product) })} /> {productLabel[product]}</label>)}
          </div>
        </fieldset>
        <label className="block"><span className="label">States</span><input data-testid="firm-states" className="desk-input" placeholder="FL, GA" value={states} onChange={(event) => setStates(event.target.value)} /></label>
        {number("minFico", "Minimum FICO")}
        {number("minLoan", "Smallest loan ($)")}
        {number("maxLoan", "Largest loan ($)")}
        {percent("maxLTARV", "Max LTARV (%)")}
        {percent("maxLTV", "Max LTV (%)")}
        {number("targetYield", "Target yield (%)")}
        <label className="block"><span className="label">Minimum experience tier</span><select className="desk-input" value={box.minTier} onChange={(event) => setBox({ ...box, minTier: Number(event.target.value) as BuyBox["minTier"] })}>{[1, 2, 3, 4].map((tier) => <option key={tier} value={tier}>Tier {tier}</option>)}</select></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" data-testid="save-firm" disabled={!name.trim() || !box.products.length || !parsedStates.length || box.maxLoan < box.minLoan} onClick={() => void save()}>Save</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}

/**
 * How a partner pays for a loan's holdback: all of its share at closing (the default), or its share of each draw as it's
 * released, as its participation agreement says (lib/capital-moves.ts). It applies to loans it's accepted on from then.
 */
function DrawFunding({ partnerId }: { partnerId: string }) {
  const { s, dispatch } = useStore();
  // Shown ticked at once; a save the server refuses puts it back.
  const [pending, setPending] = useState<boolean | null>(null);
  const on = pending ?? Boolean(s.partners.find((item) => item.id === partnerId)?.fundsDraws);
  const change = async (value: boolean) => { setPending(value); await dispatch({ t: "setFundsDraws", partnerId, on: value }); setPending(null); };
  return (
    <label className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-sm" data-testid="funds-draws">
      <input type="checkbox" className="mt-1" checked={on} disabled={pending !== null} onChange={(event) => void change(event.target.checked)} />
      <span>Sends its share of each draw as it&apos;s released<small className="block text-xs text-muted-foreground">Instead of its whole share at closing. LendHous pays the borrower and asks the partner for its share, due in a few business days. For loans accepted from now on.</small></span>
    </label>
  );
}
