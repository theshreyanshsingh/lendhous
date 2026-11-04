import { Logo } from "@/components/logo";
import { shortDay } from "@/lib/format";
import { letterByCode } from "@/lib/letter-store";
import { LETTER_KIND, type LetterState } from "@/lib/letters";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Check a letter", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
const HEADLINE: Record<LetterState, string> = { valid: "This letter is genuine and valid.", expired: "This letter has expired.", revoked: "LendHous has withdrawn this letter." };

/**
 * The page a letter's QR code opens, for a seller or agent: whether it's genuine and still stands, whom it's for, the
 * limits and the expiry. Nothing else about the borrower.
 */
export default async function VerifyLetter({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const settings = await getSettings();
  const allowed = await consumeRateLimit(`verify-letter:${(await requestMeta()).ipAddress}`, 60, 60 * 60 * 1000);
  const found = code === "demo"
    ? { number: "PA-2026-0000", kind: "pre_approval" as const, who: "Sample Flips LLC (FAKE), Alex Sample (FAKE)", maxLoan: 340_000, maxPurchasePrice: 400_000, propertyAddress: "", expiresOn: "2026-11-30", state: "valid" as const, sample: true }
    : await (async () => { const letter = allowed ? await letterByCode(code) : null; return letter && { number: letter.row.number, kind: letter.details.kind, who: [letter.details.entityName, letter.details.name].filter((part) => part.trim()).join(", "), maxLoan: letter.details.maxLoan, maxPurchasePrice: letter.details.maxPurchasePrice, propertyAddress: letter.details.propertyAddress, expiresOn: letter.row.expiresOn, state: letter.state, sample: false }; })();
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule"><div className="mx-auto max-w-xl px-4 py-5"><Logo /></div></header>
      <main className="mx-auto max-w-xl px-4 py-12" data-testid="verify-letter">
        <p className="eyebrow">Check a letter</p>
        {!found ? (
          <>
            <h1 className="mt-3 text-3xl font-normal text-foreground" data-testid="verify-unknown">We can&apos;t find that letter.</h1>
            <p className="mt-3 text-sm text-muted-foreground">{allowed ? "The link may be mistyped. Don't rely on a letter that doesn't check out here." : "Too many checks from this connection. Try again in an hour."}{settings.lenderPhone ? ` Call LendHous at ${settings.lenderPhone} to confirm one.` : ""}</p>
          </>
        ) : (
          <>
            <h1 className={`mt-3 text-3xl font-normal ${found.state === "valid" ? "text-foreground" : "text-bad"}`} data-testid={`verify-${found.state}`}>{HEADLINE[found.state]}</h1>
            {found.sample && <p className="mt-2 text-sm font-medium text-bad">SAMPLE ONLY. This isn&apos;t a real letter.</p>}
            <dl className="glass mt-6 grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Letter</dt><dd>{LETTER_KIND[found.kind]} {found.number}</dd>
              <dt className="text-muted-foreground">For</dt><dd className="wrap-anywhere">{found.who}</dd>
              <dt className="text-muted-foreground">Loan up to</dt><dd>{dollars(found.maxLoan)}</dd>
              <dt className="text-muted-foreground">Purchase price up to</dt><dd>{dollars(found.maxPurchasePrice)}</dd>
              {found.propertyAddress && <><dt className="text-muted-foreground">Property</dt><dd>{found.propertyAddress}</dd></>}
              <dt className="text-muted-foreground">{found.state === "expired" ? "Expired" : "Valid through"}</dt><dd>{shortDay(found.expiresOn)}</dd>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">A letter isn&apos;t a commitment to lend: any loan depends on its conditions, underwriting and approval. Business-purpose loans only.{settings.lenderPhone ? ` To confirm by phone, call LendHous at ${settings.lenderPhone}.` : ""}</p>
          </>
        )}
      </main>
    </div>
  );
}
