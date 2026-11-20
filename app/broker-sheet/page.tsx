import { headers } from "next/headers";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { requireView } from "@/lib/auth";
import { firmOf } from "@/lib/book-access";
import { demoBook } from "@/lib/book";
import { loadBook } from "@/lib/book-store";
import { brandContact } from "@/lib/broker-program";
import { referralPath } from "@/lib/brokers";
import { isDemoEmail } from "@/lib/deploy";
import { DEMO_BROKER_ID } from "@/lib/mockData";
import { loadPricing } from "@/lib/pricing-store";
import { currentPricing } from "@/lib/pricing-versions";
import { gridAdjustments, rateGrid } from "@/lib/rate-grid";

export const metadata = { title: "Program sheet", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A broker's program sheet (rank 25): today's rate grid for every program, with the brokerage's name, contact details and
 * referral link, printed or saved as a PDF to hand clients. Outside the portal's frame so it prints as one clean page.
 */
export default async function ProgramSheet() {
  const user = await requireView("broker");
  const demo = isDemoEmail(user.email);
  const book = demo ? demoBook() : (await loadBook()).book;
  const firm = book.brokers.find((item) => item.id === (demo ? DEMO_BROKER_ID : firmOf(user)));
  await loadPricing();
  const config = currentPricing();
  const asked = await headers();
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `${asked.get("x-forwarded-proto") ?? "https"}://${asked.get("host") ?? "lendhous.com"}`).replace(/\/$/, "");
  const link = firm?.referralCode ? `${origin}${referralPath(firm.referralCode)}` : `${origin}/start`;
  const qr = await QRCode.toString(link, { type: "svg", margin: 0, width: 96, color: { dark: "#202B28", light: "#FFFFFF" } });
  const name = firm?.brand?.name || firm?.name || "Your brokerage";
  const contact = firm?.brand ? brandContact(firm.brand) : "";
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return (
    <main className="mx-auto max-w-4xl space-y-5 bg-white p-6 text-[#202B28] print:max-w-none print:p-0" data-testid="program-sheet">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <a className="text-sm underline" href="/admin/broker">Back to your portal</a>
        <PrintButton />
      </div>
      <header className="flex items-start justify-between gap-4 border-b border-[#202B28]/30 pb-4">
        <div className="min-w-0">
          <p className="text-xs tracking-widest uppercase">Florida investor loans · {today}</p>
          <h1 className="mt-1 text-3xl font-normal" data-testid="program-sheet-name">{name}</h1>
          {contact && <p className="mt-1 text-sm">{contact}</p>}
          <p className="mt-1 text-xs">Loans are made by LendHous. Get a quote in about a minute: <span className="break-all" data-testid="program-sheet-link">{link}</span></p>
        </div>
        <div className="w-24 shrink-0" aria-label="QR code for the quote link" dangerouslySetInnerHTML={{ __html: qr }} />
      </header>
      {rateGrid(config).map((table) => (
        <section key={table.key} className="break-inside-avoid" data-testid={`sheet-grid-${table.key}`}>
          <h2 className="text-lg font-normal">{table.title}</h2>
          <p className="text-xs">{table.note}</p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead><tr className="border-b border-[#202B28]/40 text-left"><th className="py-1 pr-2 font-medium">{table.key === "dscr" ? "Credit score" : table.key === "ground_up" ? "Builds" : "Experience"}</th>{table.columns.map((column) => <th key={column} className="py-1 pr-2 text-right font-medium">{column}</th>)}</tr></thead>
            <tbody>{table.rows.map((row) => <tr key={row.label} className="border-b border-[#202B28]/15"><th scope="row" className="py-1 pr-2 text-left font-normal">{row.label}</th>{row.cells.map((cell, at) => <td key={table.columns[at]} className="py-1 pr-2 text-right tabular-nums">{cell}</td>)}</tr>)}</tbody>
          </table>
        </section>
      ))}
      <section className="break-inside-avoid">
        <h2 className="text-lg font-normal">What moves the numbers</h2>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{gridAdjustments(config).map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <footer className="border-t border-[#202B28]/30 pt-3 text-[10px] leading-snug">
        From LendHous&apos;s published pricing ({config.version}) on {today}. Rates and terms change, and every loan is subject to underwriting: a quote or term sheet binds only as LendHous issues it. Business-purpose loans on Florida investment property only; not for a home the borrower lives in. {name} is an independent broker, not LendHous.
      </footer>
    </main>
  );
}
