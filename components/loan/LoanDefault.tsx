"use client";
import { useState } from "react";
import { cureError, DEFAULT_KINDS, defaultError } from "@/lib/loan-exits";
import type { Deal, DefaultKind } from "@/lib/mockData";
import { defaultInterestFrom, defaultRateOf, ledgerOf, openDefault } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate } from "@/components/ui";
import { useServiceDay } from "./use-service-day";

/**
 * Declaring a default and lifting it (Spec 8.10). Nothing declares one by itself: the nightly check only says when a
 * loan is 90 days past due. The notice of default is the attorney's; this records the decision and starts default interest.
 */
export function LoanDefault({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const open = openDefault(deal);
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState<DefaultKind | "">("");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [note, setNote] = useState("");
  const close = () => { setForm(false); setKind(""); setEffectiveOn(""); setNote(""); };
  if (!today) return null;
  const l = ledgerOf(deal, today);
  // The kind the loan's state points to, offered first.
  const likely: DefaultKind = l.matured ? "maturity" : "monetary";
  const day = effectiveOn || today;
  const refused = kind ? defaultError(deal, kind, day, today) : null;
  const cure = open ? cureError(deal, today) : null;
  const rate = defaultRateOf(deal).toFixed(2);
  const past = (deal.defaults ?? []).filter((item) => item.cured);
  return (
    <Section title="Default" right={open ? <Badge tone="rose">In default</Badge> : undefined}>
      {open ? (
        <div className="space-y-2 text-sm" data-testid="open-default">
          <p><b>{DEFAULT_KINDS[open.kind]}</b>, effective {open.effectiveOn}. Declared by {open.by || "the team"} on {shortDate(open.at)}.</p>
          {open.note && <p className="text-muted-foreground">{open.note}</p>}
          <p className="text-xs text-muted-foreground">Interest runs at the default rate of {rate}% from {defaultInterestFrom(deal)}, and no draws are released while it&apos;s in default.</p>
          {!form ? (
            <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="cure-default" onClick={() => setForm(true)}>Cure the default</button>
          ) : (
            <div className="space-y-2 rounded-[2px] border border-border p-3">
              {cure && <p className="text-xs text-warn" data-testid="cure-blocked">{cure}</p>}
              <label className="block"><span className="label">How it was cured</span><input className="desk-input" data-testid="cure-note" maxLength={1000} placeholder="e.g. Paid all past-due amounts on 11/12" value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" data-testid="confirm-cure" disabled={Boolean(cure) || !note.trim()} onClick={async () => { if (await dispatch({ t: "cureDefault", dealId: deal.id, note: note.trim(), by: viewerName })) close(); }}>Lift the default</button>
                <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : !form ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="min-w-0 flex-1 basis-60 text-muted-foreground">{l.daysPastDue >= 30 || l.matured ? `${l.matured ? "Past maturity" : `${l.daysPastDue} days past due`}. Talk to counsel before declaring a default.` : "Not in default."}</p>
          <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="declare-default" onClick={() => { setForm(true); setKind(likely); }}>Declare default</button>
        </div>
      ) : (
        <div className="space-y-3" data-testid="default-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Kind of default</span><select className="desk-input" data-testid="default-kind" value={kind} onChange={(event) => setKind(event.target.value as DefaultKind)}>{Object.entries(DEFAULT_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="block"><span className="label">Effective date</span><input className="desk-input" data-testid="default-date" type="date" min={deal.closingDate} max={today} value={day} onChange={(event) => setEffectiveOn(event.target.value)} /></label>
          </div>
          <label className="block"><span className="label">Notes (the notice sent, counsel&apos;s advice)</span><textarea className="desk-input min-h-16" data-testid="default-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">The borrower, the team and any partner or buyer holding the loan are told. Send the formal notice of default from the attorney&apos;s template; default interest at {rate}% starts from the effective date.</p>
          {refused && <p className="text-xs text-warn" data-testid="default-blocked">{refused}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-testid="confirm-default" disabled={!kind || Boolean(refused) || !note.trim()} onClick={async () => { if (kind && await dispatch({ t: "declareDefault", dealId: deal.id, kind, effectiveOn: day, note: note.trim(), by: viewerName })) close(); }}>Declare the default</button>
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
          </div>
        </div>
      )}
      {past.length > 0 && <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">{past.map((item) => <li key={item.at}>{DEFAULT_KINDS[item.kind]} from {item.effectiveOn}, cured {shortDate(item.cured!.at)}{item.cured!.note ? `: ${item.cured!.note}` : ""}</li>)}</ul>}
    </Section>
  );
}
