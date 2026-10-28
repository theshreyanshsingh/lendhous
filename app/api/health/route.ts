import { encryptionMode } from "@/lib/crypto";
import { resolveMailTransport } from "@/lib/mail-config";
import { prisma } from "@/lib/prisma";
import { limitStore } from "@/lib/rate-limit";
import { storageMode } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauthenticated, like UPB's: modes only, never secrets.
export async function GET() {
  let db: "ok" | "down" = "ok";
  try {
    await prisma.$runCommandRaw({ ping: 1 });
  } catch {
    db = "down";
  }
  const body = {
    ok: db === "ok",
    db,
    storage: storageMode(),
    mail: resolveMailTransport(),
    limits: limitStore(),
    encryption: encryptionMode(),
    cron: Boolean(process.env.CRON_SECRET),
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: db === "ok" ? 200 : 503 });
}
