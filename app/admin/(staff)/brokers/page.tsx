import { BrokersBoard } from "@/components/BrokersBoard";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Brokers" };
export const dynamic = "force-dynamic";

export default async function BrokersPage() {
  await requirePermission("manage_brokers");
  return (
    <div className="max-w-4xl space-y-4">
      <PageIntro eyebrow="Money" title="Brokers" lede="Brokerages that sign LendHous's broker agreement wait here for an owner's approval: their papers, licensing, OFAC screening and W-9. Approved ones can send deals and share a referral link; their fees are tracked loan by loan." />
      <BrokersBoard />
    </div>
  );
}
