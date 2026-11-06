"use client";
import { useEffect, useState } from "react";
import { assignLoan, loanTeamOptions } from "@/actions/book";
import { TEAM_ROLE_LABEL, TEAM_ROLES, type TeamRole } from "@/lib/loan-team";
import { DEMO_TEAM, type Deal, type TeamMember } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { phonePill } from "@/lib/ui-classes";

type Options = { members: TeamMember[]; canAssign: boolean; me: string };

/**
 * The loan's officer and processor, under the loan page's header. Someone with assign_loans picks from the team; anyone
 * else can take an empty seat. A demo book uses the demo team.
 */
export function LoanTeam({ deal }: { deal: Deal }) {
  const { local, dispatch, applyReply, viewerName, viewer } = useStore();
  const [options, setOptions] = useState<Options | null>(null);
  const [busy, setBusy] = useState<TeamRole | "">("");
  useEffect(() => {
    if (local) setOptions({ members: DEMO_TEAM, canAssign: true, me: DEMO_TEAM.find((member) => member.email === viewer.email)?.id ?? "" });
    else void loanTeamOptions().then(setOptions).catch(() => setOptions({ members: [], canAssign: false, me: "" }));
  }, [local, viewer.email]);

  const set = async (role: TeamRole, id: string | null) => {
    setBusy(role);
    if (local) await dispatch({ t: "assignLoanTeam", dealId: deal.id, role, member: id ? options?.members.find((member) => member.id === id) ?? null : null, by: viewerName });
    else applyReply(await assignLoan(deal.id, role, id).catch(() => ({ error: "That didn't go through. Check your connection and try again." })));
    setBusy("");
  };

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="loan-team">
      {TEAM_ROLES.map((role) => {
        const member = deal.team?.[role];
        return (
          <div key={role} className="flex min-w-0 flex-wrap items-center gap-2" data-testid={`team-${role}`}>
            <span className="text-muted-foreground">{TEAM_ROLE_LABEL[role]}:</span>
            {options?.canAssign ? (
              <select className="desk-input h-8! w-auto! max-w-full py-0! text-sm" aria-label={TEAM_ROLE_LABEL[role]} data-testid={`assign-${role}`} value={member?.id ?? ""} disabled={busy === role} onChange={(event) => void set(role, event.target.value || null)}>
                <option value="">Not assigned</option>
                {member && !options.members.some((item) => item.id === member.id) && <option value={member.id}>{member.name}</option>}
                {options.members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            ) : <b className="font-medium" data-testid={`team-${role}-name`}>{member?.name ?? "Not assigned"}</b>}
            {!member && options && !options.canAssign && options.me && <button type="button" className="text-xs text-link underline" data-testid={`take-${role}`} disabled={busy === role} onClick={() => void set(role, options.me)}>I&apos;ll take it</button>}
          </div>
        );
      })}
    </div>
  );
}

const dialable = (phone: string) => phone.replace(/[^\d+]/g, "");
// Links on a desktop; on a phone, buttons a thumb can hit, since calling or texting is what a phone is for.
const reach = `text-link underline ${phonePill}`;

/** How a borrower or broker reaches the people on their loan. */
export function TeamContacts({ deal }: { deal: Deal }) {
  const people = TEAM_ROLES.flatMap((role) => (deal.team?.[role] ? [{ role, member: deal.team[role]! }] : []));
  if (!people.length) return <p className="text-sm text-muted-foreground" data-testid="your-team-pending">A loan officer will be in touch shortly.</p>;
  return (
    <ul className="space-y-3 text-sm" data-testid="your-team">
      {people.map(({ role, member }) => (
        <li key={role} data-testid="your-team-person">
          <div className="text-xs text-muted-foreground">{TEAM_ROLE_LABEL[role]}</div>
          <div className="font-medium">{member.name}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs max-sm:mt-2 max-sm:gap-2">
            {member.phone && <><a className={reach} href={`tel:${dialable(member.phone)}`}>Call {member.phone}</a><a className={reach} href={`sms:${dialable(member.phone)}`}>Text</a></>}
            <a className={reach} href={`mailto:${member.email}`}>Email</a>
          </div>
        </li>
      ))}
    </ul>
  );
}
