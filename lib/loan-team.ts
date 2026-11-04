// Who works each loan: its loan officer and processor. Pure, so the pipeline, the loan page, the alerts and the
// reports agree on whose loan it is.
import type { Deal, TeamMember } from "./mockData";
import { PRE_FUNDING } from "./loan-exits";

export const TEAM_ROLES = ["officer", "processor"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { officer: "Loan officer", processor: "Processor" };

type Person = { id: string; email?: string };
const same = (member: TeamMember | undefined, person: Person) => Boolean(member && (member.id === person.id || (person.email && member.email.toLowerCase() === person.email.toLowerCase())));

/** The viewer is the loan's officer or processor. The demo book's people aren't accounts, so it matches by email too. */
export const isMine = (deal: Deal, viewer: Person) => TEAM_ROLES.some((role) => same(deal.team?.[role], viewer));
/** An open application nobody has taken as its loan officer. */
export const needsOfficer = (deal: Deal) => PRE_FUNDING.includes(deal.status) && !deal.team?.officer;
/** Who else hears about a loan, besides the owners: its officer and processor. */
export const teamEmails = (deal: Deal | undefined) => (deal ? TEAM_ROLES.flatMap((role) => (deal.team?.[role]?.email ? [deal.team[role]!.email] : [])) : []);
export const initialsOf = (name: string) => name.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");

/** Why this person can't take that seat on the loan, or null. */
export function assignProblem(deal: Deal, role: TeamRole, member: TeamMember | null) {
  if (!member) return deal.team?.[role] ? null : `There's no ${TEAM_ROLE_LABEL[role].toLowerCase()} to remove.`;
  if (!member.name.trim() || !member.email.trim()) return "That person's account is missing a name or email.";
  if (deal.team?.[role]?.id === member.id) return `${member.name} is already the ${TEAM_ROLE_LABEL[role].toLowerCase()}.`;
  return null;
}
