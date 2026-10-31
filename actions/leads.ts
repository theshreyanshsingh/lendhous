"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { notifyTeam } from "@/lib/email";
import { leadSummary, parseLead } from "@/lib/leads";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

export type LeadFormState = { sent: boolean; error: string };

/** The public site's project brief. Open to anyone, so it is rate limited and has a honeypot field. */
export async function sendLead(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  // Only bots fill the hidden field. They get a normal-looking reply and nothing is kept.
  if (String(formData.get("website") || "")) return { sent: true, error: "" };
  const parsed = parseLead(Object.fromEntries(formData));
  if (!parsed.ok) return { sent: false, error: parsed.error };
  const meta = await requestMeta();
  if (!(await consumeRateLimit(`lead:${meta.ipAddress}`, 5, 60 * 60 * 1000))) {
    return { sent: false, error: "Too many briefs from this connection. Try again in an hour." };
  }
  let leadId: string;
  try {
    leadId = (await prisma.lead.create({ data: parsed.lead })).id;
  } catch (error) {
    console.error("[lendhous-leads] could not save a brief:", error);
    return { sent: false, error: "We couldn't send this just now. Please try again in a few minutes." };
  }
  await audit({ actorId: null, action: "lead.created", entityType: "Lead", entityId: leadId });
  // The brief is saved by now, so a mail failure only costs the alert: it still shows in the staff inbox.
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    await notifyTeam(`New project brief: ${parsed.lead.city}, ${parsed.lead.state}`, `${leadSummary(parsed.lead)}\n\nOpen the leads inbox: ${origin}/admin/leads`, "lead.new");
  } catch (error) {
    console.error("[lendhous-leads] could not alert the team:", error);
  }
  return { sent: true, error: "" };
}

export async function markLeadContacted(formData: FormData) {
  const user = await requirePermission("view_pipeline");
  const id = String(formData.get("id") || "");
  await prisma.lead.update({ where: { id }, data: { contactedAt: new Date() } });
  await audit({ actorId: user.id, action: "lead.contacted", entityType: "Lead", entityId: id });
  revalidatePath("/admin/leads");
}
