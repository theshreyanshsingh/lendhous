"use client";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { Badge } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { ACCREDITED_HOW, BASIS, defaultExpiry, ENTITY, INVESTOR_RULES, statusState, type StatusInput } from "@/lib/investor-status";
import type { InvestorBasis, InvestorChecks, InvestorEntity } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const STATE = {
  missing: ["Not certified", "amber"], current: ["Current", "green"], expiring: ["Runs out soon", "amber"], expired: ["Ran out", "rose"],
  noninstitutional: ["Not institutional", "rose"], unverified: ["Needs verifying", "amber"],
} as const;
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * What kind of investor a partner or buyer is (lib/investor-status.ts). The firm certifies it on its own page, signing
 * with its name; the team records it from Partners & buyers, verified (saying who verified it) or on the firm's word.
 * Until it's on file and current, no teaser goes to the firm and no bid, offer or share from it is taken.
 */
export function InvestorStatusPanel({ kind, firm, side }: { kind: "partner" | "buyer"; firm: InvestorChecks & { id: string; name: string }; side: "team" | "firm" }) {
  const { s, dispatch, viewerName } = useStore();
  const today = serviceDay(s);
  const status = firm.investorStatus;
  const state = statusState(firm, today);
  const [open, setOpen] = useState(side === "firm" && (state === "missing" || state === "expired"));
  const blank = (): StatusInput => ({ entity: status?.entity ?? "llc", basis: status?.basis ?? "accredited_investor", how: status?.how, foreignPrincipal: status?.foreignPrincipal, evidence: side === "firm" ? "self_certified" : status?.evidence ?? "verified", verifiedBy: "", on: today, expiresOn: defaultExpiry(today), signedName: "" });
  const [form, setForm] = useState<StatusInput>(blank);
  const save = async () => {
    const input = side === "firm" ? { ...form, evidence: "self_certified" as const, on: today, expiresOn: defaultExpiry(today) } : form;
    if (await dispatch({ t: "saveInvestorStatus", kind, firmId: firm.id, status: input, by: viewerName })) setOpen(false);
  };
  const ready = (form.basis !== "accredited_investor" || Boolean(form.how)) && (side === "team" ? form.evidence === "self_certified" || Boolean(form.verifiedBy?.trim()) : Boolean(form.signedName?.trim()));
  return (
    <div className="space-y-2 text-sm" data-testid={`investor-status-${side}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{side === "firm" ? "Your firm's investor status" : "Investor status"}</p>
        <Badge tone={STATE[state][1]}>{STATE[state][0]}</Badge>
      </div>
      {status ? (
        <p className="text-xs text-muted-foreground" data-testid="investor-status-summary">{ENTITY[status.entity]}. {BASIS[status.basis]}{status.how ? `: ${ACCREDITED_HOW[status.how]?.toLowerCase()}` : ""}. {status.evidence === "verified" ? `Verified by ${status.verifiedBy}` : `On ${status.signedName ? `${status.signedName}'s` : "the firm's"} word`}, {longDay(status.on)}; good through {longDay(status.expiresOn)}.</p>
      ) : (
        <p className="text-xs text-muted-foreground">{side === "firm" ? "Under Florida law LendHous may sell a loan, or a share of one, only to an institutional investor. Say which kind your firm is before LendHous can send you deals or take your bids and offers." : "Nothing on file. No teaser goes to this firm, and no bid, offer or share from it is taken, until it's certified."}</p>
      )}
      {status?.foreignPrincipal && <p className="text-xs text-warn" data-testid="investor-foreign-note">A foreign principal from a country of concern under Florida&apos;s SB 264: if it takes a property at foreclosure, it has to sell it within 3 years. Ask the attorney before it holds a loan that may end there.</p>}
      {state === "noninstitutional" && <p className="text-xs text-bad">Not an institutional investor under Fla. Stat. 494.001: selling it a loan or a share is licensed activity. Ask the attorney before doing business with it.</p>}
      {(state === "expiring" || state === "expired") && <p className="text-xs text-warn">{state === "expired" ? "It ran out" : "It runs out soon"}: {side === "firm" ? "certify again to keep receiving deals." : "ask the firm to certify again, or record a new verification."}</p>}
      {!open && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="investor-status-open" onClick={() => { setForm(blank()); setOpen(true); }}>{status ? (side === "firm" ? "Certify again" : "Record a new status") : side === "firm" ? "Certify your firm's status" : "Record its status"}</button>}
      <Reveal open={open}>
        <div className="space-y-3 rounded-[2px] border border-border p-3" data-testid="investor-status-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0"><span className="label">{side === "firm" ? "Your firm is" : "The firm is"}</span><select className="desk-input" data-testid="investor-entity" value={form.entity} onChange={(event) => setForm({ ...form, entity: event.target.value as InvestorEntity })}>{(Object.entries(ENTITY) as [InvestorEntity, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="block min-w-0"><span className="label">And qualifies as</span><select className="desk-input" data-testid="investor-basis" value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value as InvestorBasis })}>{(Object.entries(BASIS) as [InvestorBasis, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {form.basis === "accredited_investor" && (
              <label className="block min-w-0 sm:col-span-2"><span className="label">Because</span><select className="desk-input" data-testid="investor-how" value={form.how ?? ""} onChange={(event) => setForm({ ...form, how: event.target.value || undefined })}><option value="">Choose the test it meets</option>{Object.entries(ACCREDITED_HOW).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            )}
            {side === "team" && (
              <>
                <label className="block min-w-0"><span className="label">On what</span><select className="desk-input" data-testid="investor-evidence" value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value as StatusInput["evidence"] })}><option value="verified">Verified: a letter or a verification service</option><option value="self_certified">The firm&apos;s own word, signed</option></select></label>
                {form.evidence === "verified" && <label className="block min-w-0"><span className="label">Verified by, and the letter&apos;s date</span><input className="desk-input" data-testid="investor-verified-by" maxLength={300} value={form.verifiedBy ?? ""} onChange={(event) => setForm({ ...form, verifiedBy: event.target.value })} /></label>}
                <label className="block min-w-0"><span className="label">Certified or verified on</span><input className="desk-input" type="date" max={today} data-testid="investor-on" value={form.on} onChange={(event) => setForm({ ...form, on: event.target.value, expiresOn: event.target.value ? defaultExpiry(event.target.value) : form.expiresOn })} /></label>
                <label className="block min-w-0"><span className="label">Good through</span><input className="desk-input" type="date" min={form.on} data-testid="investor-expires" value={form.expiresOn} onChange={(event) => setForm({ ...form, expiresOn: event.target.value })} /></label>
              </>
            )}
            {(side === "firm" || form.evidence === "self_certified") && <label className="block min-w-0 sm:col-span-2"><span className="label">{side === "firm" ? "Type your name to sign for your firm" : "Who signed for the firm"}</span><input className="desk-input" data-testid="investor-signed" maxLength={120} value={form.signedName ?? ""} onChange={(event) => setForm({ ...form, signedName: event.target.value })} /></label>}
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="investor-foreign" checked={Boolean(form.foreignPrincipal)} onChange={(event) => setForm({ ...form, foreignPrincipal: event.target.checked || undefined })} /> {side === "firm" ? "Your firm is" : "The firm is"} organized in, run from or owned by someone domiciled in China, Russia, Iran, North Korea, Cuba, Venezuela or Syria</label>
          {side === "firm" && <p className="text-xs text-muted-foreground">You certify this is true for {firm.name}, and you&apos;ll tell LendHous if it changes. It&apos;s good for {INVESTOR_RULES.months} months.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="investor-save" disabled={!ready} onClick={() => void save()}>{side === "firm" ? "Sign and certify" : "Save"}</button>
            <button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
