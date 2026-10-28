import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

export async function requestMeta() {
  try {
    const incoming = await headers();
    const forwarded = incoming.get("x-forwarded-for")?.split(",")[0]?.trim();
    return {
      ipAddress: forwarded || incoming.get("x-real-ip") || "unknown",
      userAgent: (incoming.get("user-agent") || "").slice(0, 300),
      requestId: incoming.get("x-vercel-id") || incoming.get("x-request-id") || randomUUID(),
    };
  } catch {
    // Outside a request (scripts, cron jobs run from the CLI).
    return { ipAddress: "system", userAgent: "", requestId: randomUUID() };
  }
}
