import { requireView } from "@/lib/auth";

export default async function BorrowerLayout({ children }: { children: React.ReactNode }) {
  await requireView("borrower");
  return <>{children}</>;
}
