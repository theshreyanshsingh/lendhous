// Borrowers referring borrowers (docs/competitor-gaps.md, 1.3). A borrower whose loan has funded gets a personal link; a
// friend who comes through it and whose first LendHous loan funds earns them the bonus an owner set in Settings, tracked
// from expected to earned to paid. Pure, so the book, the portal and the tests count the same way.
import { referralCodeFor } from "./brokers";
import { round2 } from "./engine";
import type { Deal } from "./mockData";
import { SERVICED } from "./servicing";

/** Days LendHous aims to pay a bonus in once the friend's loan funds. PLACEHOLDER until GT sets it (Kiavi says 10 business days). */
export const PAY_WITHIN_BUSINESS_DAYS = 10;
/** A referrer paid this much in a year likely needs a 1099-MISC. Ask the CPA. */
export const MISC_THRESHOLD = 600;
/** What demo seats show, since their book never reaches the server's settings. */
export const DEMO_BONUS = 500;

const FUNDED = new Set([...SERVICED, "paid_off"]);
const ENDED = new Set(["declined", "withdrawn"]);

export type FriendReferral = NonNullable<Deal["friendReferral"]>;
export type BonusState = "expected" | "earned" | "paid" | "none";
export const BONUS_STATE: Record<BonusState, string> = { expected: "Expected once it funds", earned: "Earned, not paid yet", paid: "Paid", none: "No bonus" };

/** A borrower can refer friends once one of their loans has funded. */
export const canRefer = (deals: Deal[], borrowerId: string) => Boolean(borrowerId) && deals.some((deal) => deal.borrowerId === borrowerId && FUNDED.has(deal.status));

/** A borrower's referral code. Salted so it never matches their own broker-style code, and the same every time. */
export const friendCodeFor = (borrowerId: string) => referralCodeFor(borrowerId, "friend");

/** "Avery M." from "Avery Mock (FAKE)": what the friend sees of who sent them. */
export function shortName(name: string) {
  const [first = "", last = ""] = name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/** The borrower a friend's code belongs to, if they can still refer. */
export function referrerByCode(deals: Deal[], code: string): { id: string; name: string } | null {
  const seen = new Set<string>();
  for (const deal of deals) {
    if (seen.has(deal.borrowerId) || !FUNDED.has(deal.status)) continue;
    seen.add(deal.borrowerId);
    if (friendCodeFor(deal.borrowerId) === code) return { id: deal.borrowerId, name: deal.borrowerName };
  }
  return null;
}

/** Why a loan can't be counted as a referral from this borrower, or null. Only a new borrower's first loan counts. */
export function referralProblem(deals: Deal[], dealId: string, referrerId: string): string | null {
  const deal = deals.find((item) => item.id === dealId);
  if (!deal) return "That loan no longer exists.";
  if (deal.friendReferral) return "This loan is already counted as a referral.";
  if (!canRefer(deals, referrerId)) return "Only a borrower whose loan has funded can refer.";
  if (deal.borrowerId === referrerId) return "A borrower can't refer their own loan.";
  if (deals.some((item) => item.id !== deal.id && item.borrowerId === deal.borrowerId && FUNDED.has(item.status))) return "This borrower already has a LendHous loan, so it isn't a new referral.";
  return null;
}

/** The bonus on a loan: expected until the friend's loan funds, then earned until it's recorded as paid. */
export function bonusOf(deal: Pick<Deal, "friendReferral" | "status">): { amount: number; state: BonusState } {
  const referral = deal.friendReferral;
  if (!referral) return { amount: 0, state: "none" };
  if (referral.paid) return { amount: referral.paid.amount, state: "paid" };
  if (!referral.bonus || ENDED.has(deal.status)) return { amount: 0, state: "none" };
  return { amount: referral.bonus, state: FUNDED.has(deal.status) ? "earned" : "expected" };
}

/** Why a bonus payment can't be recorded, or null. */
export function bonusPaidProblem(deal: Deal | undefined, amount: number, on: string, today: string): string | null {
  if (!deal?.friendReferral) return "This loan wasn't referred by a borrower.";
  if (deal.friendReferral.paid) return "It's already recorded as paid.";
  if (bonusOf(deal).state !== "earned") return "The bonus is paid once the friend's loan funds.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter the amount paid.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) return "Enter the day it was paid, today or before.";
  if (on < deal.closingDate) return "It can't be paid before the loan funded.";
  return null;
}

/** What a referrer sees of their referrals: when, and where each bonus stands. Never who the friend is or how their loan is doing. */
export type MyReferral = { on: string; state: BonusState; amount: number; paidOn?: string };

export function referralsBy(deals: Deal[], referrerId: string): MyReferral[] {
  return deals.filter((deal) => deal.friendReferral?.referrerId === referrerId)
    .map((deal) => ({ deal, bonus: bonusOf(deal) }))
    .map(({ deal, bonus }) => ({ on: deal.friendReferral!.on, state: bonus.state, amount: bonus.amount, ...(deal.friendReferral!.paid ? { paidOn: deal.friendReferral!.paid.on } : {}) }))
    .sort((a, b) => b.on.localeCompare(a.on));
}

/** Bonuses paid in a year, by referrer, for the tax page: anyone at MISC_THRESHOLD or more likely needs a 1099-MISC. */
export function bonusesPaidIn(deals: Deal[], year: number) {
  const byReferrer = new Map<string, { referrerId: string; name: string; total: number; loans: string[] }>();
  for (const deal of deals) {
    const referral = deal.friendReferral;
    if (!referral?.paid || !referral.paid.on.startsWith(`${year}-`)) continue;
    const row = byReferrer.get(referral.referrerId) ?? { referrerId: referral.referrerId, name: referral.referrerName, total: 0, loans: [] };
    row.total = round2(row.total + referral.paid.amount);
    row.loans.push(deal.loanNumber);
    byReferrer.set(referral.referrerId, row);
  }
  return [...byReferrer.values()].map((row) => ({ ...row, needsForm: row.total >= MISC_THRESHOLD })).sort((a, b) => b.total - a.total);
}
