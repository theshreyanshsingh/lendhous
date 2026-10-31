import { requireView } from "@/lib/auth";

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  await requireView("buyer");
  return <>{children}</>;
}
