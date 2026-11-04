// Keeps pre-approval and proof-of-funds letters (lib/letters.ts). Who a letter is for, its figures and its verify code
// are sealed with the record's own id; the verify page finds a letter by a hash of its code.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type ApprovalLetter } from "@prisma/client";
import { encryptField, readField } from "@/lib/crypto";
import { expiryFor, letterNumber, letterState, type LetterDetails } from "@/lib/letters";
import { prisma } from "@/lib/prisma";
import { servicingDate } from "@/lib/servicing";

export type SealedLetter = LetterDetails & { code: string; issuedBy: string };
const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");
const context = (id: string) => `ApprovalLetter.details:${id}`;
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
export const verifyUrl = (code: string) => `${origin()}/verify/${code}`;

const opened = (row: ApprovalLetter) => ({ row, details: JSON.parse(readField(row.details, context(row.id))) as SealedLetter, state: letterState({ expiresOn: row.expiresOn, revokedAt: row.revokedAt }, servicingDate(new Date())) });

/** Numbers it (PA-2026-0001 and up, by kind and year), seals it and returns its verify code, once. */
export async function issueLetter(details: LetterDetails, issuer: { id: string; name: string }, borrowerId: string | null, now = new Date()) {
  const today = servicingDate(now);
  const prefix = letterNumber(details.kind, today.slice(0, 4), 0).slice(0, -4);
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = letterNumber(details.kind, today.slice(0, 4), (await prisma.approvalLetter.count({ where: { number: { startsWith: prefix } } })) + 1 + attempt);
    const code = randomBytes(18).toString("base64url");
    const id = randomUUID();
    try {
      await prisma.approvalLetter.create({ data: { id, number, codeHash: hashOf(code), kind: details.kind, borrowerId, details: encryptField(JSON.stringify({ ...details, code, issuedBy: issuer.name }), context(id)), issuedById: issuer.id, expiresOn: expiryFor(today, details.validDays) } });
      return { id, number, code, expiresOn: expiryFor(today, details.validDays) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("Couldn't give the letter a number. Try again.");
}

export async function openLetter(id: string) {
  const row = await prisma.approvalLetter.findUnique({ where: { id } });
  return row ? opened(row) : null;
}

/** The letter a verify code belongs to, or null. */
export async function letterByCode(code: string) {
  if (!code || code.length > 100) return null;
  const row = await prisma.approvalLetter.findUnique({ where: { codeHash: hashOf(code) } });
  return row ? opened(row) : null;
}

export async function listLetters(where: Prisma.ApprovalLetterWhereInput = {}) {
  return (await prisma.approvalLetter.findMany({ where, orderBy: { issuedAt: "desc" }, take: 200 })).map(opened);
}

export async function revokeLetter(id: string, byId: string) {
  const { count } = await prisma.approvalLetter.updateMany({ where: { id, OR: [{ revokedAt: null }, { revokedAt: { isSet: false } }] }, data: { revokedAt: new Date(), revokedById: byId } });
  return count > 0;
}
