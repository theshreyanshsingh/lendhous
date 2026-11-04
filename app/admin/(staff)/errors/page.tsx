import { markErrorFixed } from "@/actions/errors";
import { PageIntro } from "@/components/page-intro";
import { Badge } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Errors" };
export const dynamic = "force-dynamic";

const when = (date: Date) => date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const KIND: Record<string, string> = { render: "Page", route: "API", action: "Form or button", middleware: "Sign-in check", job: "Nightly job" };

// What broke on the server, grouped, newest first. Messages have personal data taken out before they're saved.
export default async function ErrorsPage() {
  await requirePermission("manage_roles");
  const rows = await prisma.errorEvent.findMany({ orderBy: { lastAt: "desc" }, take: 100 });
  const open = rows.filter((row) => !row.resolvedAt);
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Account" title="Errors" lede="What failed on the server, grouped by what and where. Mark one fixed once it's dealt with; it comes back if it happens again. Times are Eastern." />
      <div className="glass overflow-hidden">
        <div className="border-b border-border p-3 text-sm text-muted-foreground" data-testid="errors-summary">{open.length ? `${open.length} not marked fixed.` : "Nothing open. The server hasn't recorded a failure that isn't marked fixed."}</div>
        <div className="px-4 lg:px-0">
          <table className="stack-table w-full" data-testid="errors-table">
            <thead><tr className="border-b border-rule"><th>What failed</th><th>Where</th><th className="text-right">Times</th><th>Last</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="text-muted-foreground">No errors recorded.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border align-top last:border-0" data-testid="error-row">
                  <td><span className="font-medium wrap-anywhere">{row.message}</span><div className="mt-1">{row.resolvedAt ? <Badge tone="green">Fixed</Badge> : <Badge tone="rose">Open</Badge>}</div></td>
                  <td data-label="Where"><span className="font-mono text-xs wrap-anywhere">{row.route}</span><div className="text-xs text-muted-foreground">{KIND[row.kind] ?? row.kind}</div></td>
                  <td data-label="Times" className="text-right tabular-nums">{row.count}</td>
                  <td data-label="Last" className="lg:whitespace-nowrap">{when(row.lastAt)}<div className="text-xs text-muted-foreground">first {when(row.firstAt)}</div></td>
                  <td className="text-right">{!row.resolvedAt && <form action={markErrorFixed}><input type="hidden" name="id" value={row.id} /><button type="submit" className="btn-ghost h-8! text-xs!" data-testid="mark-fixed">Mark fixed</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
