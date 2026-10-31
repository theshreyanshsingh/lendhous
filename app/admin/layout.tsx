import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";
import { ROLE_LABEL, viewFor } from "@/lib/permissions";
import { StoreProvider } from "@/lib/store";

// Every workspace needs a signed-in account. Demo data loads only for the seeded demo seats (@lendhous.test);
// any other account starts empty until its records come from the database, unless it loads the sample book itself.
// Each workspace's layout checks the role.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const demo = isDemoEmail(user.email);
  const account = { name: user.name, email: user.email, roles: user.roleCodes.map((role) => ROLE_LABEL[role]), demo, canManageMembers: await hasPermission(user, "manage_users") };
  return (
    <StoreProvider demo={demo} accountId={user.id} viewerName={user.name}>
      <Shell account={account} view={viewFor(user.roleCodes)}>{children}</Shell>
    </StoreProvider>
  );
}
