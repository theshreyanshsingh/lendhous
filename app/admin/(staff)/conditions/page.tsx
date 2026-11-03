import { ConditionLibrary } from "@/components/ConditionLibrary";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";

export const metadata = { title: "Conditions library" };
export const dynamic = "force-dynamic";

export default async function ConditionsLibraryPage() {
  await requirePermission("manage_roles");
  return (
    <div className="max-w-3xl space-y-4">
      <PageIntro eyebrow="Account" title="Conditions library" lede="The standard conditions a loan gets when it starts clearing conditions, by loan type. Changes apply to loans from then on; each one is a new version in the audit log." />
      <ConditionLibrary />
    </div>
  );
}
