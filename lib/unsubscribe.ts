// The one-click unsubscribe link in every campaign (lib/campaigns.ts): the account it's for, signed with the app's secret,
// so the link works without signing in and can't be made for someone else.
import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (userId: string) => createHmac("sha256", process.env.AUTH_SECRET || "lendhous-dev-secret").update(`unsubscribe:${userId}`).digest("base64url").slice(0, 32);

export const unsubscribeToken = (userId: string) => `${Buffer.from(userId).toString("base64url")}.${sign(userId)}`;

/** The account a token is for, or null when it's been altered. */
export function unsubscribeUser(token: string): string | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || token.length > 300) return null;
  const userId = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}
