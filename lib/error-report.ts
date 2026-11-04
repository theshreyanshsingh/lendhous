// What an error report may carry. Pure, so it can be tested: the message loses anything that could be a person's data,
// and errors are grouped by what failed and where, not by the values involved.
import { createHash } from "node:crypto";

export type ErrorKind = "render" | "route" | "action" | "middleware" | "job";

/** Emails, phone and account numbers, tokens and quoted values out of a message; first line only, kept short. */
export function scrubMessage(message: string) {
  return (message.split("\n").find((line) => line.trim()) ?? "")
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[token]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, "$1…$1")
    .trim()
    .slice(0, 300) || "Unknown error";
}

/** The same failure in the same place groups together: the error's type, its first frames without line numbers, and the route. */
export function errorHash(error: { name?: string; stack?: string; message?: string }, route: string) {
  const frames = (error.stack ?? "").split("\n").slice(1, 4).map((line) => line.replace(/:\d+:\d+\)?$/, "").trim()).join("|");
  return createHash("sha256").update(`${error.name ?? "Error"}|${frames || scrubMessage(error.message ?? "")}|${route}`).digest("hex").slice(0, 32);
}

/** Next.js's own control-flow errors (redirects, not found) aren't failures. */
export const isControlFlow = (error: unknown) => {
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
};

/** A Sentry DSN taken apart, or null if it isn't one. */
export function parseDsn(dsn: string) {
  const match = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/);
  return match ? { endpoint: `${match[1]}://${match[3]}/api/${match[4]}/store/`, key: match[2] } : null;
}

/** The event sent to Sentry: the scrubbed message, the route and kind as tags, nothing else. */
export const sentryEvent = (message: string, route: string, kind: ErrorKind, at: Date, environment: string) => ({
  event_id: createHash("sha256").update(`${message}${route}${at.toISOString()}${Math.random()}`).digest("hex").slice(0, 32),
  timestamp: at.toISOString(), platform: "node", level: "error", logger: "lendhous", environment,
  message: { formatted: message }, tags: { route, kind },
});
