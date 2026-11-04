import { PageIntro } from "@/components/page-intro";
import { TaxBoard } from "@/components/TaxBoard";
import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Tax forms" };
export const dynamic = "force-dynamic";

export default async function TaxPage() {
  await requirePermission("manage_roles");
  return (
    <div className="max-w-5xl space-y-4">
      <PageIntro eyebrow="Account" title="Tax forms" lede="The information returns LendHous files each January: 1099-INT for partners' and buyers' interest, 1099-NEC for broker fees, and 1098 for interest from individual borrowers." />
      <TaxBoard />
    </div>
  );
}
