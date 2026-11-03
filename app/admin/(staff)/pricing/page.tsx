import { PageIntro } from "@/components/page-intro";
import { PricingEditor } from "@/components/PricingEditor";
import { requirePermission } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";
import { loadPricing, pricingHistory } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const user = await requirePermission("manage_pricing");
  await loadPricing([], true);
  const history = (await pricingHistory()).map((row) => ({ ...row, publishedAt: row.publishedAt.toISOString() }));
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Money" title="Pricing" lede="Rates, points, leverage and loan terms. Each change is a new version: loans already priced keep theirs, so changing a number here never moves a funded loan." />
      <PricingEditor current={currentPricing()} history={history} canPublish={!isDemoEmail(user.email)} />
    </div>
  );
}
