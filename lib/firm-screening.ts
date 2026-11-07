// Screening the firms whose money LendHous takes (partner lenders and loan buyers) with their owners and officers, the
// people who sign in for them and the names on their tax forms; and brokerages again after they apply. The rules are
// in lib/ofac.ts; this part reads the names from the database and records the result in the loan book.
import type { Book } from "@/lib/book";
import type { Viewer } from "@/lib/book-access";
import { readBook, runAction } from "@/lib/book-store";
import { firmSubjects } from "@/lib/ofac";
import { notDeleted, prisma } from "@/lib/prisma";
import { screenNames } from "@/lib/sanctions-store";
import { currentTaxForm } from "@/lib/tax-form-store";

export type FirmKind = "partner" | "buyer";

/** The names behind a partner or buyer: the people who sign in for it, and the names on its W-9 or W-8. */
export async function firmPeople(kind: FirmKind, firmId: string): Promise<string[]> {
  const role = kind === "partner" ? "PARTNER_LENDER" : "LOAN_BUYER";
  const users = await prisma.user.findMany({ where: { AND: [notDeleted, { roles: { some: { role } } }, { OR: [{ organizationId: firmId }, { id: firmId }] }] }, select: { name: true } });
  const tax = await currentTaxForm({ type: kind, id: firmId });
  const taxNames = !tax ? [] : tax.kind === "w9" ? [tax.form.legalName, tax.form.businessName] : [tax.form.name];
  return [...users.map((user) => user.name), ...taxNames].filter((name) => Boolean(name?.trim()));
}

/** Screens one partner or buyer now and records it. */
export async function screenFirm(kind: FirmKind, firmId: string, by: Viewer, now = new Date()) {
  const { book } = await readBook();
  const firm = (kind === "partner" ? book.partners : book.buyers).find((item) => item.id === firmId);
  if (!firm) return { error: "That firm is no longer on file." };
  const screening = await screenNames(firmSubjects(firm, await firmPeople(kind, firmId)), by.name, now);
  if ("error" in screening) return screening;
  return runAction(by, { t: "firmScreened", kind, firmId, screening }, { trusted: true });
}

/** Screens a brokerage that has applied, with the owners it listed, and records it. */
export async function screenBrokerage(book: Book, brokerId: string, by: Viewer, now = new Date()) {
  const broker = book.brokers.find((item) => item.id === brokerId);
  if (!broker?.application) return { error: "This brokerage hasn't signed the broker agreement." };
  const screening = await screenNames(firmSubjects({ name: broker.application.legalName, principals: broker.application.principals }), by.name, now);
  if ("error" in screening) return screening;
  return runAction(by, { t: "brokerScreened", brokerId, screening }, { trusted: true });
}
