"use server";

import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import type { Book } from "@/lib/book";
import { scopeBook } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { permissionCheck, readBook, runAction } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { sendLetterMail } from "@/lib/email";
import { evaluate } from "@/lib/engine";
import { noticeContent, noticeOwed, reasonsProblem } from "@/lib/adverse-action";
import { noticePdf } from "@/lib/adverse-action-pdf";
import { prisma } from "@/lib/prisma";
import { servicingDate } from "@/lib/servicing";
import { getSettings } from "@/lib/settings";

type Reply = { book?: Book; error?: string };

/**
 * Sends the decline notice, or for a business over $1 million the statement of reasons it asked for (12 CFR 1002.9): a
 * PDF letter emailed to the borrower's sign-in address, or marked as mailed for the team to post. It carries the
 * lender's address, so it won't go without one in Settings.
 */
export async function sendAdverseNotice(dealId: string, kind: "notice" | "statement", method: "email" | "mail"): Promise<Reply> {
  const viewer = await requireUser();
  if (isDemoEmail(viewer.email)) return { error: "Demo accounts keep their records in the browser." };
  if (!(await permissionCheck(viewer))("issue_term_sheet")) return { error: "Your account can't send decline notices." };
  const { book } = await readBook();
  const deal = book.deals.find((item) => item.id === dealId);
  const owed = deal && noticeOwed(deal);
  if (!deal || !owed || owed.kind !== kind) return { error: "There's no notice waiting on this loan." };
  const action = deal.adverseAction!;
  if (kind === "statement" || !action.large) { const refused = reasonsProblem(action.reasons); if (refused) return { error: refused }; }
  // Read fresh, not from the settings cache: the address may have been added a moment ago.
  const settings = (await prisma.platformSettings.findUnique({ where: { id: "default" } })) ?? (await getSettings());
  if (!settings.lenderAddress.trim()) return { error: "Add LendHous's mailing address in Settings first: the notice has to carry it (12 CFR 1002.9(a)(2))." };
  let to: string[] = [];
  let result: "sent" | "logged" | "failed" | undefined;
  if (method === "email") {
    to = (await prisma.user.findMany({ where: { id: deal.borrowerId || "none" }, select: { email: true } })).map((user) => user.email);
    if (!to.length) return { error: "The borrower has no sign-in email. Download it and mail it instead." };
    const lender = { name: process.env.LENDER_NAME || "LendHous", address: settings.lenderAddress, phone: settings.lenderPhone };
    const content = noticeContent(deal, action, kind, lender, evaluate(deal.app).noteAmount, servicingDate(new Date()));
    const pdf = { filename: `${kind === "notice" ? "notice-of-action" : "statement-of-reasons"}-${deal.loanNumber}.pdf`, content: await noticePdf(content) };
    const results = [];
    for (const email of to) results.push(await sendLetterMail(email, `${content.title}: ${deal.loanNumber}`, `Dear ${deal.borrowerName.split(" ")[0]},\n\nPlease see the attached letter about your application for ${deal.address}, ${deal.city}.\n\n${lender.name}`, pdf));
    result = results.includes("failed") ? "failed" : results.every((item) => item === "logged") ? "logged" : "sent";
  }
  const saved = await runAction(viewer, { t: "recordAdverseNotice", dealId, kind, method, to, ...(result ? { result } : {}), by: viewer.name }, { trusted: true });
  if ("error" in saved) return { error: saved.error };
  await audit({ actorId: viewer.id, action: `adverse_action.${kind}_sent`, entityType: "LoanBook", entityId: dealId, after: { method, result: result ?? "mailed" } });
  await sendAlerts(saved.before, saved.after, saved.action);
  return { book: scopeBook(saved.after, viewer) };
}
