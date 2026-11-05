// The quote funnel's anonymous counts, and what the reports read: the counts and the saved quotes (Leads) for a period.
import type { FunnelCount, FunnelLead, QuoteStep } from "./quote-funnel";
import { notDeleted, prisma } from "./prisma";
import { servicingDate } from "./servicing";

/** One more visitor at this step today (Florida's day), for this channel and referral code. */
export async function countQuoteStep(step: QuoteStep, channel: string, ref: string, now = new Date()) {
  const day = servicingDate(now);
  await prisma.quoteCount.upsert({ where: { day_channel_ref: { day, channel, ref } }, create: { day, channel, ref, [step]: 1 }, update: { [step]: { increment: 1 } } });
}

export async function funnelData(from: string, to: string): Promise<{ counts: FunnelCount[]; leads: FunnelLead[] }> {
  const counts = await prisma.quoteCount.findMany({ where: { day: { gte: from, lte: to } } });
  // A day's leads run to the end of that day in Florida; a little either side is trimmed by the funnel's own day check.
  const leads = await prisma.lead.findMany({ where: { ...notDeleted, createdAt: { gte: new Date(`${from}T00:00:00-05:00`), lt: new Date(Date.parse(`${to}T00:00:00-05:00`) + 2 * 86_400_000) } }, select: { createdAt: true, channel: true, brokerId: true, loanId: true } });
  return {
    counts: counts.map(({ day, channel, ref, started, shown }) => ({ day, channel, ref, started, shown })),
    leads: leads.map((lead) => ({ day: servicingDate(lead.createdAt), channel: lead.channel, brokerId: lead.brokerId, loanId: lead.loanId })),
  };
}
