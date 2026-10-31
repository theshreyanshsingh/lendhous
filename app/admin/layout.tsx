import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { scopedBook } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { unreadCount } from "@/lib/notifications";
import { ROLE_LABEL, viewFor } from "@/lib/permissions";
import { notDeleted, prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { StoreProvider } from "@/lib/store";

// Every workspace needs a signed-in account. Demo data loads only for the seeded demo seats (@lendhous.test);
// any other account starts empty until its records come from the database, unless it loads the sample book itself.
// Each workspace's layout checks the role.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const demo = isDemoEmail(user.email);
  const view = viewFor(user.roleCodes);
  const [canManageMembers, canViewAudit, canManageSettings, canRouteCapital, canManageCapital, unread, newLeads, settings] = await Promise.all([
    hasPermission(user, "manage_users"),
    hasPermission(user, "view_audit"),
    hasPermission(user, "manage_roles"),
    hasPermission(user, "route_capital"),
    hasPermission(user, "manage_capital"),
    unreadCount(user),
    // A brief no one has answered. On MongoDB `null` only matches a stored null, so check for the field being unset too.
    view === "admin" ? prisma.lead.count({ where: { ...notDeleted, AND: [{ OR: [{ contactedAt: null }, { contactedAt: { isSet: false } }] }] } }) : 0,
    getSettings(),
  ]);
  const account = { name: user.name, email: user.email, roles: user.roleCodes.map((role) => ROLE_LABEL[role]), demo, canManageMembers, canViewAudit, canManageSettings, canManageFirms: canRouteCapital || canManageCapital, unread, offerSample: settings.offerSampleData !== false };
  return (
    <StoreProvider demo={demo} accountId={user.id} viewerName={user.name} initialBook={demo ? undefined : await scopedBook(user)} newLeads={newLeads}>
      <Shell account={account} view={view}>{children}</Shell>
    </StoreProvider>
  );
}
