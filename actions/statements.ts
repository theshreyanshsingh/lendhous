"use server";

import { hasPermission, requireUser } from "@/lib/auth";
import { firmOf } from "@/lib/book-access";
import { isDemoEmail } from "@/lib/deploy";
import { viewFor } from "@/lib/permissions";
import { statementsOf } from "@/lib/statement-store";
import { statementsForLoan } from "@/lib/borrower-statement-store";
import { readBook } from "@/lib/book-store";

/** The signed-in partner's or buyer's own monthly statements, newest first. */
export async function myStatements() {
  const user = await requireUser();
  const view = viewFor(user.roleCodes);
  if ((view !== "partner" && view !== "buyer") || isDemoEmail(user.email)) return [];
  return statementsOf({ type: view, id: firmOf(user) });
}

/** A loan's monthly statements, for its borrower or the team. Anyone else gets none. */
export async function loanStatements(dealId: string) {
  const user = await requireUser();
  if (isDemoEmail(user.email)) return [];
  const view = viewFor(user.roleCodes);
  const rows = await statementsForLoan(dealId);
  if (view === "admin") return (await hasPermission(user, "view_pipeline")) || (await hasPermission(user, "service_loans")) ? rows : [];
  return view === "borrower" && (await readBook()).book.deals.find((deal) => deal.id === dealId)?.borrowerId === user.id ? rows : [];
}
