import { encryptionMode } from "@/lib/crypto";
import { STALE_HOURS, staleJobs } from "@/lib/health";
import { lastJobRuns } from "@/lib/health-store";
import { resolveMailTransport } from "@/lib/mail-config";
import { prisma } from "@/lib/prisma";
import { limitStore } from "@/lib/rate-limit";
import { storageMode } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauthenticated, like UPB's: modes only, never secrets. With ?watch=jobs (what the uptime monitor calls) it's also
// 503 when the servicing or sanctions job hasn't finished in STALE_HOURS, so a stopped jobs process raises the alarm.
export async function GET(request: Request) {
  let db: "ok" | "down" = "ok";
  try {
    await prisma.$runCommandRaw({ ping: 1 });
  } catch {
    db = "down";
  }
  // When the nightly servicing check last finished, so an uptime monitor can tell when late payments stop being caught.
  let servicingCheckedAt: string | null = null;
  // And when Treasury's sanctions list was last downloaded: screenings against a stale list prove less every day.
  let sanctionsListAt: string | null = null;
  let stale: string[] = [];
  if (db === "ok") {
    try {
      const run = await prisma.jobRun.findFirst({ where: { job: "servicing", ok: true }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
      servicingCheckedAt = run?.finishedAt?.toISOString() ?? null;
      sanctionsListAt = (await prisma.sanctionsList.findUnique({ where: { id: "sdn" }, select: { fetchedAt: true } }))?.fetchedAt.toISOString() ?? null;
      stale = staleJobs(await lastJobRuns(), new Date());
    } catch {
      servicingCheckedAt = null;
    }
  }
  const body = {
    ok: db === "ok",
    db,
    storage: storageMode(),
    mail: resolveMailTransport(),
    limits: limitStore(),
    encryption: encryptionMode(),
    cron: Boolean(process.env.CRON_SECRET),
    servicingCheckedAt,
    sanctionsListAt,
    staleJobs: stale,
    staleAfterHours: STALE_HOURS,
    time: new Date().toISOString(),
  };
  const watching = new URL(request.url).searchParams.get("watch") === "jobs";
  return Response.json(body, { status: db !== "ok" || (watching && stale.length) ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
