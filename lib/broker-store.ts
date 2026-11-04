// Looking a broker up from outside the portal: the public quote form's referral link (lib/brokers.ts).
import { readBook } from "@/lib/book-store";

const CODE = /^[a-z2-9]{8}$/;

/** The approved brokerage a referral code belongs to, or null for a code that's malformed, unknown or not approved. */
export async function brokerByReferral(code: string | undefined | null) {
  if (!code || !CODE.test(code)) return null;
  const broker = (await readBook()).book.brokers.find((item) => item.referralCode === code && item.status === "approved");
  return broker ? { id: broker.id, name: broker.name } : null;
}
