// Roles and permissions (Spec v3 Section 1 and 10.1). The matrix below is the default; RolePermission rows in the
// database override single cells ("Underwriter can issue term sheets up to $X"). MongoDB has no row-level security,
// so every server action checks `can()` here, and loan queries in B1 go through one scoped data layer.
import type { RoleCode } from "@prisma/client";

export const ROLE_LABEL: Record<RoleCode, string> = {
  BORROWER: "Borrower",
  GUARANTOR: "Guarantor",
  ADMIN_OWNER: "Admin (owner)",
  UNDERWRITER: "Underwriter",
  PROCESSOR: "Loan processor",
  CAPITAL_MANAGER: "Capital manager",
  SERVICER: "Servicer",
  DRAW_ADMIN: "Draw admin",
  INSPECTOR: "Draw inspector",
  PARTNER_LENDER: "Partner lender",
  LOAN_BUYER: "Loan buyer",
  BROKER: "Broker",
  CLOSING_AGENT: "Title / closing agent",
  AUDITOR: "Auditor (read-only)",
};

export const STAFF_ROLES: ReadonlySet<RoleCode> = new Set(["ADMIN_OWNER", "UNDERWRITER", "PROCESSOR", "CAPITAL_MANAGER", "SERVICER", "DRAW_ADMIN", "INSPECTOR", "AUDITOR"]);
// Spec v3 10.1: required for all staff, partner, and broker users. Closing agents use a magic link plus a code instead.
// Loan buyers see loan files and wire money, so they count with the partners.
export const MFA_ROLES: ReadonlySet<RoleCode> = new Set([...STAFF_ROLES, "PARTNER_LENDER", "LOAN_BUYER", "BROKER"]);

export const PERMISSIONS = {
  view_pipeline: "See every deal in the pipeline",
  view_credit: "See credit reports",
  reveal_sensitive: "Reveal full SSN, DOB, EIN and bank numbers (logged)",
  review_documents: "Accept or reject documents",
  manage_conditions: "Add, clear and waive conditions",
  issue_term_sheet: "Issue term sheets (up to the limit)",
  approve_matrix_exception: "Approve exceptions to the pricing matrix",
  manage_pricing: "Edit and publish pricing matrices",
  route_capital: "Route deals and manage partner bids",
  manage_capital: "Manage capital sources and allocations",
  approve_funding: "Approve a loan funding (always one of two approvers)",
  approve_draw: "Approve draws (second approver above the threshold)",
  assign_inspection: "Assign draw inspections",
  service_loans: "Record payments, statements and payoffs",
  waive_fee: "Waive fees (reason required)",
  manage_users: "Invite users and assign roles",
  manage_roles: "Change the permission matrix",
  view_audit: "Read the audit log",
} as const;
export type Permission = keyof typeof PERMISSIONS;

export type Grant = { enabled: boolean; limitCents?: number | null };
type Matrix = Partial<Record<RoleCode, Partial<Record<Permission, Grant>>>>;

const on: Grant = { enabled: true };
const all = Object.fromEntries((Object.keys(PERMISSIONS) as Permission[]).map((key) => [key, on])) as Record<Permission, Grant>;

// PLACEHOLDER defaults, like the pricing matrix: GT replaces the limits.
export const DEFAULT_MATRIX: Matrix = {
  ADMIN_OWNER: all,
  UNDERWRITER: { view_pipeline: on, view_credit: on, review_documents: on, manage_conditions: on, issue_term_sheet: { enabled: true, limitCents: 150_000_000 }, route_capital: on, approve_funding: on, approve_draw: on },
  PROCESSOR: { view_pipeline: on, review_documents: on, manage_conditions: on },
  CAPITAL_MANAGER: { view_pipeline: on, route_capital: on, manage_capital: on, approve_funding: on },
  SERVICER: { view_pipeline: on, service_loans: on, waive_fee: on },
  DRAW_ADMIN: { approve_draw: on, assign_inspection: on },
  AUDITOR: { view_pipeline: on, view_audit: on },
};

export function grantFor(roles: readonly RoleCode[], permission: Permission, overrides: { role: RoleCode; permission: string; enabled: boolean; limitCents: number | null }[] = []): Grant {
  let best: Grant = { enabled: false };
  for (const role of roles) {
    const row = overrides.find((item) => item.role === role && item.permission === permission);
    const grant = row ? { enabled: row.enabled, limitCents: row.limitCents } : DEFAULT_MATRIX[role]?.[permission];
    if (!grant?.enabled) continue;
    // Across several roles the most generous grant wins: no limit beats any limit, otherwise the higher limit.
    if (!best.enabled) best = grant;
    else if (best.limitCents == null) continue;
    else if (grant.limitCents == null || grant.limitCents > best.limitCents) best = grant;
  }
  return best;
}

/** One person's changes to what their roles allow, from the members page. */
export type MemberAccess = { extraPermissions?: readonly string[]; deniedPermissions?: readonly string[] };

export function can(roles: readonly RoleCode[], permission: Permission, options: { amountCents?: number; overrides?: Parameters<typeof grantFor>[2]; member?: MemberAccess } = {}) {
  if (options.member?.deniedPermissions?.includes(permission)) return false;
  const grant = grantFor(roles, permission, options.overrides);
  // A permission given to one person has no dollar limit of its own. A limit from their role still applies below.
  if (!grant.enabled) return Boolean(options.member?.extraPermissions?.includes(permission));
  if (options.amountCents !== undefined && grant.limitCents != null) return options.amountCents <= grant.limitCents;
  return true;
}

export const isStaff = (roles: readonly RoleCode[]) => roles.some((role) => STAFF_ROLES.has(role));
export const needsMfa = (roles: readonly RoleCode[]) => roles.some((role) => MFA_ROLES.has(role));
export const loginCodeRequired = (roles: readonly RoleCode[], settings: { requireStaffMfa: boolean }) => needsMfa(roles) && settings.requireStaffMfa;

export type View = "admin" | "partner" | "buyer" | "borrower";
export const VIEW_HOME: Record<View, string> = { admin: "/admin", partner: "/admin/partner", buyer: "/admin/buyer", borrower: "/admin/borrower" };

/** The workspace an account opens. Staff outrank partner lenders, then loan buyers, then borrowers. */
export function viewFor(roles: readonly RoleCode[]): View | null {
  if (isStaff(roles)) return "admin";
  if (roles.includes("PARTNER_LENDER")) return "partner";
  if (roles.includes("LOAN_BUYER")) return "buyer";
  if (roles.includes("BORROWER")) return "borrower";
  return null;
}

export function homeFor(roles: readonly RoleCode[]) {
  const view = viewFor(roles);
  return view ? VIEW_HOME[view] : "/admin/account/security";
}
