import { Logo } from "@/components/logo";
import { PayoffLetterView } from "@/components/PayoffLetterView";
import { demoLetter } from "@/lib/payoff-demo";
import { openPayoffLink } from "@/lib/payoff-links";
import { letterContent, longDay } from "@/lib/payoffs";

export const metadata = { title: "Payoff letter", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule"><div className="mx-auto max-w-2xl px-4 py-5"><Logo /></div></header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">{children}</main>
    </div>
  );
}

/** The payoff letter an email links to. Every link opens the request's newest letter, so a correction can't be missed. */
export default async function PayoffLetterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "demo") {
    return (
      <Frame>
        <PayoffLetterView content={demoLetter()} />
        <a className="btn-primary w-full sm:w-auto" href="/payoff-letter/demo/pdf" data-testid="letter-pdf">Download the PDF</a>
      </Frame>
    );
  }
  const link = await openPayoffLink(token);
  if (!link) {
    return (
      <Frame>
        <div data-testid="payoff-link-closed">
          <p className="eyebrow">Payoff letter</p>
          <h1 className="mt-3 text-3xl font-normal text-foreground">This link is no longer open.</h1>
          <p className="mt-3 text-sm text-muted-foreground">It may have expired or the address may be incomplete. Ask LendHous servicing for a new payoff letter at a number you find yourself.</p>
        </div>
      </Frame>
    );
  }
  const { request, deal, letter, sent } = link;
  const content = letterContent(deal, request, letter, process.env.LENDER_NAME || "LendHous");
  return (
    <Frame>
      {sent < letter.number && <p className="rounded-md bg-warn/10 p-3 text-sm" data-testid="letter-replaced">The letter this email was for has been corrected. This is the newest letter, issued {longDay(letter.issuedOn)}. Use these figures.</p>}
      {deal.status === "paid_off" && <p className="rounded-md bg-good/10 p-3 text-sm text-good">This loan has been paid off.</p>}
      <PayoffLetterView content={content} />
      <a className="btn-primary w-full sm:w-auto" href={`/payoff-letter/${token}/pdf`} data-testid="letter-pdf">Download the PDF</a>
      <p className="text-xs text-muted-foreground">This link works until {link.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}. Please don&apos;t forward it.</p>
    </Frame>
  );
}
