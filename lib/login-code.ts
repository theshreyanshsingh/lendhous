// Emailed sign-in codes. Kept out of actions/security.ts on purpose: every export of a "use server" file is a callable endpoint.
import { createHmac, randomInt } from "crypto";
import { sendLoginCode } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

const LOGIN_CODE_MS = 10 * 60 * 1000;

// Keyed, so a copy of the database alone can't be used to try all million codes.
const hashOf = (userId: string, code: string) => createHmac("sha256", process.env.AUTH_SECRET!).update(`${userId}:${code}`).digest("hex");

export type LoginCodeOutcome = "sent" | "limited" | "failed";

/** Where the verify page says how the send went. */
export const LOGIN_CODE_PAGE: Record<LoginCodeOutcome, string> = {
  sent: "/login/verify?notice=email_sent",
  limited: `/login/verify?error=${encodeURIComponent("Too many codes requested. Use the last one we sent, or wait a few minutes.")}`,
  failed: `/login/verify?error=${encodeURIComponent("We couldn't send your code. Try again in a minute.")}`,
};

export async function issueLoginCode(user: { id: string; email: string }): Promise<LoginCodeOutcome> {
  if (!(await consumeRateLimit(`login-code-send:${user.id}`, 5, 10 * 60 * 1000))) return "limited";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = await prisma.loginCode.create({ data: { userId: user.id, codeHash: hashOf(user.id, code), expiresAt: new Date(Date.now() + LOGIN_CODE_MS) } });
  if (await sendLoginCode(user.email, code)) return "sent";
  await prisma.loginCode.delete({ where: { id: row.id } });
  return "failed";
}

/** True once per code. deleteMany is atomic, so the same code sent twice at once can't pass twice. */
export async function takeLoginCode(userId: string, code: string) {
  const { count } = await prisma.loginCode.deleteMany({ where: { userId, codeHash: hashOf(userId, code.replace(/\s/g, "")), expiresAt: { gt: new Date() } } });
  if (!count) return false;
  await prisma.loginCode.deleteMany({ where: { userId } });
  return true;
}
