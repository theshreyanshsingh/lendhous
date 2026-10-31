// Ported from UPB Capital's components/notice.tsx, with LendHous's own copy.
const COPY: Record<string, string> = {
  codes_on: "Sign-in codes are on.",
  codes_off: "Sign-in codes are off.",
  email_sent: "A code is on its way to your email.",
  signed_out: "You are signed out.",
  password_set: "Your password is set. Sign in to continue.",
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
