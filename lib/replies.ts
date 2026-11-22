// Promised reply times and cover for someone away (borrowers' third complaint: calls never returned, reps "always on
// vacation"). Every message from a borrower or broker shows when they'll hear back, and so does an extension request;
// the team sees what's waiting by age on its queue. Someone away names a backup, who gets their loans' notices and
// queue until they're back, and the borrower sees who's covering.
import type { AwayNotice, Deal, LoanMessage, TeamMember } from "./mockData";
import { TEAM_ROLES, type TeamRole } from "./loan-team";
import { daysBetween } from "./servicing";
import { dueAt, floridaTime, type Targets } from "./sla";

/**
 * The client's oldest message since the team last wrote, or last marked the thread as needing no reply: the wait the reply
 * clock counts from. Null if nothing's waiting.
 */
export function awaitingReply(messages: LoanMessage[], dealId: string, handledAt?: string): { since: string; from: string } | null {
  const after = handledAt ? Date.parse(handledAt) : -Infinity;
  const thread = messages.filter((message) => message.dealId === dealId && message.side !== "internal").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let waiting: LoanMessage | null = null;
  for (const message of thread) {
    if (message.side === "team" || Date.parse(message.at) <= after) waiting = null;
    else if (!waiting) waiting = message;
  }
  return waiting ? { since: waiting.at, from: waiting.from } : null;
}

/** When the team promised to have answered. */
export const replyBy = (since: string, targets: Targets) => dueAt(since, targets.reply);
/** The promise as the borrower reads it: "We'll reply by Tuesday, November 24 at 10:00 AM." */
export const replyLine = (since: string, targets: Targets, now: Date) => {
  const due = replyBy(since, targets);
  return due > now ? `We'll reply by ${floridaTime(due)}.` : "It's past the time we said we'd reply. The team has been reminded.";
};

// Away and cover.

/** PLACEHOLDER: the longest stretch one notice can cover. Longer, and the loans should be reassigned. */
export const AWAY_MAX_DAYS = 45;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const samePerson = (a: Pick<TeamMember, "id" | "email"> | undefined, b: Pick<TeamMember, "id" | "email"> | undefined) => Boolean(a && b && (a.id === b.id || (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase())));

/** This member's notice that covers today, if they're away. */
export const awayToday = (away: AwayNotice[] | undefined, member: Pick<TeamMember, "id" | "email"> | undefined, today: string) => (member ? (away ?? []).find((notice) => samePerson(notice, member) && notice.from <= today && today <= notice.until) : undefined);

/** The loan's people who are away today, each with who covers. */
export function coverOf(deal: Pick<Deal, "team">, away: AwayNotice[] | undefined, today: string): { role: TeamRole; member: TeamMember; notice: AwayNotice }[] {
  return TEAM_ROLES.flatMap((role) => {
    const member = deal.team?.[role];
    const notice = awayToday(away, member, today);
    return member && notice ? [{ role, member, notice }] : [];
  });
}

/** Whose inboxes a loan's team notices also reach while its people are away. */
export const coverEmails = (deal: Pick<Deal, "team"> | undefined, away: AwayNotice[] | undefined, today: string) => (deal ? coverOf(deal, away, today).map((item) => item.notice.backup.email) : []);
/** The viewer covers this loan today for someone away. */
export const covering = (deal: Pick<Deal, "team">, viewer: { id: string; email?: string }, away: AwayNotice[] | undefined, today: string) => coverOf(deal, away, today).some((item) => samePerson(item.notice.backup, { id: viewer.id, email: viewer.email ?? "" }));

/** Why this notice can't be saved, or null. */
export function awayProblem(member: TeamMember | undefined, backup: TeamMember | undefined, from: string, until: string, today: string) {
  if (!member) return "That person isn't on the team.";
  if (!backup) return "Choose who covers while you're away.";
  if (samePerson(member, backup)) return "Someone else has to cover.";
  if (!DAY.test(from) || !DAY.test(until)) return "Choose the first and last days away.";
  if (until < from) return "The last day is before the first.";
  if (until < today) return "Those days have already passed.";
  if (daysBetween(from, until) > AWAY_MAX_DAYS) return `A notice covers at most ${AWAY_MAX_DAYS} days. For longer, give the loans to someone else.`;
  return null;
}

/** Notices still to come or running, soonest first. Past ones drop off. */
export const currentAway = (away: AwayNotice[] | undefined, today: string) => (away ?? []).filter((notice) => notice.until >= today).sort((a, b) => a.from.localeCompare(b.from));
