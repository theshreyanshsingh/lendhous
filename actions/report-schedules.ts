"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";
import { readSchedules, recipients, writeSchedules } from "@/lib/report-schedule-store";
import { REPORT_KINDS, scheduleProblem, type ReportKind, type ReportSchedule } from "@/lib/scheduled-reports";

const back = (params: Record<string, string>) => redirect(`/admin/reports?${new URLSearchParams(params)}#scheduled`);

async function scheduler() {
  const actor = await requirePermission("view_reports");
  if (isDemoEmail(actor.email)) back({ error: "Demo seats can download the reports but don't schedule them." });
  return actor;
}

/** Adds a schedule: a report, weekly or monthly, to people with accounts that may see it. */
export async function saveReportSchedule(formData: FormData) {
  const actor = await scheduler();
  const every = formData.get("every") === "month" ? "month" : "week";
  const kind = String(formData.get("kind") ?? "") as ReportKind;
  const day = Number(formData.get(every === "week" ? "weekday" : "monthday"));
  const ids = [...new Set(formData.getAll("to").map(String))].slice(0, 26);
  // Only accounts that can open the report now: the rest are dropped, not trusted from the form.
  const to = (ids.length ? await recipients(ids) : []).map((person) => ({ id: person.id, name: person.name }));
  const problem = scheduleProblem({ kind, every, day, to });
  if (problem) back({ error: problem });
  const schedule: ReportSchedule = { id: crypto.randomUUID(), kind, every, day, to, by: actor.name, at: new Date().toISOString() };
  await writeSchedules([...(await readSchedules()), schedule]);
  await audit({ actorId: actor.id, action: "report_schedule.created", entityType: "PlatformSettings", entityId: "default", after: { kind, every, day, to: to.map((person) => person.id) } });
  revalidatePath("/admin/reports");
  back({ notice: `${REPORT_KINDS[kind].label} report scheduled.` });
}

export async function removeReportSchedule(formData: FormData) {
  const actor = await scheduler();
  const id = String(formData.get("id") ?? "");
  const schedules = await readSchedules();
  const gone = schedules.find((item) => item.id === id);
  if (!gone) back({ error: "That schedule is already gone." });
  await writeSchedules(schedules.filter((item) => item.id !== id));
  await audit({ actorId: actor.id, action: "report_schedule.removed", entityType: "PlatformSettings", entityId: "default", before: { kind: gone!.kind, every: gone!.every, day: gone!.day } });
  revalidatePath("/admin/reports");
  back({ notice: "Schedule stopped." });
}
