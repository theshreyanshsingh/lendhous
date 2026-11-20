"use server";

import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { sendCampaign } from "@/lib/campaign-store";
import { AUDIENCES, campaignProblem, type CampaignInput } from "@/lib/campaigns";
import { isDemoEmail } from "@/lib/deploy";
import { getSettings } from "@/lib/settings";

export type CampaignReply = { error: string } | { sent: number; failed: number; test: boolean };

/** Sends a campaign to its audience, or a test to the person writing it. */
export async function sendCampaignNow(raw: CampaignInput, mode: "test" | "send"): Promise<CampaignReply> {
  const actor = await requirePermission("send_campaigns");
  if (isDemoEmail(actor.email)) return { error: "Demo seats can write a campaign but don't send one." };
  const input: CampaignInput = { audience: raw.audience in AUDIENCES ? raw.audience : "brokers", subject: String(raw.subject ?? "").slice(0, 200), body: String(raw.body ?? "").slice(0, 6000) };
  const settings = await getSettings();
  const problem = campaignProblem(input, settings.lenderAddress);
  if (problem) return { error: problem };
  const asked = await headers();
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `${asked.get("x-forwarded-proto") ?? "https"}://${asked.get("host") ?? ""}`).replace(/\/$/, "");
  const result = await sendCampaign(input, settings.lenderAddress, origin, actor.name, mode === "test" ? { id: actor.id, email: actor.email } : undefined);
  if ("error" in result) return { error: result.error ?? "It couldn't be sent." };
  if (mode === "send") await audit({ actorId: actor.id, action: "campaign.sent", entityType: "Campaign", entityId: input.audience, after: { subject: input.subject, sent: result.sent, failed: result.failed } });
  return { sent: result.sent, failed: result.failed, test: mode === "test" };
}
