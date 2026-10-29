import { requireView } from "@/lib/auth";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  await requireView("partner");
  return <>{children}</>;
}
