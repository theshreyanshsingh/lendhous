import Shell from "@/components/Shell";
import { getCurrentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { StoreProvider } from "@/lib/store";

// The prototype pages still run on browser data; B1 and B2 move them behind sign-in. Until then the shell only
// shows who is signed in. getCurrentUser() skips the database entirely when there is no session cookie.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const account = user ? { name: user.name, email: user.email, roles: user.roleCodes.map((role) => ROLE_LABEL[role]) } : null;
  return (
    <StoreProvider>
      <Shell account={account}>{children}</Shell>
    </StoreProvider>
  );
}
