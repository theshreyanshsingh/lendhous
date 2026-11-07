// Looking a referral up from outside the portal: the public quote form's referral link, from a broker (lib/brokers.ts)
// or from a LendHous borrower (lib/referrals.ts).
import { readBook } from "@/lib/book-store";
import { referrerByCode, shortName } from "@/lib/referrals";
import { freshSettings } from "@/lib/settings";
import { protectingBroker } from "@/lib/broker-program";
import { PROTECTION_MONTHS } from "@/lib/brokers";
import { openQuote } from "@/lib/lead-store";
import { notDeleted, prisma } from "@/lib/prisma";
import { servicingDate } from "@/lib/servicing";

const CODE = /^[a-z2-9]{8}$/;

export type Referral = { kind: "broker" | "borrower"; id: string; name: string };

/**
 * Whose referral code this is: an approved brokerage, or a borrower whose loan has funded while the referral program is
 * on. Null for a code that's malformed, unknown, not approved or from a program that's off. A borrower is named only as
 * "Avery M.", which is all the friend sees.
 */
export async function referralByCode(code: string | undefined | null): Promise<Referral | null> {
  if (!code || !CODE.test(code)) return null;
  const { book } = await readBook();
  const broker = book.brokers.find((item) => item.referralCode === code && item.status === "approved");
  if (broker) return { kind: "broker", id: broker.id, name: broker.name };
  // Read fresh: the quote page and the request it sends must agree on whether the program is on.
  if (!(await freshSettings()).referralBonusCents) return null;
  const borrower = referrerByCode(book.deals, code);
  return borrower ? { kind: "borrower", id: borrower.id, name: shortName(borrower.name) } : null;
}

/**
 * The brokerage a returning client still belongs to, from an email: a borrower account whose loan a broker referred in the
 * protection window, or an earlier quote request through a broker's link. For telling the broker, and keeping the lead theirs.
 */
export async function brokerForClient(email: string, now = new Date()): Promise<{ id: string; name: string } | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const { book } = await readBook();
  const today = servicingDate(now);
  const account = await prisma.user.findUnique({ where: { email: wanted }, select: { id: true } });
  const referred = account ? protectingBroker(book.deals, account.id, today, PROTECTION_MONTHS) : null;
  let brokerId = referred?.brokerId ?? null;
  if (!brokerId) {
    const since = new Date(now.getTime() - PROTECTION_MONTHS * 30.5 * 86_400_000);
    const rows = await prisma.lead.findMany({ where: { ...notDeleted, brokerId: { not: null }, createdAt: { gte: since }, quote: { not: null } }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, quote: true, brokerId: true } });
    brokerId = rows.find((row) => openQuote(row)?.borrower.email.toLowerCase() === wanted)?.brokerId ?? null;
  }
  const broker = brokerId ? book.brokers.find((item) => item.id === brokerId && item.status === "approved") : null;
  return broker ? { id: broker.id, name: broker.name } : null;
}
