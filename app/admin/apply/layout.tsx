import { requireView } from "@/lib/auth";

export default async function ApplyLayout({ children }: { children: React.ReactNode }) {
  await requireView("borrower");
  return <>{children}</>;
}
