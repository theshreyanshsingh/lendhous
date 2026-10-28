import { prisma } from "@/lib/prisma";

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}

// "database" (default, shared across instances) or "memory" (per process). UPB also supports Redis; add it here if needed.
export function limitStore() {
  return (process.env.RATE_LIMIT_STORE || "database").toLowerCase() === "memory" ? "memory" : "database";
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const store = limitStore();
  try {
    if (store === "memory") return rateLimit(key, limit, windowMs, now);
    const slot = `${key}:${Math.floor(now / windowMs)}`;
    const row = await prisma.rateWindow.upsert({
      where: { key: slot },
      create: { key: slot, count: 1, expiresAt: new Date(now + windowMs) },
      update: { count: { increment: 1 } },
    });
    if (Math.random() < 0.02) {
      await prisma.rateWindow.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
    }
    return row.count <= limit;
  } catch {
    return rateLimit(key, limit, windowMs, now);
  }
}
