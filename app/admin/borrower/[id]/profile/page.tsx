"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageIntro } from "@/components/page-intro";
import { SponsorEditor } from "@/components/SponsorEditor";
import { useStore } from "@/lib/store";

export default function BorrowerProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { s } = useStore();
  const deal = s.deals.find((item) => item.id === id);
  if (!deal) return <div className="glass p-6">Loan not found. <Link className="underline" href="/admin/borrower">Back</Link></div>;
  return (
    <div className="space-y-4">
      <Link href={`/admin/borrower/${deal.id}`} className="text-sm text-link">← {deal.address}</Link>
      <PageIntro eyebrow={deal.loanNumber} title="Guarantors, past deals and credit questions" lede="The team needs these to price and approve your loan. Your experience is checked against settlement statements, and a yes answer just means someone reads your explanation." />
      <div className="glass p-4 sm:p-5"><SponsorEditor deal={deal} onDone={() => router.push(`/admin/borrower/${deal.id}`)} /></div>
    </div>
  );
}
