import ApplicationWizard, { type LoanPrefill } from "@/components/ApplicationWizard";
import { requirePermission } from "@/lib/auth";
import type { Product } from "@/lib/engine";
import { q } from "@/lib/format";
import { openLead, openQuote } from "@/lib/lead-store";
import { PRICED } from "@/lib/quote";
import { notDeleted, prisma } from "@/lib/prisma";

export const metadata = { title: "New loan" };
export const dynamic = "force-dynamic";

// The website form's strategies, as the application's loan products.
const PRODUCT_FOR: Record<string, Product> = { "Fix & flip": "fix_flip", "DSCR rental": "dscr", "Bridge financing": "bridge", "Ground-up construction": "ground_up", "Rental portfolio": "dscr" };

export default async function NewLoan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("view_pipeline");
  const leadId = q(await searchParams, "lead");
  const row = leadId ? await prisma.lead.findFirst({ where: { id: leadId, ...notDeleted } }) : null;
  const lead = row && openLead(row);
  // A quote request has the borrower (not a broker), the street address and the ARV too.
  const request = row && openQuote(row);
  const prefill: LoanPrefill | undefined = lead
    ? {
        leadId: lead.id,
        name: request ? `${request.borrower.firstName} ${request.borrower.lastName}` : lead.name,
        email: request ? request.borrower.email : lead.email,
        product: (request && PRICED[request.loanType]) || (PRODUCT_FOR[lead.strategy] ?? "fix_flip"),
        city: lead.city,
        state: lead.state.trim().toUpperCase(),
        address: request?.address.street,
        zip: request?.address.zip,
        county: request?.address.county,
        arv: request?.arv,
        purchasePrice: Math.round(lead.propertyValueCents / 100),
        rehab: Math.round(lead.renovationCents / 100),
        requestedAmount: Math.round(lead.requestedLoanCents / 100) || undefined,
        notes: lead.notes,
      }
    : undefined;
  return <ApplicationWizard mode="staff" prefill={prefill} />;
}
