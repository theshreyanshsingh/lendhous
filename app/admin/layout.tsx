import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { scopedBook } from "@/lib/book-store";
import { loadPricing } from "@/lib/pricing-store";
import { pricingPayload } from "@/lib/pricing-versions";
import { isDemoEmail } from "@/lib/deploy";
import { unansweredLeads } from "@/lib/lead-store";
import { recentErrors } from "@/lib/errors";
import { JOB_LABEL, staleJobs } from "@/lib/health";
import { lastJobRuns } from "@/lib/health-store";
import { unreadCount } from "@/lib/notifications";
import { ROLE_LABEL, viewFor } from "@/lib/permissions";
import { DEMO_BONUS } from "@/lib/referrals";
import { getSettings } from "@/lib/settings";
import { StoreProvider } from "@/lib/store";
import { streetViewOn } from "@/lib/street-view";
import { targetsFrom } from "@/lib/sla";

// Every workspace needs a signed-in account. Demo data loads only for the seeded demo seats (@lendhous.test);
// any other account starts empty until its records come from the database, unless it loads the sample book itself.
// Each workspace's layout checks the role.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const demo = isDemoEmail(user.email);
  const view = viewFor(user.roleCodes);
  const [canManageMembers, canViewAudit, canManageSettings, canRouteCapital, canManageCapital, canManagePricing, canViewReports, canIssueLetters, canManageBrokers, unread, newLeads, settings] = await Promise.all([
    hasPermission(user, "manage_users"),
    hasPermission(user, "view_audit"),
    hasPermission(user, "manage_roles"),
    hasPermission(user, "route_capital"),
    hasPermission(user, "manage_capital"),
    hasPermission(user, "manage_pricing"),
    hasPermission(user, "view_reports"),
    hasPermission(user, "issue_term_sheet"),
    hasPermission(user, "manage_brokers"),
    unreadCount(user),
    view === "admin" ? unansweredLeads() : 0,
    getSettings(),
  ]);
  // Owners on a real account hear when the nightly jobs stop, and see how many errors are open.
  const watch = canManageSettings && !demo;
  const [stale, openErrors] = watch ? await Promise.all([lastJobRuns().then((runs) => staleJobs(runs, new Date())), recentErrors(new Date(Date.now() - 7 * 86_400_000))]) : [[], 0];
  const account = { name: user.name, email: user.email, roles: user.roleCodes.map((role) => ROLE_LABEL[role]), demo, canManageMembers, canViewAudit, canManageSettings, canManageFirms: canRouteCapital || canManageCapital, canManagePricing, canViewReports, canIssueLetters, canManageBrokers, staleJobs: stale.map((job) => JOB_LABEL[job]), openErrors, unread, offerSample: settings.offerSampleData !== false };
  return (
    // Every page, demo seats too, prices new quotes on the version the server does, so the two render the same.
    <StoreProvider demo={demo} accountId={user.id} viewerName={user.name} viewerEmail={user.email} initialBook={demo ? undefined : await scopedBook(user)} pricing={(await loadPricing(), pricingPayload([]))} newLeads={newLeads} streetView={!demo && streetViewOn()} targets={targetsFrom(settings.slaTargets as never)} paymentInstructions={demo ? "" : settings.paymentInstructions} referralBonus={demo ? DEMO_BONUS : settings.referralBonusCents / 100} reviewUrl={demo ? "" : settings.reviewUrl}>
      <Shell account={account} view={view}>{children}</Shell>
    </StoreProvider>
  );
}
