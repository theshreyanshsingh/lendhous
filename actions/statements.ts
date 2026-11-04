"use server";

import { requireUser } from "@/lib/auth";
import { firmOf } from "@/lib/book-access";
import { isDemoEmail } from "@/lib/deploy";
import { viewFor } from "@/lib/permissions";
import { statementsOf } from "@/lib/statement-store";

/** The signed-in partner's or buyer's own monthly statements, newest first. */
export async function myStatements() {
  const user = await requireUser();
  const view = viewFor(user.roleCodes);
  if ((view !== "partner" && view !== "buyer") || isDemoEmail(user.email)) return [];
  return statementsOf({ type: view, id: firmOf(user) });
}
