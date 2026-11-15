"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { serviceDay } from "@/lib/book";
import { shortDay } from "@/lib/format";
import type { Deal, SellerContact, SellerNotary } from "@/lib/mockData";
import { CONTACT, methodWords, NOTARY, RED_FLAGS, sellerCheckNeeded, sellerFlags, vacantLand, type SellerInput } from "@/lib/seller-checks";
import { useStore } from "@/lib/store";

const TONE = { stop: "text-bad", warn: "text-warn", note: "text-muted-foreground" } as const;
const blank = (deal: Deal): SellerInput => deal.seller
  ? { name: deal.seller.name, mailingAddress: deal.seller.mailingAddress, absentee: deal.seller.absentee, freeAndClear: deal.seller.freeAndClear, ownedSince: deal.seller.ownedSince, contact: deal.seller.contact, notary: deal.seller.notary, proceeds: deal.seller.proceeds, rushed: deal.seller.rushed, rollLetter: deal.seller.rollLetter }
  : { name: "", mailingAddress: "", absentee: false, freeAndClear: false, contact: "none", notary: "unknown", proceeds: "unknown", rushed: false };

/**
 * Who's selling, on a purchase (lib/seller-checks.ts): what the processor finds in the tax roll, the deed and the
 * contract, what looks like someone posing as the owner, and whether the title company has checked the seller's
 * identity, which a sale of land or by an absent owner with no mortgage needs before it funds.
 */
export function SellerChecks({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName } = useStore();
  const today = serviceDay(s);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SellerInput>(blank(deal));
  const flags = sellerFlags(deal, today);
  const needed = sellerCheckNeeded(deal);
  const verified = deal.closing?.sellerVerified;
  const seller = deal.seller;
  const save = async () => { if (await dispatch({ t: "saveSeller", dealId: deal.id, seller: { ...form, ownedSince: form.ownedSince || undefined, rollLetter: form.rollLetter?.sentOn ? form.rollLetter : undefined }, by: viewerName })) setEditing(false); };
  const select = <T extends string>(label: string, value: T, options: Record<T, string>, set: (value: T) => void, testId: string) => (
    <label className="block min-w-0"><span className="label">{label}</span><select className="desk-input" data-testid={testId} value={value} onChange={(event) => set(event.target.value as T)}>{(Object.entries(options) as [T, string][]).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
  );
  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="seller-checks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Who&apos;s selling</p>
        {!editing && <button type="button" className="text-xs text-link underline" data-testid="seller-edit" onClick={() => { setForm(blank(deal)); setEditing(true); }}>{seller ? "Change" : "Enter the seller"}</button>}
      </div>
      {needed && (
        <p className={verified ? "text-good" : "text-warn"} data-testid="seller-id-status">
          {verified ? `Seller's identity checked: ${methodWords(verified.method)} (${verified.by}, ${shortDay(verified.at.slice(0, 10))}).` : `${vacantLand(deal) ? "Vacant land" : "An owner who lives elsewhere, with no mortgage"}: the title company has to confirm it checked the seller's identity independently before this loan funds. It confirms through its secure link, or the team records its word on the Closing tab.`}
        </p>
      )}
      {flags.length > 0 && <ul className="space-y-0.5" data-testid="seller-flags">{flags.map((flag) => <li key={flag.text} className={TONE[flag.level]}>{flag.text}</li>)}</ul>}
      {seller && !editing && (
        <p className="text-xs text-muted-foreground" data-testid="seller-summary">{seller.name}{seller.mailingAddress ? `, tax bills to ${seller.mailingAddress}` : ""}. Reached: {CONTACT[seller.contact].toLowerCase()}. Notary: {NOTARY[seller.notary].toLowerCase()}. Entered by {seller.by}, {shortDay(seller.at.slice(0, 10))}.</p>
      )}
      {!seller && !editing && <p className="text-xs text-muted-foreground">Enter the seller from the county&apos;s tax roll and the deed, so these checks can run.</p>}
      <Reveal open={editing}>
        <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="seller-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0"><span className="label">Seller, as the tax roll and deed name them</span><input className="desk-input" data-testid="seller-name" maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label className="block min-w-0"><span className="label">Where the tax roll sends the bill</span><input className="desk-input" data-testid="seller-mailing" maxLength={300} value={form.mailingAddress} onChange={(event) => setForm({ ...form, mailingAddress: event.target.value })} /></label>
            <label className="block min-w-0"><span className="label">Seller took title on (from the deed)</span><input className="desk-input" type="date" max={today} data-testid="seller-owned-since" value={form.ownedSince ?? ""} onChange={(event) => setForm({ ...form, ownedSince: event.target.value || undefined })} /></label>
            {select<SellerContact>("How anyone has reached the seller", form.contact, CONTACT, (contact) => setForm({ ...form, contact }), "seller-contact")}
            {select<SellerNotary>("Who notarizes the seller's deed", form.notary, NOTARY, (notary) => setForm({ ...form, notary }), "seller-notary")}
            {select<SellerInput["proceeds"]>("Where the seller's money goes", form.proceeds, { own_account: "An account in the seller's own name", other_account: "Someone else's account, or a company's", unknown: "Not known yet" }, (proceeds) => setForm({ ...form, proceeds }), "seller-proceeds")}
          </div>
          <div className="space-y-1 text-sm">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="seller-absentee" checked={form.absentee} onChange={(event) => setForm({ ...form, absentee: event.target.checked })} /> The tax bill goes somewhere other than the property</label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="seller-free-clear" checked={form.freeAndClear} onChange={(event) => setForm({ ...form, freeAndClear: event.target.checked })} /> No mortgage on record</label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid="seller-rushed" checked={form.rushed} onChange={(event) => setForm({ ...form, rushed: event.target.checked })} /> The seller is pressing for a fast close or an all-cash buyer</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0"><span className="label">Letter to the tax roll&apos;s address sent on (optional)</span><input className="desk-input" type="date" max={today} data-testid="seller-letter-sent" value={form.rollLetter?.sentOn ?? ""} onChange={(event) => setForm({ ...form, rollLetter: event.target.value ? { ...form.rollLetter, sentOn: event.target.value } : undefined })} /></label>
            {form.rollLetter?.sentOn && (
              <label className="block min-w-0"><span className="label">What the owner said</span><select className="desk-input" data-testid="seller-letter-answer" value={form.rollLetter.answer ?? ""} onChange={(event) => setForm({ ...form, rollLetter: { ...form.rollLetter!, answer: (event.target.value || undefined) as "confirmed" | "denied" | undefined, answeredOn: event.target.value ? today : undefined } })}><option value="">No answer yet</option><option value="confirmed">They confirmed they&apos;re selling</option><option value="denied">They say they aren&apos;t selling</option></select></label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="seller-save" disabled={!form.name.trim()} onClick={() => void save()}>Save</button>
            <button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      </Reveal>
      <details className="text-xs text-muted-foreground" data-testid="seller-red-flags">
        <summary className="cursor-pointer">What to watch for on any sale</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{RED_FLAGS.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
    </div>
  );
}
