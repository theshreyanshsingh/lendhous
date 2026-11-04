// Checks a restored copy of the database: the main collections are there, and a sample of the encrypted records open
// with this server's keys. A backup nobody has restored is only a hope.
import type { PrismaClient } from "@prisma/client";
import { openJson, readField } from "@/lib/crypto";
import { SEALED_LEAD_FIELDS, leadContext } from "@/lib/lead-store";
import { noticeContext } from "@/lib/notifications";
import { documentNameContext } from "@/lib/uploads";

export type RestoreReport = { counts: Record<string, number>; opened: Record<string, { checked: number; failed: number }>; problems: string[] };

export async function checkRestore(db: PrismaClient, sample = 25): Promise<RestoreReport> {
  const counts = { accounts: await db.user.count(), "loan book records": await db.bookRecord.count(), documents: await db.document.count(), leads: await db.lead.count(), "audit events": await db.auditEvent.count() };
  const opened: RestoreReport["opened"] = {};
  const tryOpen = <Row,>(name: string, rows: Row[], open: (row: Row) => unknown) => {
    let failed = 0;
    for (const row of rows) {
      try { open(row); } catch { failed++; }
    }
    opened[name] = { checked: rows.length, failed };
  };
  tryOpen("loan book records", await db.bookRecord.findMany({ take: sample, orderBy: { updatedAt: "desc" } }), (row) => openJson(row.data, `BookRecord:${row.id}`));
  tryOpen("document names", await db.document.findMany({ take: sample, orderBy: { createdAt: "desc" } }), (row) => readField(row.originalName, documentNameContext(row.id)));
  tryOpen("leads", await db.lead.findMany({ take: sample, orderBy: { createdAt: "desc" } }), (row) => SEALED_LEAD_FIELDS.forEach((field) => readField(row[field], leadContext(field, row.id))));
  tryOpen("notifications", await db.notification.findMany({ take: sample, orderBy: { createdAt: "desc" } }), (row) => readField(row.subject, noticeContext("subject", row.id)));
  const problems: string[] = [];
  if (!counts.accounts) problems.push("The copy has no accounts: it's empty or it's the wrong database.");
  for (const [name, result] of Object.entries(opened)) if (result.failed) problems.push(`${result.failed} of ${result.checked} ${name} wouldn't open with these keys.`);
  return { counts, opened, problems };
}
