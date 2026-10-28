import { existsSync } from "node:fs";

// For hosts without Vercel Cron (pm2: --cron-restart). Runs every job that hasn't run today.
if (existsSync(".env")) process.loadEnvFile(".env");

const { runAllJobs } = await import("../lib/jobs");
const { prisma } = await import("../lib/prisma");
try {
  for (const result of await runAllJobs()) console.log(`${result.job}: ${result.summary}`);
} finally {
  await prisma.$disconnect();
}
