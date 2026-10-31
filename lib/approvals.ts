// Dual control (Spec v3 Section 1, 3.2 approval, 10.4). The app checks the rules first so people get a clear message;
// the Approval collection validator (lib/mongo-validators.ts) rejects the same mistakes if a bug slips past.
import type { ApprovalDecision, ApprovalStatus, ApprovalSubject, RoleCode } from "@prisma/client";
import { audit } from "@/lib/audit";
import { can, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const PERMISSION_FOR: Record<ApprovalSubject, Permission> = {
  FUNDING: "approve_funding",
  DRAW: "approve_draw",
  DISTRIBUTION: "manage_capital",
  MATRIX_EXCEPTION: "approve_matrix_exception",
  TERM_SHEET_OVER_LIMIT: "approve_matrix_exception",
  EXTENSION: "issue_term_sheet",
  FEE_WAIVER: "waive_fee",
  COI_OVERRIDE: "approve_draw",
  CHARGE_OFF: "approve_funding",
  GUARANTOR_RELEASE: "approve_funding",
  WIRE_CHANGE: "approve_funding",
};

export class ApprovalError extends Error {}

export type Approver = { id: string; roles: RoleCode[]; extraPermissions?: string[]; deniedPermissions?: string[] };

/** Pure rule check, shared by the action and the tests. Returns the step this person may decide, or a reason. */
export function nextStep(approval: { initiatorId: string; step1ApproverId: string | null; step2ApproverId: string | null; status: string; subjectType: ApprovalSubject }, approver: Approver): { step: 1 | 2 } | { error: string } {
  if (approval.status !== "PENDING") return { error: "This approval is already decided." };
  if (!can(approver.roles, PERMISSION_FOR[approval.subjectType], { member: approver })) return { error: "Your role cannot approve this." };
  if (approver.id === approval.initiatorId) return { error: "The person who started this cannot approve it." };
  if (!approval.step1ApproverId) return { step: 1 };
  if (approver.id === approval.step1ApproverId) return { error: "A second, different approver is required." };
  return { step: 2 };
}

export async function requestApproval(input: { subjectType: ApprovalSubject; subjectId: string; initiatorId: string; amountCents?: number }) {
  const approval = await prisma.approval.create({ data: input });
  await audit({ actorId: input.initiatorId, action: "approval.requested", entityType: "Approval", entityId: approval.id, after: approval });
  return approval;
}

export async function decideApproval(approvalId: string, approver: Approver, decision: ApprovalDecision, reason = "") {
  const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new ApprovalError("Approval not found.");
  const next = nextStep(approval, approver);
  if ("error" in next) throw new ApprovalError(next.error);
  const now = new Date();
  const status: ApprovalStatus = decision === "DECLINED" ? "DECLINED" : next.step === 2 ? "APPROVED" : "PENDING";
  const data =
    next.step === 1
      ? { step1ApproverId: approver.id, step1Decision: decision, step1Reason: reason, step1At: now, status }
      : { step2ApproverId: approver.id, step2Decision: decision, step2Reason: reason, step2At: now, status };
  // Only update while the step is still open, so two people deciding at once cannot both win.
  // On MongoDB an optional field Prisma never wrote is unset rather than null, so match both.
  const guard = next.step === 1
    ? { OR: [{ step1ApproverId: null }, { step1ApproverId: { isSet: false } }] }
    : { OR: [{ step2ApproverId: null }, { step2ApproverId: { isSet: false } }] };
  const updated = await prisma.approval.updateMany({ where: { id: approvalId, status: "PENDING", ...guard }, data });
  if (updated.count !== 1) throw new ApprovalError("Someone else decided this step first. Reload and check.");
  const after = await prisma.approval.findUnique({ where: { id: approvalId } });
  await audit({ actorId: approver.id, action: `approval.step${next.step}.${decision.toLowerCase()}`, entityType: "Approval", entityId: approvalId, before: approval, after });
  return after!;
}
