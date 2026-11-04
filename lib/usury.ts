// Florida usury on a term sheet (Fla. Stat. 687.02, 687.03, 687.071). Points count as interest, spread over the stated term
// (687.03(3)), so a short loan with points can pass the cap with a rate under it: 5 points on a 6-month loan adds about 10%
// a year. Whether an independent broker's fee counts is the attorney's call, so it's worked out both ways.
import { round2 } from "./engine";

/** 18% a year on loans of $500,000 or less, 25% above that; over 25% is criminal on any loan. */
export const USURY = { civil: 18, civilUpTo: 500_000, above: 25, criminal: 25 } as const;

/** The rate with points spread evenly over the term, as a simple annual rate. */
export const spreadRate = (rate: number, points: number, termMonths: number) => round2(rate + (points * 12) / Math.max(1, termMonths));

export type UsuryCheck = {
  /** The cap this loan's size falls under. */
  limit: number;
  /** Rate and LendHous's points spread over the term, then with the broker's points too. */
  lender: number; withBroker: number;
  overLender: boolean; overWithBroker: boolean; criminal: boolean;
};

export function usuryCheck(input: { amount: number; rate: number; points: number; brokerPoints?: number; termMonths: number }): UsuryCheck {
  const limit = input.amount <= USURY.civilUpTo ? USURY.civil : USURY.above;
  const lender = spreadRate(input.rate, input.points, input.termMonths);
  const withBroker = spreadRate(input.rate, input.points + (input.brokerPoints ?? 0), input.termMonths);
  return { limit, lender, withBroker, overLender: lender > limit + 1e-9, overWithBroker: withBroker > limit + 1e-9, criminal: lender > USURY.criminal + 1e-9 };
}

/** What to tell whoever sets the terms, or nothing when they're inside the cap counted every way. */
export function usuryWarning(check: UsuryCheck, termMonths: number, brokerPoints = 0): string | null {
  const over = (value: number) => `${value.toFixed(2)}% a year spread over the ${termMonths}-month term`;
  if (check.overLender) return `Rate plus points comes to ${over(check.lender)}, over Florida's ${check.limit}% cap (points count as interest, Fla. Stat. 687.03). Ask the attorney before it goes out.`;
  if (check.overWithBroker) return `With the broker's ${brokerPoints} points it comes to ${over(check.withBroker)}, over Florida's ${check.limit}% cap. Ask the attorney whether the broker's fee counts as interest before it goes out.`;
  return null;
}
