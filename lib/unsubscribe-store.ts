// Recording an unsubscribe from a campaign link (lib/unsubscribe.ts for the token).
import { prisma } from "@/lib/prisma";
import { unsubscribeUser } from "@/lib/unsubscribe";

/** Marks the account as not wanting campaigns. Null when the link isn't a real one. */
export async function unsubscribe(token: string) {
  const userId = unsubscribeUser(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, marketingOptOut: true } });
  if (!user) return null;
  if (!user.marketingOptOut) await prisma.user.update({ where: { id: userId }, data: { marketingOptOut: new Date() } });
  return { already: Boolean(user.marketingOptOut) };
}

/** Whether the link is real, and whether its account already stopped campaigns. */
export async function unsubscribeState(token: string) {
  const userId = unsubscribeUser(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { marketingOptOut: true } });
  return user ? { stopped: Boolean(user.marketingOptOut) } : null;
}
