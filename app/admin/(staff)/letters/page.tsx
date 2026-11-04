import { LettersBoard } from "@/components/LettersBoard";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";
import { isDemoEmail } from "@/lib/deploy";

export const metadata = { title: "Letters" };
export const dynamic = "force-dynamic";

export default async function LettersPage() {
  const user = await requirePermission("issue_term_sheet");
  return (
    <div className="max-w-4xl space-y-4">
      <PageIntro eyebrow="Underwriting" title="Pre-approval and proof-of-funds letters" lede="For repeat borrowers and wholesale and realty clients making offers. Each letter has a number, an expiry and a QR code a seller scans to check it's genuine; withdraw one and the check says so." />
      <LettersBoard demo={isDemoEmail(user.email)} />
    </div>
  );
}
