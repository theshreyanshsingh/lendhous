import QRCode from "qrcode";
import { acknowledgeRecovery, beginTotp, confirmTotp, disableTotp, setEmailFallback } from "@/actions/security";
import { Notice } from "@/components/notice";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/format";
import { otpauthUrl } from "@/lib/totp";
import { recoveryCodesToShow, totpSecretOf } from "@/lib/two-factor";

export const metadata = { title: "Security" };

// Ported from UPB Capital's account/security page.
export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser({ allowWithoutMfa: true });
  const params = await searchParams;
  const pending = Boolean(user.totpSecretEnc) && !user.totpEnabled;
  const secret = pending ? totpSecretOf(user) : "";
  const qr = pending ? await QRCode.toString(otpauthUrl(secret, user.email), { type: "svg", margin: 1, width: 180, color: { dark: "#1f2a25", light: "#ffffff" } }) : "";
  const codes = user.recoveryRevealEnc ? recoveryCodesToShow(user) : [];
  return (
    <div className="max-w-xl">
      <PageIntro eyebrow="Security" title="A second factor." lede="Scan the code into an authenticator app. Keep the recovery codes. Email codes are optional, and only if you turn them on." />
      <Notice notice={q(params, "notice")} error={q(params, "error")} />
      {codes.length > 0 && (
        <section className="mt-8 rounded-xl border border-link/40 bg-link/5 p-5">
          <p className="eyebrow">Recovery codes</p>
          <p className="mt-2 text-sm text-muted-foreground">Each code works once, in place of the authenticator. This is the only time they are shown.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="recovery-codes">
            {codes.map((code) => <li key={code} className="text-2xl font-semibold tracking-tight text-foreground">{code}</li>)}
          </ul>
          <form action={acknowledgeRecovery} className="mt-4">
            <SubmitButton className="h-11 text-[13px] font-medium">I have written these down</SubmitButton>
          </form>
        </section>
      )}
      {user.totpEnabled ? (
        <div className="mt-8 space-y-4">
          <form action={disableTotp} className="space-y-4 rounded-xl border border-border p-5">
            <p className="text-sm text-foreground">Codes are required at sign-in.</p>
            <label className="block">
              <span className="text-[13px] text-muted-foreground">Current code or recovery code</span>
              <input name="code" autoComplete="one-time-code" aria-label="Current authenticator or recovery code" className="desk-input mt-2" required />
            </label>
            <SubmitButton variant="outline" className="h-11 text-[13px] font-medium">Turn off</SubmitButton>
          </form>
          <form action={setEmailFallback} className="space-y-3 rounded-xl border border-border p-5">
            <p className="eyebrow">Email fallback</p>
            <p className="text-sm text-muted-foreground">When this is on, the sign-in screen can email a six-digit code.</p>
            <input type="hidden" name="enabled" value={user.emailOtpFallback ? "no" : "yes"} />
            <SubmitButton variant="outline" className="h-11 text-[13px] font-medium">{user.emailOtpFallback ? "Turn email codes off" : "Turn email codes on"}</SubmitButton>
          </form>
        </div>
      ) : pending ? (
        <div className="mt-8 space-y-4 rounded-xl border border-border p-5">
          <p className="text-sm text-muted-foreground">Scan this with an authenticator, or enter the secret by hand.</p>
          <div className="max-w-[200px] rounded-xl border border-border bg-white p-3" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="break-all text-2xl font-semibold tracking-tight text-foreground" data-testid="totp-secret">{secret}</p>
          <form action={confirmTotp} className="space-y-3">
            <label className="block">
              <span className="text-[13px] text-muted-foreground">Code</span>
              <input data-testid="totp-confirm" name="code" inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" className="desk-input mt-2" required />
            </label>
            <SubmitButton className="h-11 text-[13px] font-medium">Confirm</SubmitButton>
          </form>
        </div>
      ) : (
        <form action={beginTotp} className="mt-8">
          <SubmitButton className="h-11 text-[13px] font-medium">Set up authenticator</SubmitButton>
        </form>
      )}
    </div>
  );
}
