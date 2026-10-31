import { requireView } from "@/lib/auth";

export default async function BrokerLayout({ children }: { children: React.ReactNode }) {
  await requireView("broker");
  return <>{children}</>;
}
