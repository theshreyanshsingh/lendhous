// Ported from UPB Capital's components/notice.tsx, with LendHous's own copy.
const COPY: Record<string, string> = {
  totp: "Add the secret to an authenticator, then confirm the code.",
  totp_on: "Two-factor sign-in is on.",
  totp_off: "Two-factor sign-in is off.",
  codes: "Write the recovery codes down. They will not be shown again.",
  email_otp: "Email fallback updated.",
  email_sent: "A code is on its way to your email.",
  mfa_required: "Your role needs two-factor sign-in. Set up an authenticator to continue.",
  signed_out: "You are signed out.",
};

export function Notice({ notice, error }: { notice?: string; error?: string }) {
  if (error) {
    return <p role="alert" className="rounded-[2px] border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>;
  }
  if (!notice) return null;
  return (
    <p role="status" className="rounded-[2px] border border-brand/35 bg-brand/10 px-4 py-3 text-sm text-foreground">
      {COPY[notice] ?? decodeURIComponent(notice)}
    </p>
  );
}
