// Looking a referral up from outside the portal: the public quote form's referral link, from a broker (lib/brokers.ts)
// or from a LendHous borrower (lib/referrals.ts).
import { readBook } from "@/lib/book-store";
import { referrerByCode, shortName } from "@/lib/referrals";
import { freshSettings } from "@/lib/settings";

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
