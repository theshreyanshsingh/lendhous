import { saveSettings } from "@/actions/settings";
import { Notice } from "@/components/notice";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { q } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

// Only settings that actually change something belong here.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("manage_roles");
  const params = await searchParams;
  const settings = await getSettings();
  return (
    <div className="max-w-2xl space-y-4">
      <PageIntro eyebrow="Account" title="Settings" lede="How LendHous behaves for everyone on this account. Changes are recorded in the audit log." />
      <Notice notice={q(params, "notice")} error={q(params, "error")} />
      <form action={saveSettings} className="glass min-w-0 space-y-5 p-5" data-testid="settings-form">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="offerSampleData" data-testid="setting-sample" className="mt-1" defaultChecked={settings.offerSampleData !== false} />
          <span><b className="font-medium">Offer sample data</b><small className="block text-xs text-muted-foreground">Accounts with no loans see a button to load fake data in their browser. Turn this off before real clients sign in.</small></span>
        </label>
        <label className="block"><span className="label">Sign staff out after this many idle minutes</span><input name="staffIdleMinutes" data-testid="setting-idle" type="number" min={5} max={480} className="desk-input w-32!" defaultValue={settings.staffIdleMinutes} required /></label>
        <label className="block"><span className="label">Delete read notifications after this many years</span><input name="retentionYears" data-testid="setting-retention" type="number" min={1} max={30} className="desk-input w-32!" defaultValue={settings.retentionYears} required /><span className="mt-1 block text-[11px] text-faint">Loan files and the audit log are never deleted by this.</span></label>
        <SubmitButton className="h-11 text-[13px] font-medium" pendingLabel="Saving…">Save settings</SubmitButton>
      </form>
    </div>
  );
}
