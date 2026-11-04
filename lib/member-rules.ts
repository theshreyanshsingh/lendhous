// The rules behind the members page, kept free of database code so the page's picker and the server check the same way.
import type { RoleCode } from "@prisma/client";
import { can, PERMISSIONS, STAFF_ROLES, type MemberAccess, type Permission } from "@/lib/permissions";

export const ROLE_GROUPS: { label: string; roles: RoleCode[] }[] = [
  { label: "Team", roles: ["ADMIN_OWNER", "UNDERWRITER", "PROCESSOR", "CAPITAL_MANAGER", "SERVICER", "DRAW_ADMIN", "INSPECTOR", "AUDITOR"] },
  { label: "Outside firms", roles: ["PARTNER_LENDER", "LOAN_BUYER", "BROKER", "CLOSING_AGENT"] },
  { label: "Clients", roles: ["BORROWER", "GUARANTOR"] },
];
const ALL_ROLES: RoleCode[] = ROLE_GROUPS.flatMap((group) => group.roles);
export const isRole = (value: string): value is RoleCode => ALL_ROLES.includes(value as RoleCode);

export const PERMISSION_GROUPS: { label: string; items: Permission[] }[] = [
  { label: "Deals", items: ["view_pipeline", "view_credit", "reveal_sensitive", "review_documents", "manage_conditions", "waive_conditions", "issue_term_sheet", "approve_matrix_exception", "clear_ofac"] },
  { label: "Money", items: ["manage_pricing", "route_capital", "manage_capital", "approve_funding", "approve_draw", "override_draw_holds", "assign_inspection", "service_loans", "waive_fee", "declare_default", "approve_extension"] },
  { label: "Administration", items: ["manage_users", "manage_roles", "view_audit", "view_reports"] },
];
const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isOwner = (roles: readonly RoleCode[]) => roles.includes("ADMIN_OWNER");

/**
 * The workspace a role opens. Team roles share one and can be combined. Every other role has its own, and an account
 * opens only one, with team roles first: a borrower who is also a processor would never see the borrower side.
 */
export const workspaceOf = (role: RoleCode) => (STAFF_ROLES.has(role) ? "team" : role === "GUARANTOR" ? "BORROWER" : role);
export const mixesWorkspaces = (roles: readonly RoleCode[]) => new Set(roles.map(workspaceOf)).size > 1;

/** The picker's next roles: a role from another workspace replaces the selection instead of joining it. */
export function pickRole(roles: readonly RoleCode[], role: RoleCode): RoleCode[] {
  if (roles.includes(role)) return roles.filter((item) => item !== role);
  return roles.length && workspaceOf(roles[0]) !== workspaceOf(role) ? [role] : [...roles, role];
}

/** Every permission this person holds, from their roles and any change made just for them. */
export const accessFor = (roles: readonly RoleCode[], member: MemberAccess = {}) => ALL_PERMISSIONS.filter((permission) => can(roles, permission, { member }));

/** Turns the ticked permissions into what is stored: only the differences from the roles. An owner has everything. */
export function accessChanges(roles: readonly RoleCode[], ticked: readonly string[]) {
  if (isOwner(roles)) return { extraPermissions: [], deniedPermissions: [] };
  const defaults = accessFor(roles);
  return {
    extraPermissions: ALL_PERMISSIONS.filter((permission) => ticked.includes(permission) && !defaults.includes(permission)),
    deniedPermissions: defaults.filter((permission) => !ticked.includes(permission)),
  };
}

export type Actor = MemberAccess & { id: string; roleCodes: RoleCode[] };
type Target = MemberAccess & { id: string; roles: readonly RoleCode[] };
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item) => b.includes(item));

/** Why this person can't remove the target, or null when they can. */
export function removeError(actor: Actor, target: Target) {
  if (actor.id === target.id) return "You can't remove your own account.";
  if (!isOwner(actor.roleCodes) && isOwner(target.roles)) return "Only an owner can remove an owner.";
  return null;
}

/** Why this person can't give these roles and permissions, or null when they can. target is null for a new member. */
export function accessError(actor: Actor, target: Target | null, next: { roles: readonly RoleCode[] } & MemberAccess) {
  if (!next.roles.length) return "Choose at least one role.";
  // Only when roles change, so an account set up before this rule can still get a password link.
  if ((!target || !same(next.roles, target.roles)) && mixesWorkspaces(next.roles)) return "Team roles can't be combined with a borrower, broker, partner or buyer role: each opens its own workspace. Use a second email address for the other one.";
  if (target && actor.id === target.id) return same(next.roles, target.roles) && same(accessFor(next.roles, next), accessFor(target.roles, target)) ? null : "You can't change your own access. Ask another admin.";
  if (isOwner(actor.roleCodes)) return null;
  if (isOwner(next.roles) || (target && isOwner(target.roles))) return "Only an owner can add or change an owner.";
  // Without this, anyone who can manage users could give a friend access they don't have themselves.
  const mine = accessFor(actor.roleCodes, actor);
  if (accessFor(next.roles, next).some((permission) => !mine.includes(permission))) return "You can't give access you don't have yourself.";
  return null;
}
