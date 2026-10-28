// Scheduled jobs. UPB runs one daily batch; Lendhous will need several nightly jobs (interest accrual, maturity and
// delinquency moves, insurance expiry, OFAC re-checks), so each job is named and runs at most once per day: the
// JobRun.runKey unique index makes a second cron call that day a no-op. B0 ships the housekeeping jobs.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

type Job = (now: Date) => Promise<string>;

async function purgeSessions(now: Date) {
  const [sessions, codes, windows] = await Promise.all([
    prisma.serverSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.loginCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateWindow.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return `removed ${sessions.count} expired sessions, ${codes.count} login codes, ${windows.count} rate windows`;
}

async function cleanRetention(now: Date) {
  const settings = await getSettings();
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - settings.retentionYears);
  // Read, non-legal notices only. Loan files and the audit log are never purged here (Spec v3 10.5 legal hold).
  const notices = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff }, readAt: { not: null }, legal: false } });
  return `retention removed ${notices.count} read notices`;
}

export const JOBS: Record<string, Job> = { sessions: purgeSessions, retention: cleanRetention };

export const runKeyFor = (job: string, now: Date) => `${job}:${now.toISOString().slice(0, 10)}`;

export async function runJob(job: string, now = new Date()) {
  const fn = JOBS[job];
  if (!fn) throw new Error(`No job named ${job}.`);
  const runKey = runKeyFor(job, now);
  let run;
  try {
    run = await prisma.jobRun.create({ data: { job, runKey } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { job, skipped: true, summary: "already ran today" };
    throw error;
  }
  try {
    const summary = await fn(now);
    await prisma.jobRun.update({ where: { id: run.id }, data: { ok: true, finishedAt: new Date(), summary } });
    return { job, skipped: false, summary };
  } catch (error) {
    // Free today's key so the next call retries, and keep the failure under a separate key.
    const summary = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({ where: { id: run.id }, data: { runKey: `${runKey}:failed:${Date.now()}`, finishedAt: new Date(), summary } });
    console.error(`[lendhous-jobs] ${job} failed:`, error);
    return { job, skipped: false, failed: true, summary };
  }
}

export async function runAllJobs(now = new Date()) {
  const results = [];
  for (const job of Object.keys(JOBS)) results.push(await runJob(job, now));
  return results;
}
