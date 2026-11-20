import { redirect } from "next/navigation";
import { hasPermission, requireUser } from "@/lib/auth";
import { firmOf } from "@/lib/book-access";
import { homeFor } from "@/lib/permissions";
import { notDeleted, prisma } from "@/lib/prisma";
import { FileOpensLog } from "@/components/FileOpensLog";
import { loadBook } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { holderOpens } from "@/lib/view-log";
import { PartnersBoard, type FirmAccount } from "./partners-board";

export const metadata = { title: "Partners & buyers" };
export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const user = await requireUser();
  if (!(await hasPermission(user, "route_capital")) && !(await hasPermission(user, "manage_capital"))) redirect(homeFor(user.roleCodes));
  const accounts = await prisma.user.findMany({ where: { ...notDeleted, roles: { some: { role: { in: ["PARTNER_LENDER", "LOAN_BUYER"] } } } }, include: { roles: true, organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const rows: FirmAccount[] = accounts.map((account) => ({
    firmId: firmOf({ id: account.id, name: account.name, roleCodes: account.roles.map((row) => row.role), organizationId: account.organizationId }),
    kind: account.roles.some((row) => row.role === "PARTNER_LENDER") ? "partner" : "buyer",
    name: account.organization?.name ?? account.name,
    email: account.email,
  }));
  // Who opened which file, from the audit log; demo seats see none of the real accounts' activity.
  const demo = isDemoEmail(user.email);
  const opens = demo ? [] : await holderOpens(accounts.map((account, index) => ({ id: account.id, name: account.name, firm: rows[index].name })));
  const loans = demo ? new Map<string, string>() : new Map((await loadBook()).book.deals.map((deal) => [deal.id, deal.loanNumber]));
  return (
    <div className="space-y-4">
      <PartnersBoard accounts={rows} />
      <FileOpensLog opens={opens.map((open) => ({ ...open, loan: open.dealId ? loans.get(open.dealId) : undefined }))} demo={demo} />
    </div>
  );
}
