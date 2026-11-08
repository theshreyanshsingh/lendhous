// A partner lender's money for its share of a loan (Spec P7). The winning partner sees where to send it once the
// escrow account is verified by a call-back, says when it's sent, and staff confirm it arrived before the loan funds.
import { activeWire, wireVerified } from "./closing";
import type { Deal, PartnerFunding } from "./mockData";

/** What's left to wire after money rolled over from a loan that paid off is used (lib/capital-moves.ts keeps the rest). */
export const toWire = (funding: Pick<PartnerFunding, "amount" | "fromCredit">) => Math.max(0, Math.round((funding.amount - (funding.fromCredit ?? 0)) * 100) / 100);

/** The stages a partner's money moves in: once the loan is clear to close. */
export const FUNDING_STAGES = ["clear_to_close", "closing"];
const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/** What stands in the way of funding on the partner's side, or null. */
export const partnerFundsBlocker = (deal: Pick<Deal, "partnerFunding">) =>
  deal.partnerFunding && !deal.partnerFunding.received && toWire(deal.partnerFunding) > 0 ? `The partner's share (${dollars(toWire(deal.partnerFunding))}) hasn't arrived yet (Closing tab)` : null;

/** Why this partner can't say it has sent its share yet, or null. */
export function sentProblem(deal: Deal, partnerId: string) {
  const funding = deal.partnerFunding;
  if (!funding || funding.partnerId !== partnerId) return "This loan's partner share isn't yours.";
  if (funding.received) return "LendHous already has your funds.";
  if (toWire(funding) <= 0) return "Your money rolled over from an earlier loan covers your share: there's nothing to send.";
  if (!FUNDING_STAGES.includes(deal.status)) return "Funds go out once the loan is clear to close.";
  if (!wireVerified(deal)) return "Wait until LendHous has verified the escrow account by phone.";
  return null;
}

export function receivedProblem(deal: Deal) {
  if (!deal.partnerFunding) return "This loan has no partner share.";
  if (deal.partnerFunding.received) return "It's already marked received.";
  return null;
}

/** Where to send it: the verified escrow wire. Added only to the winning partner's own copy of the loan, never stored. */
export function sendToFor(deal: Deal): PartnerFunding["sendTo"] {
  const wire = activeWire(deal);
  if (!wire?.verification || !FUNDING_STAGES.includes(deal.status)) return undefined;
  return { beneficiary: wire.beneficiary, bankName: wire.bankName, routing: wire.routing, account: wire.account, reference: `${wire.reference} ${deal.loanNumber}`.trim(), verifiedOn: wire.verification.at.slice(0, 10) };
}
