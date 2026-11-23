"use client";
import { Check, Copy, Lock, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Reveal } from "@/components/motion";
import { agentChecks, agentPolicyProblem, failedChecks, kindName, type AgentPolicyInput, type AgentView } from "@/lib/insurance-agent";
import type { PolicyKind } from "@/lib/mockData";
import { servicingDate } from "@/lib/servicing";

const money = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
const longDay = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const NEED: Record<AgentView["needs"][number]["state"], [string, string]> = { on_file: ["On file", "bg-good/10 text-good"], sent: ["Sent, being checked", "bg-link/10 text-link"], needed: ["Needed", "bg-warn/12 text-warn"], not_needed: ["Not needed", "bg-muted text-muted-foreground"], checking: ["Zone being confirmed", "bg-muted text-muted-foreground"] };
const SENT: Record<AgentView["sent"][number]["status"], [string, string]> = { submitted: ["Being checked", "bg-link/10 text-link"], accepted: ["Accepted", "bg-good/10 text-good"], returned: ["Sent back", "bg-bad/10 text-bad"] };
const building = (kind: PolicyKind) => kind === "hazard" || kind === "builders_risk";

type Draft = { kind: PolicyKind; carrier: string; policy: string; effectiveOn: string; expiresOn: string; coverage: string; wind: "" | "yes" | "no"; program: "" | "nfip" | "private"; namedInsured: string; clause: string };
const blank = (kind: PolicyKind): Draft => ({ kind, carrier: "", policy: "", effectiveOn: "", expiresOn: "", coverage: "", wind: "", program: "", namedInsured: "", clause: "" });
const inputOf = (draft: Draft): AgentPolicyInput => {
  const coverage = Number(draft.coverage.replace(/[$,\s]/g, ""));
  return { kind: draft.kind, carrier: draft.carrier.trim(), policy: draft.policy.trim(), effectiveOn: draft.effectiveOn, expiresOn: draft.expiresOn, coverage: Number.isFinite(coverage) && coverage > 0 ? coverage : undefined, windIncluded: draft.wind === "yes", ...(draft.program ? { program: draft.program } : {}), namedInsured: draft.namedInsured.trim(), clause: draft.clause.trim() };
};

/**
 * The borrower's insurance agent's page for one loan (lib/insurance-agent.ts): the clause to put on the policy, what the
 * loan needs, and a form per policy that checks itself as it's filled in. With no token it's a preview that sends nothing.
 */
