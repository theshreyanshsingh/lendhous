"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { notifyTeam } from "@/lib/email";
import { sealLead } from "@/lib/lead-store";
import { leadSummary, parseLead } from "@/lib/leads";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

export type LeadFormState = { sent: boolean; error: string };

/** The public site's project brief. Open to anyone, so it is rate limited and has a honeypot field. */
export async function sendLead(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  // Only bots fill the hidden field. They get a normal-looking reply and nothing is kept.
  if (String(formData.get("leave_blank") || "")) return { sent: true, error: "" };
  const parsed = parseLead(Object.fromEntries(formData));
  if (!parsed.ok) return { sent: false, error: parsed.error };
  const meta = await requestMeta();
  // Behind a proxy that doesn't pass the visitor's address along, everyone looks like one visitor, and five an hour would turn real people away.
  const shared = /^(unknown|127\.|::1$|::ffff:127\.)/.test(meta.ipAddress);
  if (!(await consumeRateLimit(`lead:${meta.ipAddress}`, shared ? 60 : 5, 60 * 60 * 1000))) {
    return { sent: false, error: "Too many briefs from this connection. Try again in an hour." };
  }
  let leadId: string;
  try {
    leadId = (await prisma.lead.create({ data: sealLead(parsed.lead) })).id;
  } catch (error) {
    console.error("[lendhous-leads] could not save a brief:", error);
    return { sent: false, error: "We couldn't send this just now. Please try again in a few minutes." };
  }
  // The brief is saved by now, so a failure here only costs the log line or the alert: it still shows in the staff inbox.
  try {
    await audit({ actorId: null, action: "lead.created", entityType: "Lead", entityId: leadId });
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    // Replying to the alert reaches the person who sent the brief.
    await notifyTeam(`New project brief: ${parsed.lead.city}, ${parsed.lead.state}`, `${leadSummary(parsed.lead)}\n\nOpen the leads inbox: ${origin}/admin/leads`, "lead.new", parsed.lead.email);
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
