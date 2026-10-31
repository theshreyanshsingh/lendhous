import { requireView } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireView("admin");
  return <>{children}</>;
}
