import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";
import { q } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const when = (date: Date) => date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

// Read-only by design: nothing in the app updates or deletes these rows (lib/audit.ts).
export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("view_audit");
  const search = (q(await searchParams, "q") ?? "").trim();
  const events = await prisma.auditEvent.findMany({ where: search ? { action: { contains: search, mode: "insensitive" } } : undefined, orderBy: { createdAt: "desc" }, take: 200 });
  const actorIds = [...new Set(events.map((event) => event.actorId).filter((id): id is string => Boolean(id)))];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((user) => [user.id, user.email]));
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Account" title="Audit log" lede="Who did what, from where. The latest 200 events; times are Pacific." />
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
      </div>
    </div>
  );
}
