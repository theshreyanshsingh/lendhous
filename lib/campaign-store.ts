// Sending a campaign (lib/campaigns.ts for the rules): who's in each audience as their accounts stand now, less anyone who
// unsubscribed, and the send itself, one email at a time, each with its own unsubscribe link.
import { readBook } from "@/lib/book-store";
import { audienceIds, AUDIENCES, campaignFooter, CAMPAIGN_RULES, type Audience, type CampaignInput } from "@/lib/campaigns";
import { sendCampaignEmail } from "@/lib/email";
import { recordError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { unsubscribeToken } from "@/lib/unsubscribe";

const subscribed = { AND: [{ OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }, { OR: [{ marketingOptOut: null }, { marketingOptOut: { isSet: false } }] }] };

/** The people a campaign to this audience would reach today. */
export async function recipientsFor(audience: Audience) {
  const { book } = await readBook();
  const brokerUsers = audience === "brokers" ? (await prisma.user.findMany({ where: { roles: { some: { role: "BROKER" } } }, select: { id: true, organizationId: true } })).map((user) => ({ id: user.id, firmId: user.organizationId ?? user.id })) : [];
  const ids = audienceIds(book, audience, brokerUsers);
  if (!ids.length) return [];
  return prisma.user.findMany({ where: { id: { in: ids }, accountStatus: "APPROVED", ...subscribed }, select: { id: true, email: true, name: true }, take: CAMPAIGN_RULES.maxRecipients + 1 });
}

/** How many each audience reaches today, for the compose page. */
export async function audienceCounts(): Promise<Record<Audience, number>> {
  const entries = await Promise.all((Object.keys(AUDIENCES) as Audience[]).map(async (audience) => [audience, (await recipientsFor(audience)).length] as const));
  return Object.fromEntries(entries) as Record<Audience, number>;
}

/** Sends it to everyone in the audience, or to one person as a test. A send that fails is counted, not retried. */
export async function sendCampaign(input: CampaignInput, mailingAddress: string, origin: string, sentBy: string, only?: { id: string; email: string }) {
  const people = only ? [only] : await recipientsFor(input.audience);
  if (people.length > CAMPAIGN_RULES.maxRecipients) return { error: `That's over ${CAMPAIGN_RULES.maxRecipients.toLocaleString("en-US")} people: split it, or ask for the limit to be raised.` } as const;
  let sent = 0;
  let failed = 0;
  for (const person of people) {
    const token = unsubscribeToken(person.id);
    // The footer's link opens a page; mail apps' own button posts to the one-click address.
    try {
      await sendCampaignEmail(person.email, input.subject.trim(), input.body.trim() + campaignFooter(mailingAddress, `${origin}/unsubscribe/${token}`), `${origin}/api/unsubscribe/${token}`);
      sent++;
    } catch (error) {
      failed++;
      await recordError(error, "campaign", "action");
    }
  }
  if (!only) await prisma.campaign.create({ data: { audience: input.audience, subject: input.subject.trim(), body: input.body.trim(), sentBy, recipients: sent, skipped: failed } });
  return { sent, failed } as const;
}

export const recentCampaigns = () => prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
