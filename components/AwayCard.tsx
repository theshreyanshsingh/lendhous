"use client";
import { useEffect, useState } from "react";
import { endAwayNotice, loanTeamOptions, setAwayNotice } from "@/actions/book";
import { DEMO_TEAM, type TeamMember } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { awayProblem, currentAway } from "@/lib/replies";
import { shortDay } from "@/lib/format";
import { useServiceDay } from "@/components/loan/use-service-day";

type Options = { members: TeamMember[]; canAssign: boolean; me: string };
const small = "h-9! px-3! text-xs!";

/**
 * Time away and who covers (lib/replies.ts). While someone's away, their loans' notices also go to the person covering,
 * their work shows in that person's queue, and borrowers see who to call.
 */
export function AwayCard() {
  const { s, local, dispatch, applyReply, viewer, viewerName } = useStore();
  const today = useServiceDay();
  const [options, setOptions] = useState<Options | null>(null);
  const [who, setWho] = useState("");
  const [backup, setBackup] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (local) setOptions({ members: DEMO_TEAM, canAssign: true, me: DEMO_TEAM.find((member) => member.email === viewer.email)?.id ?? DEMO_TEAM[0].id });
    else void loanTeamOptions().then(setOptions).catch(() => setOptions({ members: [], canAssign: false, me: "" }));
  }, [local, viewer.email]);
  if (!options) return null;
  const memberId = who || options.me;
  const member = options.members.find((item) => item.id === memberId);
  const backupMember = options.members.find((item) => item.id === backup);
  const problem = today ? awayProblem(member, backupMember, from, until, today) : "…";
  const notices = today ? currentAway(s.away, today) : [];
  const save = async () => {
    setBusy(true);
    let done: boolean;
    if (local) done = await dispatch({ t: "setAway", member: member!, backup: backupMember!, from, until, by: viewerName });
    else {
      const reply = await setAwayNotice({ memberId, backupId: backup, from, until }).catch(() => ({ error: "That didn't go through. Check your connection and try again." }));
      applyReply(reply);
      done = !reply.error;
    }
    setBusy(false);
    if (done) { setFrom(""); setUntil(""); setBackup(""); }
  };
  const end = async (id: string) => {
    if (local) await dispatch({ t: "endAway", memberId: id, by: viewerName });
    else applyReply(await endAwayNotice(id).catch(() => ({ error: "That didn't go through." })));
  };
  return (
    <section className="glass min-w-0 space-y-3 p-4 sm:p-5" data-testid="away-card">
      <div><h2 className="eyebrow">Time away</h2><p className="mt-1 text-sm text-muted-foreground">Name who covers while you&apos;re out. Your loans&apos; notices reach them too, your work shows in their queue, and borrowers see who to call.</p></div>
      {notices.length > 0 && (
        <ul className="divide-y divide-border text-sm" data-testid="away-list">
          {notices.map((notice) => (
            <li key={notice.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="away-notice">
              <span className="min-w-0">{notice.id === options.me ? "You're" : `${notice.name} is`} away {shortDay(notice.from)} to {shortDay(notice.until)}. {notice.backup.name} covers.</span>
              {(notice.id === options.me || options.canAssign) && <button type="button" className={`btn-ghost ${small}`} data-testid="away-end" onClick={() => void end(notice.id)}>{notice.from <= (today ?? "") ? "Back now" : "Cancel"}</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {options.canAssign && <label className="block min-w-0"><span className="label">Who&apos;s away</span><select className="desk-input" data-testid="away-who" value={memberId} onChange={(event) => setWho(event.target.value)}>{options.members.map((item) => <option key={item.id} value={item.id}>{item.id === options.me ? `${item.name} (you)` : item.name}</option>)}</select></label>}
        <label className="block min-w-0"><span className="label">Who covers</span><select className="desk-input" data-testid="away-backup" value={backup} onChange={(event) => setBackup(event.target.value)}><option value="">Choose someone</option>{options.members.filter((item) => item.id !== memberId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block min-w-0"><span className="label">First day away</span><input type="date" className="desk-input" data-testid="away-from" min={today || undefined} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="block min-w-0"><span className="label">Last day away</span><input type="date" className="desk-input" data-testid="away-until" min={from || today || undefined} value={until} onChange={(event) => setUntil(event.target.value)} /></label>
      </div>
      {from && until && backup && problem && <p className="text-xs text-warn">{problem}</p>}
      <button type="button" className={`btn-primary ${small}`} data-testid="away-save" disabled={Boolean(problem) || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save time away"}</button>
    </section>
  );
}
