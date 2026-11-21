import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";
import { q } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

/** Events a page shows: a phone scrolls through 50 comfortably; older ones are a link away. */
const PAGE = 50;
const when = (date: Date) => date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

// Read-only by design: nothing in the app updates or deletes these rows (lib/audit.ts).
export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("view_audit");
  const params = await searchParams;
  const search = (q(params, "q") ?? "").trim();
  // Older pages start before the last event shown, so new events coming in don't shift what's on them.
  const beforeParam = q(params, "before");
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam) : null;
  const found = await prisma.auditEvent.findMany({ where: { ...(search ? { action: { contains: search, mode: "insensitive" as const } } : {}), ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: "desc" }, take: PAGE + 1 });
  const events = found.slice(0, PAGE);
  const older = found.length > PAGE ? events[events.length - 1].createdAt.toISOString() : null;
  const link = (extra: Record<string, string>) => `/admin/audit?${new URLSearchParams({ ...(search ? { q: search } : {}), ...extra })}`;
  const actorIds = [...new Set(events.map((event) => event.actorId).filter((id): id is string => Boolean(id)))];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((user) => [user.id, user.email]));
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Account" title="Audit log" lede="Who did what, from where. Newest first, 50 to a page; times are Pacific." />
      <div className="glass overflow-hidden">
        <form className="flex flex-wrap gap-2 border-b border-border p-3">
          <input name="q" defaultValue={search} className="desk-input min-w-0 flex-1 sm:w-72 sm:flex-none" placeholder="Filter by action, like auth or member" aria-label="Filter by action" data-testid="audit-search" />
          <button type="submit" className="btn-ghost">Filter</button>
        </form>
        <div className="px-4 lg:px-0">
          <table className="stack-table w-full" data-testid="audit-table">
            <thead><tr className="border-b border-rule"><th>Action</th><th>When</th><th>Who</th><th>From</th></tr></thead>
            <tbody>
              {events.length === 0 && <tr><td colSpan={4} className="text-muted-foreground">No events match.</td></tr>}
              {events.map((event) => (
                <tr key={event.id} className="border-b border-border align-top last:border-0" data-testid="audit-row">
                  <td>
                    <span className="font-medium">{event.action}</span>
                    {(event.before || event.after) && (
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Details</summary>
                        <pre className="mt-1 font-mono text-[11px] wrap-anywhere whitespace-pre-wrap">{JSON.stringify({ before: event.before ?? undefined, after: event.after ?? undefined }, null, 1)}</pre>
                      </details>
                    )}
                  </td>
                  <td data-label="When" className="lg:whitespace-nowrap">{when(event.createdAt)}</td>
                  <td data-label="Who">{event.actorId ? actors.get(event.actorId) ?? "Removed account" : "Not signed in"}</td>
                  <td data-label="From">{event.actorIp || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(before || older) && (
          <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-sm" aria-label="Audit log pages" data-testid="audit-pages">
            {before ? <Link href={link({})} className="btn-ghost">Newest events</Link> : <span />}
            {older && <Link href={link({ before: older })} className="btn-ghost" data-testid="audit-older">Older events</Link>}
          </nav>
        )}
      </div>
    </div>
  );
}
