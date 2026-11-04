import { PageIntro } from "@/components/page-intro";
import { ReportsBoard } from "@/components/ReportsBoard";
import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requirePermission("view_reports");
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Business" title="Reports" lede="How the business is doing: the pipeline over the dates you pick, and capital and the funded portfolio as of today. Owners get the same numbers by email each morning." />
      <ReportsBoard />
    </div>
  );
}
