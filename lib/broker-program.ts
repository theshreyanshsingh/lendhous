// What brokers get beyond their fee (docs/competitor-gaps.md, 1.8): tiers from the volume they fund with LendHous, their
// own brand on the quotes and term sheets they hand clients (LendHous still named as the lender), pre-qualification
// letters they issue within a limit an owner sets, and word when a client of theirs comes to LendHous directly. Pure.
import { evaluate } from "./engine";
import type { Broker, Deal } from "./mockData";
import { addMonths, SERVICED } from "./servicing";

/**
 * PLACEHOLDER tiers until GT sets them: loans funded in the last 12 months and the share of the broker's funded loans now
 * behind (research: Kiavi Platinum is $6M of bridge loans in 6 months with 2% or less delinquent).
 */
export const BROKER_TIERS = [
  { name: "Platinum", funded: 6_000_000, maxLate: 0.02, perks: ["Your clients' files are worked first", "The highest pre-qualification letter limits"] },
  { name: "Gold", funded: 3_000_000, maxLate: 0.05, perks: ["Your clients' files are worked first"] },
  { name: "Silver", funded: 1_000_000, maxLate: 0.1, perks: ["Your brand on quotes and term sheets"] },
] as const;
export type BrokerTier = (typeof BROKER_TIERS)[number];
export const TIER_WINDOW_MONTHS = 12;
/** The tiers whose clients' files rank first in the team's queue. */
export const PRIORITY_TIERS = new Set(["Platinum", "Gold"]);
/** How long a broker's pre-qualification letter can run. PLACEHOLDER: shorter than LendHous's own 30 to 90 days. */
export const BROKER_LETTER_DAYS = 30;

const LATE = new Set(["servicing_delinquent", "default"]);
const FUNDED = new Set([...SERVICED, "paid_off", "reo"]);

/** A broker's last 12 months with LendHous: what funded, how much, how much of it is behind now, and the tier that earns. */
export function brokerStanding(deals: Deal[], brokerId: string, today: string) {
  const since = addMonths(today, -TIER_WINDOW_MONTHS);
  const theirs = deals.filter((deal) => deal.brokerId === brokerId && FUNDED.has(deal.status));
  const recent = theirs.filter((deal) => deal.closingDate >= since && deal.closingDate <= today);
  const funded = recent.reduce((sum, deal) => sum + evaluate(deal.app).noteAmount, 0);
  const open = theirs.filter((deal) => SERVICED.includes(deal.status));
  const lateShare = open.length ? open.filter((deal) => LATE.has(deal.status)).length / open.length : 0;
  const tier = BROKER_TIERS.find((item) => funded >= item.funded && lateShare <= item.maxLate) ?? null;
  const next = [...BROKER_TIERS].reverse().find((item) => item.funded > funded) ?? null;
  return { funded, loans: recent.length, lateShare, tier, next: next && (!tier || next.funded > tier.funded) ? { name: next.name, more: next.funded - funded } : null };
}

/** Whether a loan's broker is in a tier whose clients go first. */
export const priorityBroker = (deals: Deal[], deal: Pick<Deal, "brokerId">, today: string) => Boolean(deal.brokerId && PRIORITY_TIERS.has(brokerStanding(deals, deal.brokerId, today).tier?.name ?? ""));

export type BrokerBrand = NonNullable<Broker["brand"]>;

/** Why this brand can't go on the brokerage's quotes and term sheets, or null. */
export function brandProblem(brand: BrokerBrand) {
  if (!brand.name.trim()) return "Enter the name your clients know you by.";
  if (brand.name.length > 80) return "Keep the name under 80 characters.";
  if (brand.phone && brand.phone.replace(/\D/g, "").length < 10) return "Enter the phone with its area code, or leave it blank.";
  if (brand.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brand.email)) return "Enter a valid email, or leave it blank.";
  if (brand.website && !/^https:\/\/[^\s]+$/.test(brand.website)) return "A website starts with https://, or leave it blank.";
  return null;
}

/** The line under the brand on a quote or term sheet. */
export const brandContact = (brand: BrokerBrand) => [brand.phone, brand.email, brand.website?.replace(/^https:\/\//, "")].filter(Boolean).join(" · ");

/** Why a broker can't issue a pre-qualification letter this size, or null. */
export function brokerLetterProblem(broker: Pick<Broker, "status" | "letterLimit"> | undefined, maxLoan: number, validDays: number) {
  if (broker?.status !== "approved") return "LendHous approves a brokerage before it issues letters.";
  if (!broker.letterLimit) return "LendHous hasn't set a letter limit for your brokerage yet. Ask your contact there.";
  if (maxLoan > broker.letterLimit) return `Your brokerage can issue letters up to $${broker.letterLimit.toLocaleString("en-US")}.`;
  if (validDays > BROKER_LETTER_DAYS) return `A broker's letter runs at most ${BROKER_LETTER_DAYS} days.`;
  return null;
}

/** The broker whose referral still holds for a borrower (lib/brokers.ts PROTECTION_MONTHS), from their earlier loans. */
export function protectingBroker(deals: Deal[], borrowerId: string, today: string, months = 12) {
  const since = addMonths(today, -months);
  return deals.filter((deal) => deal.borrowerId === borrowerId && deal.referredBy && deal.referredBy.on >= since).sort((a, b) => b.referredBy!.on.localeCompare(a.referredBy!.on))[0]?.referredBy ?? null;
}
