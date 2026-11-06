"use client";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui";
import { AGENT_LABEL, agentProblem, agentsMissing, shouldAskAgents, type AgentInput, type AgentRole } from "@/lib/borrower-docs";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const ROLES: AgentRole[] = ["title", "insurance"];
const blank = (): AgentInput => ({ name: "", company: "", email: "", phone: "" });
const askedKey = (dealId: string) => `lendhous-agents-asked:${dealId}`;

function Fields({ role, value, onChange, prefix }: { role: AgentRole; value: AgentInput; onChange: (next: AgentInput) => void; prefix: string }) {
  const field = (key: keyof AgentInput, placeholder: string, type = "text") => <input className="desk-input" type={type} data-testid={`${prefix}-${role}-${key}`} maxLength={160} placeholder={placeholder} aria-label={`${AGENT_LABEL[role]}: ${placeholder}`} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />;
  return <div className="grid gap-2">{field("name", "Agent's name")}{field("company", role === "title" ? "Title or escrow company" : "Agency or carrier")}{field("email", "Email", "email")}{field("phone", "Phone", "tel")}</div>;
}

/**
 * The borrower's title/escrow and insurance agents, so the team can coordinate the closing and the binder with them
 * directly. From the accepted term sheet until closing, a missing one is asked for once each time they sign in.
 */
export function YourAgents({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [editing, setEditing] = useState<AgentRole | null>(null);
  const [drafts, setDrafts] = useState<Record<AgentRole, AgentInput>>({ title: { ...blank(), ...deal.agents?.title }, insurance: { ...blank(), ...deal.agents?.insurance } });
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState(false);
  // Asked once a session: "Not now" holds until they next sign in.
  useEffect(() => { try { if (shouldAskAgents(deal) && !sessionStorage.getItem(askedKey(deal.id))) setPrompt(true); } catch {} }, [deal]);
  const later = () => { try { sessionStorage.setItem(askedKey(deal.id), "1"); } catch {} setPrompt(false); };
  const save = async (roles: AgentRole[]) => {
    const filled = roles.filter((role) => Object.values(drafts[role]).some((value) => value.trim()));
    const problem = filled.map((role) => agentProblem(drafts[role]) && `${AGENT_LABEL[role]}: ${agentProblem(drafts[role])}`).find(Boolean);
    if (!filled.length) return setError("Add at least one agent, or choose Not now.");
    if (problem) return setError(problem);
    setError("");
    for (const role of filled) if (!(await dispatch({ t: "setAgent", dealId: deal.id, role, contact: drafts[role], by: viewerName }))) return;
    setEditing(null);
    if (prompt) later();
  };
  const put = (role: AgentRole) => (next: AgentInput) => setDrafts({ ...drafts, [role]: next });
  return (
    <>
      <Section title="Your agents">
        <div className="space-y-4 text-sm" data-testid="agents-card">
          <p className="text-xs text-muted-foreground">Who handles the title and escrow, and your insurance, so we can coordinate with them directly.</p>
          {ROLES.map((role) => {
            const saved = deal.agents?.[role];
            return (
              <div key={role} className="space-y-2" data-testid={`agent-${role}`}>
                <h3 className="text-sm font-medium">{AGENT_LABEL[role]}</h3>
                {saved && editing !== role ? (
                  <div data-testid={`agent-${role}-saved`}>
                    <p>{[saved.name, saved.company].filter(Boolean).join(", ")}</p>
                    <p className="text-xs text-muted-foreground">{[saved.email, saved.phone].filter(Boolean).join(" · ")}</p>
                    <button type="button" className="mt-1 min-h-9 text-xs text-link underline underline-offset-2" onClick={() => setEditing(role)}>Change</button>
                  </div>
                ) : editing !== role ? (
                  // Nothing on file: one button, not four empty boxes.
                  <button type="button" className="btn-ghost h-10! w-full justify-start! px-3! text-sm! sm:w-auto" data-testid={`agent-${role}-add`} onClick={() => { setError(""); setEditing(role); }}>+ Add your {role === "title" ? "title or escrow agent" : "insurance agent"}</button>
                ) : (
                  <>
                    <Fields role={role} value={drafts[role]} onChange={put(role)} prefix="agent" />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-primary h-10! px-4! text-sm! max-sm:flex-1" data-testid={`agent-${role}-save`} onClick={() => void save([role])}>Save the {role === "title" ? "title agent" : "insurance agent"}</button>
                      <button type="button" className="btn-ghost h-10! px-4! text-sm!" onClick={() => { setError(""); setEditing(null); }}>Cancel</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {error && !prompt && <p className="text-xs text-bad" role="alert">{error}</p>}
        </div>
      </Section>
      {prompt && (
        // A sheet from the foot of the screen on a phone, under the thumb; a box in the middle on a desktop.
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 max-sm:place-items-end max-sm:p-0" data-testid="agents-prompt">
          <div role="dialog" aria-modal="true" aria-labelledby="agents-prompt-title" className="glass max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 shadow-[var(--shadow)] max-sm:max-h-[88dvh] max-sm:rounded-t-[14px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="flex items-start justify-between gap-3">
              <h2 id="agents-prompt-title" className="font-heading text-xl font-normal">Who are your title/escrow and insurance agents?</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Close" onClick={later}>×</button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">We coordinate the closing and the insurance binder directly with them, so we need a name and a phone or email for each.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {agentsMissing(deal).map((role) => <div key={role} className="rounded-[2px] border border-border bg-muted/30 p-3"><h3 className="mb-2 text-sm font-medium">{AGENT_LABEL[role]}</h3><Fields role={role} value={drafts[role]} onChange={put(role)} prefix="prompt" /></div>)}
            </div>
            {error && <p className="mt-3 text-sm text-bad" role="alert" data-testid="agents-prompt-error">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button type="button" className="btn-ghost max-sm:h-11 max-sm:flex-1" data-testid="agents-prompt-later" onClick={later}>Not now</button>
              <button type="button" className="btn-primary max-sm:h-11 max-sm:flex-1" data-testid="agents-prompt-save" onClick={() => void save(agentsMissing(deal))}>Save</button>
            </div>
            <p className="mt-2 text-xs text-faint">Don&apos;t have one yet? Close this for now; we&apos;ll ask again the next time you sign in until both are on file.</p>
          </div>
        </div>
      )}
    </>
  );
}
