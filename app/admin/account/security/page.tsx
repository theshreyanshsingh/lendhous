import { setEmailCodes } from "@/actions/security";
import { Notice } from "@/components/notice";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/format";
import { loginCodeRequired } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const required = loginCodeRequired(user.roleCodes, await getSettings());
  return (
    <div className="max-w-xl">
      <PageIntro eyebrow="Security" title="Sign-in codes." lede={`A six-digit code goes to ${user.email} when you sign in. Each code works once and expires after ten minutes.`} />
      <Notice notice={q(params, "notice")} error={q(params, "error")} />
      {required ? (
        <p className="mt-8 rounded-xl border border-border p-5 text-sm text-foreground" data-testid="codes-required">Your role needs a code at every sign-in, so this stays on.</p>
      ) : user.emailCodeEnabled ? (
        <form action={setEmailCodes} className="mt-8 space-y-4 rounded-xl border border-border p-5">
          <p className="text-sm text-foreground">Codes are required at sign-in.</p>
          <input type="hidden" name="enabled" value="no" />
          <label className="block">
            <span className="text-[13px] text-muted-foreground">Password</span>
            <input data-testid="codes-password" name="password" type="password" autoComplete="current-password" aria-label="Your password" className="desk-input mt-2" required />
          </label>
          <SubmitButton variant="outline" className="h-11 text-[13px] font-medium">Turn off</SubmitButton>
        </form>
      ) : (
        <form action={setEmailCodes} className="mt-8">
          <input type="hidden" name="enabled" value="yes" />
          <SubmitButton className="h-11 text-[13px] font-medium">Turn on sign-in codes</SubmitButton>
        </form>
      )}
    </div>
  );
}
