import { headers } from "next/headers";
import Link from "next/link";
import { CampaignComposer } from "@/components/CampaignComposer";
import { PageIntro } from "@/components/page-intro";
import { requirePermission } from "@/lib/auth";
import { audienceCounts, recentCampaigns } from "@/lib/campaign-store";
import { AUDIENCES, rateSheetDraft, type Audience, type CampaignInput } from "@/lib/campaigns";
import { isDemoEmail } from "@/lib/deploy";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Email campaigns" };
export const dynamic = "force-dynamic";

const PAST: CampaignInput = { audience: "past_borrowers", subject: "Your next project with LendHous", body: "Hello,\n\nThank you for repaying your loan with LendHous. If you have another project coming up, a quote takes about a minute, and borrowers who repaid a loan with us as agreed may qualify for repeat-borrower pricing.\n\nReply to this email or call us, and we'll help you size it." };

/** Email campaigns (rank 29): rate updates to brokers and notes to past borrowers, with the unsubscribe the law asks for. */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const user = await requirePermission("send_campaigns");
  const demo = isDemoEmail(user.email);
  const { start } = await searchParams;
  await loadPricing();
  const asked = await headers();
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `${asked.get("x-forwarded-proto") ?? "https"}://${asked.get("host") ?? ""}`).replace(/\/$/, "");
  const settings = await getSettings();
  // Demo seats see the composer with nobody to send to, and none of the real accounts.
  const [counts, sent] = demo ? [{ brokers: 0, past_borrowers: 0, borrowers: 0 } as Record<Audience, number>, []] : await Promise.all([audienceCounts(), recentCampaigns()]);
  const draft = start === "past" ? PAST : rateSheetDraft(currentPricing(), `${origin}/broker-sheet`);
  return (
    <div className="max-w-3xl space-y-4">
      <PageIntro eyebrow="Money" title="Email campaigns" lede="Rate updates to the brokers and a note to past borrowers about their next loan. Each email carries LendHous's address and an unsubscribe link, and anyone who unsubscribed is left out." />
      <nav className="flex flex-wrap gap-2 text-xs" aria-label="Start from">
        <Link className={`inline-flex h-8 items-center rounded-[2px] px-2.5 ${start !== "past" ? "bg-active font-medium" : "text-muted-foreground hover:bg-hover"}`} href="/admin/campaigns" data-testid="campaign-start-rates">Start from today&apos;s rates</Link>
        <Link className={`inline-flex h-8 items-center rounded-[2px] px-2.5 ${start === "past" ? "bg-active font-medium" : "text-muted-foreground hover:bg-hover"}`} href="/admin/campaigns?start=past" data-testid="campaign-start-past">Start from a note to past borrowers</Link>
      </nav>
      <section className="glass min-w-0 p-4 sm:p-5"><CampaignComposer key={start ?? "rates"} counts={counts} mailingAddress={settings.lenderAddress} draft={draft} demo={demo} /></section>
      <section className="glass min-w-0 p-4 sm:p-5" data-testid="campaign-history">
        <h2 className="eyebrow">Sent ({sent.length})</h2>
        {sent.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None yet.</p> : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {sent.map((campaign) => <li key={campaign.id} className="py-2" data-testid="campaign-row"><span className="font-medium">{campaign.subject}</span><span className="block text-xs text-muted-foreground">{AUDIENCES[campaign.audience as Audience]?.label ?? campaign.audience} · {campaign.recipients} sent{campaign.skipped ? `, ${campaign.skipped} failed` : ""} · {campaign.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })} by {campaign.sentBy}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