export function InsurancePortal({ token, initial, expiresAt }: { token: string | null; initial: AgentView; expiresAt: string }) {
  const [view, setView] = useState(initial);
  const firstNeeded = (next: AgentView) => (next.needs.find((need) => need.state === "needed")?.key === "flood" ? "flood" : next.needs.find((need) => need.state === "needed")?.key === "wind" ? "windstorm" : next.kinds[0]);
  const [draft, setDraft] = useState<Draft>(blank(firstNeeded(initial)));
  const [file, setFile] = useState<File | null>(null);
  // A new file box after each send, so the last file's name doesn't linger in it.
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const today = servicingDate(new Date());
  const input = inputOf(draft);
  const problem = agentPolicyProblem(view, input);
  // The checks only mean something once the dates are in; until then, say what's still needed.
  const checks = draft.effectiveOn && draft.expiresOn ? agentChecks(view, input, today) : [];
  const put = (next: Partial<Draft>) => { setDraft({ ...draft, ...next }); setNotice(""); setError(""); };
  const copy = async () => { await navigator.clipboard.writeText(view.clause).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const send = async () => {
    if (problem || !file) return;
    setBusy(true); setError(""); setNotice("");
    if (!token) {
      const sent = { id: `demo-${Date.now()}`, kind: input.kind, carrier: input.carrier, policy: input.policy, expiresOn: input.expiresOn, at: new Date().toISOString(), status: "submitted" as const, note: "", checks };
      const covers = (key: string) => (key === "property" ? building(input.kind) : key === "wind" ? input.kind === "windstorm" || (building(input.kind) && input.windIncluded) : input.kind === "flood");
      const next = { ...view, sent: [sent, ...view.sent], needs: view.needs.map((need) => (need.state === "needed" && covers(need.key) ? { ...need, state: "sent" as const } : need)) };
      setView(next);
      setBusy(false); setFile(null); setPicked((count) => count + 1); setDraft(blank(firstNeeded(next))); setNotice(`The ${kindName(input.kind).toLowerCase()} policy was sent (preview only: nothing went to LendHous).`);
      return;
    }
    const form = new FormData();
    for (const [key, value] of Object.entries({ kind: draft.kind, carrier: draft.carrier, policy: draft.policy, effectiveOn: draft.effectiveOn, expiresOn: draft.expiresOn, coverage: draft.coverage, windIncluded: draft.wind, program: draft.program, namedInsured: draft.namedInsured, clause: draft.clause })) form.set(key, value);
    form.set("file", file);
    const response = await fetch(`/api/insurance-links/${token}`, { method: "POST", body: form }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { view?: AgentView; error?: string }) : { error: "That didn't upload. Check your connection and try again." };
    setBusy(false);
    if (body.view) { setView(body.view); setFile(null); setPicked((count) => count + 1); setDraft(blank(firstNeeded(body.view))); setNotice(`The ${kindName(input.kind).toLowerCase()} policy was sent. LendHous will check it and tell you if anything needs changing.`); }
    else setError(body.error ?? "That didn't go through.");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground"><div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3"><span className="[&_*]:text-primary-foreground!"><Logo /></span><span className="flex items-center gap-1.5 text-xs opacity-80"><Lock size={12} aria-hidden="true" /> Secure insurance file</span></div></header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6" data-testid="insurance-portal">
        <section className="glass p-5">
          <p className="eyebrow">Insurance for a LendHous loan</p>
          <h1 className="mt-2 text-2xl font-normal tracking-tight">{view.address}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{view.sentBy} opened this page for {view.insured}&apos;s loan {view.loanNumber}. Send the binder or declarations page for each policy below. It works until {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}.</p>
          {!token && <p className="mt-2 text-xs text-warn" data-testid="insurance-preview">This is a preview. Nothing you enter here is sent.</p>}
        </section>

        <section className="glass space-y-3 p-5" data-testid="insurance-clause">
          <h2 className="eyebrow">Put this on every policy</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0"><p className="label">Mortgagee and loss payee</p><pre className="wrap-anywhere whitespace-pre-wrap rounded-[2px] bg-muted p-3 font-sans text-sm" data-testid="insurance-clause-text">{view.clause}</pre><button type="button" className="btn-ghost mt-2 h-9! px-3! text-xs!" onClick={() => void copy()}><Copy size={13} aria-hidden="true" /> {copied ? "Copied" : "Copy the clause"}</button></div>
            <dl className="min-w-0 space-y-2">
              <div><dt className="label">Named insured</dt><dd>{view.insured}</dd></div>
              <div><dt className="label">Insured location</dt><dd>{view.address}</dd></div>
              <div><dt className="label">Loan amount</dt><dd>{money(view.noteAmount)}: building cover should be at least this, or the full cost to rebuild.</dd></div>
              <div><dt className="label">{view.funded ? "Loan matures" : "Closing"}</dt><dd>{longDay(view.funded ? view.maturity : view.closingDate)}</dd></div>
            </dl>
          </div>
          <p className="text-xs text-faint">Placeholder wording until LendHous&apos;s attorney confirms the clause and its mailing address.</p>
        </section>

        <section className="glass space-y-2 p-5" data-testid="insurance-needs">
          <h2 className="eyebrow">What the loan needs</h2>
          <ul className="divide-y divide-border text-sm">
            {view.needs.map((need) => (
              <li key={need.key} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid={`insurance-need-${need.key}`}>
                <span className="min-w-0 flex-1 basis-56"><b className="font-medium">{need.label}</b><span className="block text-xs text-muted-foreground">{need.note}</span></span>
                <span className={`rounded-[2px] px-2 py-0.5 text-xs font-medium ${NEED[need.state][1]}`}>{NEED[need.state][0]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass space-y-3 p-5" data-testid="insurance-send">
          <h2 className="eyebrow">Send a policy</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <label className="block min-w-0"><span className="label">Which policy</span><select className="desk-input" data-testid="agent-kind" value={draft.kind} onChange={(event) => put({ kind: event.target.value as PolicyKind, wind: "", program: "" })}>{view.kinds.map((kind) => <option key={kind} value={kind}>{kindName(kind)}</option>)}</select></label>
            <label className="block min-w-0"><span className="label">Insurance company</span><input className="desk-input" data-testid="agent-carrier" maxLength={160} value={draft.carrier} onChange={(event) => put({ carrier: event.target.value })} /></label>
            <label className="block min-w-0"><span className="label">Policy or binder number</span><input className="desk-input" data-testid="agent-policy" maxLength={160} value={draft.policy} onChange={(event) => put({ policy: event.target.value })} /></label>
            <label className="block min-w-0"><span className="label">{building(draft.kind) ? "Dwelling (building) coverage, $" : "Coverage, $"}</span><input className="desk-input" inputMode="numeric" data-testid="agent-coverage" maxLength={14} value={draft.coverage} onChange={(event) => put({ coverage: event.target.value })} /></label>
            <label className="block min-w-0"><span className="label">Starts</span><input type="date" className="desk-input" data-testid="agent-effective" value={draft.effectiveOn} onChange={(event) => put({ effectiveOn: event.target.value })} /></label>
            <label className="block min-w-0"><span className="label">Ends</span><input type="date" className="desk-input" data-testid="agent-expires" min={draft.effectiveOn || undefined} value={draft.expiresOn} onChange={(event) => put({ expiresOn: event.target.value })} /></label>
          </div>
          {building(draft.kind) && (
            <fieldset className="text-sm"><legend className="label">Does it cover windstorm and hurricane?</legend>
              <div className="flex flex-wrap gap-4"><label className="flex min-h-9 items-center gap-2"><input type="radio" name="agent-wind" data-testid="agent-wind-yes" checked={draft.wind === "yes"} onChange={() => put({ wind: "yes" })} /> Yes, wind is included</label><label className="flex min-h-9 items-center gap-2"><input type="radio" name="agent-wind" data-testid="agent-wind-no" checked={draft.wind === "no"} onChange={() => put({ wind: "no" })} /> No, wind is excluded</label></div>
            </fieldset>
          )}
          {draft.kind === "flood" && <label className="block max-w-xs text-sm"><span className="label">Flood program</span><select className="desk-input" data-testid="agent-program" value={draft.program} onChange={(event) => put({ program: event.target.value as Draft["program"] })}><option value="">Choose…</option><option value="nfip">NFIP (federal)</option><option value="private">Private flood</option></select></label>}
          <label className="block text-sm"><span className="label">Named insured, as the policy shows it</span><input className="desk-input" data-testid="agent-insured" maxLength={160} value={draft.namedInsured} onChange={(event) => put({ namedInsured: event.target.value })} /></label>
          <label className="block text-sm"><span className="label">Mortgagee clause, as the policy prints it</span><textarea className="desk-input h-auto! min-h-20 py-2" data-testid="agent-clause" maxLength={600} value={draft.clause} onChange={(event) => put({ clause: event.target.value })} /></label>
          <label className="block text-sm"><span className="label">The binder or declarations page (PDF or photo)</span><input key={picked} type="file" className="block text-xs" data-testid="agent-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <Reveal open={checks.length > 0}>
            <div className="rounded-[2px] border border-border p-3" data-testid="agent-checks">
              <p className="mb-1 text-xs font-medium">How it checks against the loan</p>
              <ul className="space-y-1 text-xs">
                {checks.map((check) => <li key={`${check.key}-${check.text}`} className={`flex items-start gap-1.5 ${check.ok ? "text-good" : check.soft ? "text-warn" : "text-bad"}`} data-testid={check.ok ? "agent-check-ok" : check.soft ? "agent-check-warn" : "agent-check-fail"}>{check.ok ? <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> : <X size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}<span>{check.text}</span></li>)}
              </ul>
              {failedChecks(checks).length > 0 && <p className="mt-2 text-xs text-muted-foreground">You can still send it, but LendHous will most likely ask for a corrected one.</p>}
            </div>
          </Reveal>
          {problem && (draft.carrier || draft.policy || draft.effectiveOn) && <p className="text-xs text-muted-foreground" data-testid="agent-problem">{problem}</p>}
          {error && <p className="text-xs text-bad" role="alert">{error}</p>}
          {notice && <p className="text-xs text-good" role="status" data-testid="agent-sent">{notice}</p>}
          <button type="button" className="btn-primary w-full sm:w-auto" data-testid="agent-send" disabled={busy || Boolean(problem) || !file} onClick={() => void send()}>{busy ? "Sending…" : "Send this policy"}</button>
        </section>

        {view.sent.length > 0 && (
          <section className="glass space-y-2 p-5" data-testid="insurance-sent">
            <h2 className="eyebrow">What you&apos;ve sent</h2>
            <ul className="divide-y divide-border text-sm">
              {view.sent.map((item) => (
                <li key={item.id} className="space-y-1 py-2" data-testid="agent-sent-item">
                  <div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0"><b className="font-medium">{kindName(item.kind)}</b> · {item.carrier} · {item.policy} · ends {longDay(item.expiresOn)}</span><span className={`rounded-[2px] px-2 py-0.5 text-xs font-medium ${SENT[item.status][1]}`}>{SENT[item.status][0]}</span></div>
                  {item.note && <p className="text-xs text-bad">{item.note}</p>}
                  {item.status === "submitted" && failedChecks(item.checks).length > 0 && <ul className="text-xs text-bad">{failedChecks(item.checks).map((check) => <li key={check.text}>{check.text}</li>)}</ul>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
