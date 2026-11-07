import { saveSettings } from "@/actions/settings";
import { EmbedSnippet } from "@/components/EmbedSnippet";
import { Notice } from "@/components/notice";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { q } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { SLA_KEYS, targetsFrom } from "@/lib/sla";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

// Only settings that actually change something belong here.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("manage_roles");
  const params = await searchParams;
  const settings = await getSettings();
  const targets = targetsFrom(settings.slaTargets as never);
  return (
    <div className="max-w-2xl space-y-4">
      <PageIntro eyebrow="Account" title="Settings" lede="How LendHous behaves for everyone on this account. Changes are recorded in the audit log." />
      <Notice notice={q(params, "notice")} error={q(params, "error")} />
      <form action={saveSettings} className="glass min-w-0 space-y-5 p-5" data-testid="settings-form">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="offerSampleData" data-testid="setting-sample" className="mt-1" defaultChecked={settings.offerSampleData !== false} />
          <span><b className="font-medium">Offer sample data</b><small className="block text-xs text-muted-foreground">Accounts with no loans see a button to load fake data in their browser. Turn this off before real clients sign in.</small></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="allowSignup" data-testid="setting-signup" className="mt-1" defaultChecked={settings.allowSignup !== false} />
          <span><b className="font-medium">Let borrowers create their own accounts</b><small className="block text-xs text-muted-foreground">Anyone, a contractor or investor, can sign up at /login/signup, confirm their email, then apply and send property photos. Turn it off to take borrowers by invitation only.</small></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="allowCallBooking" data-testid="setting-calls" className="mt-1" defaultChecked={settings.allowCallBooking !== false} />
          <span><b className="font-medium">Let visitors book a call</b><small className="block text-xs text-muted-foreground">Half-hour calls on /book, 10 to 4 Eastern on business days. Each booking emails the team and the visitor, and shows on the leads page.</small></span>
        </label>
        <label className="block"><span className="label">Sign staff out after this many idle minutes</span><input name="staffIdleMinutes" data-testid="setting-idle" type="number" min={5} max={480} className="desk-input w-32!" defaultValue={settings.staffIdleMinutes} required /></label>
        <label className="block"><span className="label">Delete read notifications after this many years</span><input name="retentionYears" data-testid="setting-retention" type="number" min={1} max={30} className="desk-input w-32!" defaultValue={settings.retentionYears} required /><span className="mt-1 block text-[11px] text-faint">Loan files and the audit log are never deleted by this.</span></label>
        <label className="block"><span className="label">LendHous&apos;s mailing address, for letters</span><input name="lenderAddress" data-testid="setting-address" className="desk-input" maxLength={300} defaultValue={settings.lenderAddress} placeholder="Street, city, state ZIP" /><span className="mt-1 block text-[11px] text-faint">Printed on decline notices, which Reg B requires to carry the lender&apos;s address. They can&apos;t be sent without it.</span></label>
        <label className="block"><span className="label">Phone for those letters (optional)</span><input name="lenderPhone" data-testid="setting-phone" className="desk-input w-56!" maxLength={40} defaultValue={settings.lenderPhone} /></label>
        <label className="block"><span className="label">How borrowers pay (shown on funded loans and their statements)</span><textarea name="paymentInstructions" data-testid="setting-pay" className="desk-input min-h-24" maxLength={1500} defaultValue={settings.paymentInstructions} placeholder={"Wire to: LendHous Servicing LLC\nBank: …\nRouting: …  Account: …\nReference: your loan number"} /><small className="block text-xs text-muted-foreground">LendHous&apos;s own receiving account. Borrowers are told to confirm it by phone before they first send money. Blank tells them to call.</small></label>
        <label className="block"><span className="label">Referral bonus per funded loan, in dollars</span><input name="referralBonus" data-testid="setting-referral" type="number" min={0} max={5000} step={50} inputMode="numeric" className="desk-input w-32!" defaultValue={settings.referralBonusCents / 100 || ""} placeholder="Off" /><small className="block text-xs text-muted-foreground">What a borrower earns when a friend they referred has their first LendHous loan fund. Borrowers with a funded loan get a link to share, and the Rewards page names the amount. Blank or 0 turns the program off. Ask the CPA about a 1099-MISC for anyone paid $600 or more in a year.</small></label>
        <label className="block"><span className="label">Where borrowers leave a review (optional)</span><input name="reviewUrl" data-testid="setting-review" type="url" className="desk-input" maxLength={500} defaultValue={settings.reviewUrl} placeholder="https://g.page/r/…/review" /><small className="block text-xs text-muted-foreground">After closing and after payoff, borrowers are asked how likely they are to recommend LendHous. Anyone who answers 9 or 10 is asked to leave a review here. Blank asks nothing.</small></label>
        <fieldset className="space-y-2" data-testid="setting-targets">
          <legend className="label">How long things may wait (PLACEHOLDER targets until you set them)</legend>
          <p className="text-xs text-muted-foreground">Business hours count 9 to 5 Eastern on weekdays, less Florida&apos;s state holidays; 8 of them is one business day. Items turn amber at three quarters of the way and red once past, and red ones go in the morning email.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SLA_KEYS.map((key) => <label key={key} className="block"><span className="label">{targets[key].label} ({targets[key].business ? "business hours" : "hours"})</span><input name={`sla-${key}`} data-testid={`setting-sla-${key}`} type="number" min={1} max={240} className="desk-input w-32!" defaultValue={targets[key].hours} /></label>)}
          </div>
        </fieldset>
        <SubmitButton className="h-11 text-[13px] font-medium" pendingLabel="Saving…">Save settings</SubmitButton>
      </form>
      {/* GT's own sites: each gets its own name in the reports' quote funnel. */}
      <EmbedSnippet site="wholesale" title="The quote on the wholesale site">Paste this on each property GT&apos;s wholesale company lists, so buyers see LendHous&apos;s financing on the deal. Quotes from it show in the reports as the widget on wholesale.</EmbedSnippet>
      <EmbedSnippet site="realty" title="The quote on the realty site">The same for the realty company&apos;s listings and agent pages. Quotes from it show as the widget on realty.</EmbedSnippet>
    </div>
  );
}
