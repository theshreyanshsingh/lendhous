"use server";

import { audit } from "@/lib/audit";
import { hasPermission, requirePermission } from "@/lib/auth";
import { scopeBook } from "@/lib/book-access";
import type { Book } from "@/lib/book";
import { readBook } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { mapProperty } from "@/lib/property-facts";
import { consumeRateLimit } from "@/lib/rate-limit";
import { checkStorms } from "@/lib/storm-watch";

export type FactsReply = { book?: Book; error?: string; summary?: string };

/** Looks the property up on FEMA's flood map again (placing it first if it isn't on the map), as the person asking. */
export async function checkFloodMap(dealId: string): Promise<FactsReply> {
  const viewer = await requirePermission("view_pipeline");
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  if (!(await consumeRateLimit(`flood-map:${viewer.id}`, 30, 60 * 60 * 1000))) return { error: "Too many lookups for now. Wait a while and try again." };
  const result = await mapProperty(String(dealId), { again: true, actor: viewer });
  await audit({ actorId: viewer.id, action: "property.flood_map", entityType: "LoanBook", entityId: String(dealId), after: { placed: result.placed, mapped: result.flood && !("error" in result.flood) ? result.flood.mapped : undefined, error: result.error } });
  return { book: scopeBook(result.after ?? (await readBook()).book, viewer), error: result.error };
}

/** Reads NHC's active storms and forecast cones now, rather than waiting for the job. */
export async function checkStormsNow(): Promise<FactsReply> {
  const viewer = await requirePermission("view_pipeline");
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  if (!(await hasPermission(viewer, "service_loans")) && !(await hasPermission(viewer, "view_reports"))) return { error: "Your account can't run the storm check." };
  if (!(await consumeRateLimit(`storm-check:${viewer.id}`, 12, 60 * 60 * 1000))) return { error: "The storm check ran a lot just now. Wait a while and try again." };
  const result = await checkStorms(new Date());
  await audit({ actorId: viewer.id, action: "storms.checked", entityType: "LoanBook", entityId: "storms", after: "error" in result ? { error: result.error } : { summary: result.summary } });
  return { book: scopeBook((await readBook()).book, viewer), ...("error" in result ? { error: result.error } : { summary: result.summary }) };
}
