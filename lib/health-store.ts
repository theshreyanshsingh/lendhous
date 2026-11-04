// Reads what the health check needs: whether the database answers, and when each nightly job last finished.
import { JOBS } from "@/lib/jobs";
import { prisma } from "@/lib/prisma";

export async function lastJobRuns() {
  const entries = await Promise.all(Object.keys(JOBS).map(async (job) => [job, (await prisma.jobRun.findFirst({ where: { job, ok: true }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }))?.finishedAt ?? null] as const));
  return Object.fromEntries(entries) as Record<string, Date | null>;
}

export async function databaseUp() {
  try {
    await prisma.$runCommandRaw({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
