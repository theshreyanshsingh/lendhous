// Kept out of actions/security.ts on purpose: every export of a "use server" file is a callable endpoint, and these decrypt.
import { decryptField } from "@/lib/crypto";

export const secretContext = (userId: string) => `user.totpSecret:${userId}`;
export const revealContext = (userId: string) => `user.recoveryReveal:${userId}`;

export function totpSecretOf(user: { id: string; totpSecretEnc: string }) {
  return decryptField(user.totpSecretEnc, secretContext(user.id));
}

export function recoveryCodesToShow(user: { id: string; recoveryRevealEnc: string }) {
  return decryptField(user.recoveryRevealEnc, revealContext(user.id)).split("\n").filter(Boolean);
}
