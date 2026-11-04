// Records server errors for the owners' errors page and the morning email, and forwards them to Sentry when
// SENTRY_DSN is set. Recording never throws: a broken error log must not break the page that failed.
import { errorHash, isControlFlow, parseDsn, scrubMessage, sentryEvent, type ErrorKind } from "@/lib/error-report";
import { prisma } from "@/lib/prisma";

export async function recordError(error: unknown, route: string, kind: ErrorKind) {
  if (isControlFlow(error)) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = scrubMessage(err.message);
    const hash = errorHash(err, route);
    const now = new Date();
    await prisma.errorEvent.upsert({ where: { hash }, create: { hash, message, route, kind, firstAt: now, lastAt: now }, update: { count: { increment: 1 }, lastAt: now, message, resolvedAt: null } });
    await forward(message, route, kind, now);
  } catch (failure) {
    console.error("[lendhous-errors] couldn't record an error:", failure);
  }
}

async function forward(message: string, route: string, kind: ErrorKind, at: Date) {
  const dsn = parseDsn(process.env.SENTRY_DSN ?? "");
  if (!dsn) return;
  await fetch(dsn.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=lendhous/1.0` },
    body: JSON.stringify(sentryEvent(message, route, kind, at, process.env.LENDHOUS_RELEASE ? "production" : "development")),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

/** Errors that happened since a moment and aren't marked fixed, for the morning email and the menu. */
export const recentErrors = (since: Date) => prisma.errorEvent.count({ where: { lastAt: { gte: since }, OR: [{ resolvedAt: null }, { resolvedAt: { isSet: false } }] } });
