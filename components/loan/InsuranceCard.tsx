"use client";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Reveal } from "@/components/motion";
import { Section } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { kindsFor, policiesOf, POLICY_KINDS, policyWord, renewalProblem } from "@/lib/insurance";
import { insuranceWarnings } from "@/lib/florida-insurance";
import type { Deal, PolicyKind } from "@/lib/mockData";
import { daysBetween } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

/**
 * The property's insurance as the borrower sees it on a funded loan: each policy and when it ends, and a way to send the
 * renewal (the declarations page) before it does. The team checks it names LendHous before it counts.
 */
export function InsuranceCard({ deal }: { deal: Deal }) {
  const { uploadRenewal } = useStore();
  const today = useServiceDay();
  const ahead = today ? insuranceWarnings(deal, policiesOf(deal), today, 0).filter((warning) => warning.key === "citizens-renewal" || (warning.key.startsWith("nfip-") && warning.key !== "nfip-unknown")) : [];
  const policies = policiesOf(deal);
  const renewals = deal.insurance?.renewals ?? [];
  const soonest = [...policies].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({ kind: (soonest?.kind ?? kindsFor(deal)[0]) as PolicyKind, carrier: soonest?.carrier ?? "", policy: "", expiresOn: "" }));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const choose = (kind: PolicyKind) => setDraft({ ...draft, kind, carrier: policies.find((item) => item.kind === kind)?.carrier ?? draft.carrier });
  const send = async () => {
    const problem = today ? renewalProblem(deal, draft, today) : null;
    if (problem) return setError(problem);
    if (!file) return setError("Choose the policy's declarations page.");
    setError(""); setBusy(true);
    const ok = await uploadRenewal(deal.id, draft, file);
    setBusy(false);
    if (!ok) return;
    setSent(`Thanks. We'll check the ${policyWord(draft.kind)} policy and let you know.`);
    setOpen(false); setFile(null); setDraft({ ...draft, policy: "", expiresOn: "" });
    if (input.current) input.current.value = "";
  };
  return (
    <Section title="Insurance">
      <div className="space-y-3 text-sm" data-testid="borrower-insurance">
        <p className="text-xs text-muted-foreground">Your loan needs the property insured, with LendHous named as mortgagee, until it&apos;s paid off. Send each renewal before the old policy ends.</p>
        {policies.length ? (
          <ul className="divide-y divide-border">
            {policies.map((policy) => {
              const days = today ? daysBetween(today, policy.expiresOn) : null;
              return (
                <li key={policy.kind} className="flex items-baseline justify-between gap-3 py-2" data-testid="borrower-policy">
                  <span className="min-w-0"><span className="font-medium">{POLICY_KINDS[policy.kind]}</span><span className="block text-xs text-muted-foreground">{policy.carrier}</span></span>
                  <span className={`shrink-0 text-right text-xs ${days !== null && days < 0 ? "font-semibold text-bad" : days !== null && days <= 30 ? "text-warn" : "text-muted-foreground"}`}>{days !== null && days < 0 ? `Ended ${shortDay(policy.expiresOn)}` : `Ends ${shortDay(policy.expiresOn)}`}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-muted-foreground">We don&apos;t have a policy on file yet. Send yours below.</p>}
        {/* What the borrower can act on: Citizens' flood requirement at renewal and the NFIP's date (lib/florida-insurance.ts). */}
        {ahead.map((warning) => <p key={warning.key} className="text-xs text-warn" data-testid={`borrower-insurance-${warning.key}`}>{warning.text.replace(/ Ask the borrower for a flood quote now\./, " Get a flood quote now, so it's in place by then.").replace(/Line up a private flood policy/, "Get a private flood policy")}</p>)}
        {renewals.slice(-3).reverse().map((renewal) => (
          <p key={renewal.id} className={`text-xs ${renewal.status === "returned" ? "text-bad" : "text-muted-foreground"}`} data-testid="renewal-status">
            {renewal.status === "submitted" ? `We're checking the ${policyWord(renewal.kind)} renewal you sent on ${shortDay(renewal.at.slice(0, 10))}.` : renewal.status === "accepted" ? `The ${policyWord(renewal.kind)} renewal is on file, through ${shortDay(renewal.expiresOn)}.` : `We sent back the ${policyWord(renewal.kind)} renewal: ${renewal.decided?.note ?? ""} Please send a corrected one.`}
          </p>
        ))}
        {sent && <p className="text-xs text-good" role="status" data-testid="renewal-sent">✓ {sent}</p>}
        {!open && <button type="button" className="btn-ghost h-11! w-full px-4! text-sm! sm:w-auto" data-testid="send-renewal" onClick={() => { setSent(""); setOpen(true); }}>Send a renewal</button>}
        <Reveal open={open}>
          <div className="space-y-2" data-testid="renewal-form">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block min-w-0"><span className="label">Which policy</span><select className="desk-input" data-testid="renewal-kind" value={draft.kind} onChange={(event) => choose(event.target.value as PolicyKind)}>{kindsFor(deal).map((kind) => <option key={kind} value={kind}>{POLICY_KINDS[kind]}</option>)}</select></label>
              <label className="block min-w-0"><span className="label">Insurance company</span><input className="desk-input" data-testid="renewal-carrier" maxLength={160} value={draft.carrier} onChange={(event) => setDraft({ ...draft, carrier: event.target.value })} /></label>
              <label className="block min-w-0"><span className="label">Policy number</span><input className="desk-input" data-testid="renewal-policy" maxLength={120} value={draft.policy} onChange={(event) => setDraft({ ...draft, policy: event.target.value })} /></label>
              <label className="block min-w-0"><span className="label">The new policy ends on</span><input className="desk-input" type="date" data-testid="renewal-expires" min={today || undefined} value={draft.expiresOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} /></label>
            </div>
            <label className="block"><span className="label">The declarations page (PDF or a photo)</span><input ref={input} type="file" accept="application/pdf,image/*" className="block w-full text-sm" data-testid="renewal-file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            {error && <p className="text-xs text-bad" role="alert">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary h-11! px-4! text-sm! max-sm:flex-1" data-testid="submit-renewal" disabled={busy} onClick={() => void send()}>{busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Sending…</> : "Send it"}</button>
              <button type="button" className="btn-ghost h-11! px-4! text-sm!" onClick={() => { setError(""); setOpen(false); }}>Cancel</button>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
