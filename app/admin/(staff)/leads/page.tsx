import Link from "next/link";
import { markLeadContacted } from "@/actions/leads";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";
import { SendApplicationLink } from "@/components/SendApplicationLink";
import { linkSummaries } from "@/lib/application-links";
import { openLead, openQuote } from "@/lib/lead-store";
import { CITIZENSHIP_LABEL, CREDIT_LABEL } from "@/lib/quote";
import { notDeleted, prisma } from "@/lib/prisma";
import { PROPERTY_PHOTO } from "@/lib/property-photos";

export const metadata = { title: "Website leads" };
export const dynamic = "force-dynamic";

const money = (amountCents: number) => `$${Math.round(amountCents / 100).toLocaleString("en-US")}`;
const when = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function Leads() {
  await requirePermission("view_pipeline");
  const leads = (await prisma.lead.findMany({ where: notDeleted, orderBy: { createdAt: "desc" }, take: 200 })).map((row) => ({ ...openLead(row), request: openQuote(row) }));
  const links = await linkSummaries({ leadIds: leads.map((lead) => lead.id) });
  // Photos sent with each quote request, until the lead becomes a loan and they move to it.
  const photoRows = await prisma.document.findMany({ where: { ownerType: "LEAD", ownerId: { in: leads.map((lead) => lead.id) }, documentType: PROPERTY_PHOTO, ...notDeleted }, select: { id: true, ownerId: true }, orderBy: { createdAt: "asc" } });
  const photosFor = (leadId: string) => photoRows.filter((row) => row.ownerId === leadId);
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Website" title="Website leads" lede="Quote requests from the public site, from borrowers and brokers. Send the borrower the secure application link to turn one into a loan." />
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
                      <div>{lead.strategy}{lead.submitter === "broker" && <span className="ml-1 text-xs text-link">· broker</span>}</div>
                      <div className="text-xs text-muted-foreground">{lead.request ? `${lead.request.address.street}, ${lead.request.address.city}, ${lead.request.address.state} ${lead.request.address.zip}` : `${lead.city}, ${lead.state}`}{lead.experience ? ` · ${lead.experience}` : ""}</div>
                      {lead.request && <div className="text-xs text-muted-foreground">{CREDIT_LABEL[lead.request.creditBand]} credit · {CITIZENSHIP_LABEL[lead.request.citizenship]}{lead.request.comps.length ? ` · ${lead.request.comps.length} comp${lead.request.comps.length === 1 ? "" : "s"}` : ""}</div>}
                      {lead.targetClosing && <div className="text-xs text-muted-foreground">Target closing {lead.targetClosing}</div>}
                      {photosFor(lead.id).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1" data-testid="lead-photos">
                          {photosFor(lead.id).slice(0, 6).map((photo) => (
                            <a key={photo.id} href={`/api/documents/${photo.id}?view=1`} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in file, not a page image */}
                              <img src={`/api/documents/${photo.id}?view=thumb`} alt="Property photo" loading="lazy" className="size-12 rounded-[2px] object-cover" data-testid="lead-photo" />
                            </a>
                          ))}
                          {photosFor(lead.id).length > 6 && <span className="self-center text-xs text-muted-foreground">+{photosFor(lead.id).length - 6} more</span>}
                        </div>
                      )}
                    </div>
                  </td>
                  <td data-label="Requested" className="text-right lg:whitespace-nowrap">
                    <div>
                      <div className="font-medium">{lead.requestedLoanCents ? money(lead.requestedLoanCents) : "The max"}</div>
                      <div className="text-xs text-muted-foreground">Value {money(lead.propertyValueCents)}</div>
                      <div className="text-xs text-muted-foreground">Rehab {money(lead.renovationCents)}</div>
                      {lead.arvCents ? <div className="text-xs text-muted-foreground">ARV {money(lead.arvCents)}</div> : null}
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
                        <>
                          <Link href={`/admin/new-loan?lead=${lead.id}`} className="text-xs text-link underline underline-offset-2" data-testid="start-loan">Start a loan</Link>
                          {(() => { const link = links.find((item) => item.leadId === lead.id); return link ? <span className="text-xs text-muted-foreground" data-testid="lead-link-status">Link {link.state === "open" ? (link.savedAt ? `on step ${link.step + 1} of 5` : "sent, not opened yet") : link.state}</span> : null; })()}
                          <SendApplicationLink compact leadId={lead.id} name={lead.request ? `${lead.request.borrower.firstName} ${lead.request.borrower.lastName}` : lead.name} email={lead.request?.borrower.email ?? lead.email} />
                        </>
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
