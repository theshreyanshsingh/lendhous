import { myTaxForm } from "@/actions/tax";
import { PageIntro } from "@/components/page-intro";
import { TaxFormPanel } from "@/components/TaxFormPanel";
import { requireUser } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";

export const metadata = { title: "Tax form" };
export const dynamic = "force-dynamic";

// Partners, loan buyers and brokers give LendHous a W-9 before it pays them; it files their 1099s each January.
export default async function TaxFormPage() {
  const user = await requireUser();
  return (
    <div className="max-w-3xl space-y-4">
      <PageIntro eyebrow="Account" title="Tax form" lede="LendHous reports the interest and fees it pays you to the IRS each January. Sign your W-9 here once; sign a new one if your name, entity or taxpayer ID changes." />
      <TaxFormPanel onFile={await myTaxForm()} demo={isDemoEmail(user.email)} />
    </div>
  );
}
