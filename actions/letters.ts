"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { hasPermission, requirePermission, requireUser } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";
import { sendLetterMail } from "@/lib/email";
import type { Product } from "@/lib/engine";
import { letterPdf } from "@/lib/letter-pdf";
import { issueLetter, listLetters, openLetter, revokeLetter, verifyUrl } from "@/lib/letter-store";
import { LETTER_KIND, letterProblem, type LetterDetails, type LetterKind } from "@/lib/letters";
import { notDeleted, prisma } from "@/lib/prisma";
import { servicingDate } from "@/lib/servicing";
import { getSettings } from "@/lib/settings";

const PRODUCTS: Product[] = ["fix_flip", "bridge", "ground_up", "dscr"];
const lender = () => process.env.LENDER_NAME || "LendHous";

export type LetterInput = { kind: LetterKind; borrowerId: string; name: string; email: string; entityName: string; product: Product; maxPurchasePrice: number; maxLoan: number; propertyAddress: string; conditions: string[]; validDays: number };

/** The PDF a letter prints as, for the email and the download route. */
export async function pdfOf(id: string) {
  const letter = await openLetter(id);
  if (!letter) return null;
  const pdf = await letterPdf({ number: letter.row.number, issuedOn: servicingDate(letter.row.issuedAt), expiresOn: letter.row.expiresOn, details: letter.details, issuedBy: letter.details.issuedBy, verifyUrl: verifyUrl(letter.details.code), lender: lender(), phone: (await getSettings()).lenderPhone });
  return { letter, pdf };
}

/**
 * Issues a letter and emails it to the borrower. It takes term sheet authority for the amount: a letter says what
 * LendHous would lend, so whoever signs one must be able to price a loan that size.
 */
export async function issueApprovalLetter(input: LetterInput): Promise<{ id?: string; number?: string; error?: string }> {
  const actor = await requirePermission("view_pipeline");
  if (isDemoEmail(actor.email)) return { error: "Demo accounts can't issue real letters. Sign in with a real account." };
  const details: LetterDetails = {
    kind: input.kind === "proof_of_funds" ? "proof_of_funds" : "pre_approval",
    name: String(input.name ?? "").trim().slice(0, 120), email: String(input.email ?? "").trim().toLowerCase().slice(0, 200), entityName: String(input.entityName ?? "").trim().slice(0, 160),
    product: PRODUCTS.includes(input.product) ? input.product : "fix_flip",
    maxPurchasePrice: Math.round(Number(input.maxPurchasePrice) || 0), maxLoan: Math.round(Number(input.maxLoan) || 0),
    propertyAddress: String(input.propertyAddress ?? "").trim().slice(0, 200),
    conditions: (Array.isArray(input.conditions) ? input.conditions : []).map((item) => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 12),
    validDays: Math.round(Number(input.validDays) || 0),
  };
  const problem = letterProblem(details);
  if (problem) return { error: problem };
  if (!(await hasPermission(actor, "issue_term_sheet", { amountCents: details.maxLoan * 100 }))) return { error: "Your term sheet authority doesn't cover a letter this size." };
  let borrowerId: string | null = null;
  if (input.borrowerId) {
    const account = await prisma.user.findFirst({ where: { id: input.borrowerId, ...notDeleted, roles: { some: { role: "BORROWER" } } } });
    if (!account) return { error: "That borrower account isn't there any more." };
    borrowerId = account.id;
  }
  const issued = await issueLetter(details, actor, borrowerId);
  await audit({ actorId: actor.id, action: "letter.issued", entityType: "ApprovalLetter", entityId: issued.id, after: { number: issued.number, kind: details.kind, maxLoan: details.maxLoan, expiresOn: issued.expiresOn } });
  if (details.email) {
    const made = await pdfOf(issued.id);
    if (made) await sendLetterMail(details.email, `Your ${LETTER_KIND[details.kind].toLowerCase()} letter from ${lender()}`, `Hi ${details.name.split(" ")[0]},\n\nYour ${LETTER_KIND[details.kind].toLowerCase()} letter ${issued.number} is attached. It's good through ${issued.expiresOn}.\n\nA seller or agent can check it's genuine by scanning the code on it or opening ${verifyUrl(issued.code)}. Questions: reply to this email or call your loan officer.`, { filename: `${issued.number}.pdf`, content: made.pdf });
  }
  revalidatePath("/admin/letters");
  return { id: issued.id, number: issued.number };
}

export async function revokeApprovalLetter(id: string): Promise<{ error?: string }> {
  const actor = await requirePermission("issue_term_sheet");
  if (!(await revokeLetter(id, actor.id))) return { error: "That letter is already revoked." };
  await audit({ actorId: actor.id, action: "letter.revoked", entityType: "ApprovalLetter", entityId: id });
  revalidatePath("/admin/letters");
  return {};
}

/** Every letter, newest first, for the team. */
export async function staffLetters() {
  await requirePermission("view_pipeline");
  return (await listLetters()).map(({ row, details, state }) => ({ id: row.id, number: row.number, kind: details.kind, name: details.name, entityName: details.entityName, maxLoan: details.maxLoan, maxPurchasePrice: details.maxPurchasePrice, propertyAddress: details.propertyAddress, issuedBy: details.issuedBy, issuedAt: row.issuedAt.toISOString(), expiresOn: row.expiresOn, state, verifyUrl: verifyUrl(details.code) }));
}

/** Borrower accounts to address a letter to. */
export async function letterBorrowers() {
  await requirePermission("view_pipeline");
  return prisma.user.findMany({ where: { accountStatus: "APPROVED", ...notDeleted, roles: { some: { role: "BORROWER" } } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 300 });
}

/** The signed-in borrower's own letters. */
export async function myLetters() {
  const user = await requireUser();
  if (isDemoEmail(user.email)) return [];
  return (await listLetters({ borrowerId: user.id })).map(({ row, details, state }) => ({ id: row.id, number: row.number, kind: details.kind, maxLoan: details.maxLoan, maxPurchasePrice: details.maxPurchasePrice, expiresOn: row.expiresOn, state }));
}
