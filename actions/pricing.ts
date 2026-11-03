"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";
import { applyDraft, draftChanges, draftOf, draftProblems, draftSchema } from "@/lib/pricing-draft";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { prisma } from "@/lib/prisma";
import { servicingDate } from "@/lib/servicing";

const input = z.object({ draft: draftSchema, note: z.string().trim().min(1).max(500) });

/**
 * Publishes new pricing as a new version. Loans already priced keep theirs; new quotes, and applications someone reprices,
 * use this one. Nothing published is ever changed: the next change is another version.
 */
export async function publishPricing(raw: unknown): Promise<{ error?: string; version?: string }> {
  const actor = await requirePermission("manage_pricing");
  // Demo seats work on fake loans in their browser; pricing is for everyone, so they can only look.
  if (isDemoEmail(actor.email)) return { error: "Demo seats can try changes here but can't publish them." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "note") ? "Say what changed and why, for the record." : "A number is out of range. Check the fields you changed." };
  const problems = draftProblems(parsed.data.draft);
  if (problems.length) return { error: problems[0] };
  await loadPricing([], true);
  const base = currentPricing();
  const changes = draftChanges(draftOf(base), parsed.data.draft);
  if (!changes.length) return { error: "Nothing has changed from the current pricing." };
  const day = servicingDate(new Date());
  const version = `${day}-v${(await prisma.pricingVersion.count()) + 1}`;
  const config = applyDraft(base, parsed.data.draft, version);
  try {
    await prisma.pricingVersion.create({ data: { version, config: config as unknown as Prisma.InputJsonValue, note: parsed.data.note, publishedBy: actor.name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Someone published pricing at the same moment. Reload and try again." };
    throw error;
  }
  await loadPricing([], true);
  await audit({ actorId: actor.id, action: "pricing.published", entityType: "PricingVersion", entityId: version, before: { version: base.version }, after: { version, note: parsed.data.note, changes } });
  revalidatePath("/admin", "layout");
  return { version };
}
