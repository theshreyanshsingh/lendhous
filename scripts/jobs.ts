import { existsSync } from "node:fs";

// For hosts without Vercel Cron (pm2: --cron-restart). Runs every job that hasn't run today, or only the jobs named
// (`tsx scripts/jobs.ts storms`, which the six-hourly storm watch uses).
if (existsSync(".env")) process.loadEnvFile(".env");

const { JOBS, runAllJobs, runJob } = await import("../lib/jobs");
const { prisma } = await import("../lib/prisma");
const named = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const unknown = named.filter((job) => !(job in JOBS));
if (unknown.length) throw new Error(`No job named ${unknown.join(", ")}. The jobs are ${Object.keys(JOBS).join(", ")}.`);
try {
  const results = named.length ? await Promise.all(named.map((job) => runJob(job))) : await runAllJobs();
  for (const result of results) console.log(`${result.job}: ${result.summary}`);
} finally {
  await prisma.$disconnect();
}
