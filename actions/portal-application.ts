"use server";

import { revalidatePath } from "next/cache";
import { digestOf, markSigned, savePortalDraft } from "@/lib/application-links";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import type { Book } from "@/lib/book";
import { scopeBook } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { runAction } from "@/lib/book-store";
import { completeDraft, CONSENT_VERSION, signatureProblem, STEPS, toLoan, type ConsentKey } from "@/lib/borrower-application";
import { isDemoEmail } from "@/lib/deploy";
import { screenAutomatically } from "@/lib/loan-intake";
import { viewFor } from "@/lib/permissions";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { servicingDate } from "@/lib/servicing";

const MAX_DRAFT = 200_000;

// The same application the secure link gives a borrower, filled in from their own portal: saved as they go, then signed
// with the same consents. Demo accounts keep theirs in the browser.
async function borrower() {
  const user = await requireUser();
  if (viewFor(user.roleCodes) !== "borrower") return { error: "Only a borrower's account applies here." } as const;
  if (isDemoEmail(user.email)) return { error: "Demo accounts keep their records in the browser." } as const;
  return { user } as const;
}

export async function savePortalApplication(raw: unknown, step: number): Promise<{ savedAt?: string; error?: string }> {
  const who = await borrower();
  if ("error" in who) return { error: who.error };
  if (!(await consumeRateLimit(`portal-app:${who.user.id}`, 900, 60 * 60 * 1000))) return { error: "Saving too often. Wait a minute." };
  const draft = completeDraft(raw);
  if (JSON.stringify(draft).length > MAX_DRAFT) return { error: "That's more than the form holds." };
  const now = new Date();
  await savePortalDraft(who.user, draft, Math.max(0, Math.min(STEPS.length - 1, Math.round(step) || 0)), now);
  return { savedAt: now.toISOString() };
}

/** Signs it and puts the loan in the book as the borrower's own application, with the signed copy kept on the loan. */
export async function signPortalApplication(raw: unknown, consents: Record<ConsentKey, boolean>, signatureName: string): Promise<{ book?: Book; dealId?: string; error?: string }> {
  const who = await borrower();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  if (!(await consumeRateLimit(`portal-sign:${user.id}`, 20, 60 * 60 * 1000))) return { error: "Too many tries. Wait a while and try again." };
  const draft = completeDraft(raw);
  const problem = signatureProblem(draft, consents, signatureName, servicingDate(new Date()));
  if (problem) return { error: problem };
  const loan = toLoan(draft);
  const result = await runAction(user, { t: "submitApp", app: loan.app, address: loan.address, city: loan.city, zip: loan.zip, entityName: loan.entityName, exitStrategy: loan.exitStrategy, closingDate: loan.closingDate, sponsor: loan.sponsor, refinances: loan.refinances });
  if ("error" in result) return { error: result.error };
  const dealId = result.after.deals.find((item) => !result.before.deals.some((old) => old.id === item.id))!.id;
  await sendAlerts(result.before, result.after, result.action);
  const now = new Date();
  const meta = await requestMeta();
  const id = await savePortalDraft(user, draft, STEPS.length - 1, now);
  await markSigned(id, draft, { name: signatureName.replace(/\s+/g, " ").trim(), at: now.toISOString(), ip: meta.ipAddress, userAgent: meta.userAgent ?? "", consents, version: CONSENT_VERSION, digest: digestOf(draft) }, dealId, now);
  await audit({ actorId: user.id, action: "application.signed", entityType: "ApplicationLink", entityId: id, after: { dealId, consentVersion: CONSENT_VERSION, from: "portal" } });
  const screened = await screenAutomatically(dealId);
  revalidatePath("/admin/borrower");
  return { book: scopeBook(screened ?? result.after, user), dealId };
}
