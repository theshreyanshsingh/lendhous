import Link from "next/link";
import { markLeadContacted } from "@/actions/leads";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";
import { notDeleted, prisma } from "@/lib/prisma";

export const metadata = { title: "Website leads" };
export const dynamic = "force-dynamic";

const money = (amountCents: number) => `$${Math.round(amountCents / 100).toLocaleString("en-US")}`;
const when = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function Leads() {
  await requirePermission("view_pipeline");
  const leads = await prisma.lead.findMany({ where: notDeleted, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Website" title="Website leads" lede="Project briefs sent from the public site's Let's talk form. These are conversations, not applications: no credit has been pulled." />
      <div className="glass overflow-hidden px-4 lg:px-0">
        <div className="lg:overflow-x-auto">
          <table className="stack-table w-full lg:min-w-[900px]" data-testid="leads-table">
            <thead>
              <tr className="border-b border-rule"><th>Contact</th><th>Received</th><th>Project</th><th className="text-right">Requested</th><th>Notes</th><th>Status</th></tr>
            </thead>
            <tbody>
              {leads.length === 0 && <tr><td colSpan={6} className="text-muted-foreground">No briefs yet.</td></tr>}
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-border align-top last:border-0">
                  <td>
                    <div className="font-medium">{lead.name}</div>
                    <a className="block text-xs text-link underline underline-offset-2" href={`mailto:${lead.email}`}>{lead.email}</a>
                    {lead.phone && <a className="block text-xs text-link underline underline-offset-2" href={`tel:${lead.phone}`}>{lead.phone}</a>}
                  </td>
                  <td data-label="Received" className="lg:whitespace-nowrap">{when(lead.createdAt)}</td>
                  <td data-label="Project">
                    <div>
                      <div>{lead.strategy}</div>
                      <div className="text-xs text-muted-foreground">{lead.city}, {lead.state}{lead.experience ? ` · ${lead.experience}` : ""}</div>
                      {lead.targetClosing && <div className="text-xs text-muted-foreground">Target closing {lead.targetClosing}</div>}
                    </div>
                  </td>
                  <td data-label="Requested" className="text-right lg:whitespace-nowrap">
                    <div>
                      <div className="font-medium">{money(lead.requestedLoanCents)}</div>
                      <div className="text-xs text-muted-foreground">Value {money(lead.propertyValueCents)}</div>
                      <div className="text-xs text-muted-foreground">Rehab {money(lead.renovationCents)}</div>
                    </div>
                  </td>
                  <td className="text-[13px] whitespace-pre-wrap lg:max-w-[320px]">{lead.notes}</td>
                  <td data-label="Status" className="lg:whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1 lg:items-start">
                      {lead.contactedAt ? (
                        <span className="text-xs text-muted-foreground">Contacted {when(lead.contactedAt)}</span>
                      ) : (
                        <form action={markLeadContacted}>
                          <input type="hidden" name="id" value={lead.id} />
                          <button type="submit" className="btn-ghost h-8! px-3! text-xs!">Mark contacted</button>
                        </form>
                      )}
                      {lead.loanId ? (
                        <Link href={`/admin/deals/${lead.loanId}`} className="text-xs text-link underline underline-offset-2" data-testid="lead-loan">Open the loan</Link>
                      ) : (
                        <Link href={`/admin/new-loan?lead=${lead.id}`} className="text-xs text-link underline underline-offset-2" data-testid="start-loan">Start a loan</Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
