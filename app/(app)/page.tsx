"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore, type Role } from "@/lib/store";
import { PageIntro } from "@/components/page-intro";
export default function Home() {
  const { dispatch } = useStore(); const router = useRouter();
  const go = (r: Role, href: string) => { dispatch({ t: "role", role: r }); router.push(href); };
  const cards: { r: Role; href: string; title: string; body: string; cta: string }[] = [
    { r: "borrower", href: "/apply", title: "Borrower", body: "Apply for fix & flip, bridge, ground-up or DSCR financing and watch your instant term-sheet estimate update as you type.", cta: "Start an application" },
    { r: "borrower", href: "/borrower", title: "Borrower dashboard", body: "Track loan status from submitted to funded, see balances and holdback, and upload requested documents.", cta: "Open my loans" },
    { r: "admin", href: "/admin", title: "Admin / Underwriter", body: "Pipeline with live deal scoring (LTV, LTC, LTARV, DSCR in green / yellow / red), and route each deal in-house, to partners, or split.", cta: "Open pipeline" },
    { r: "partner", href: "/partner", title: "Partner lender", body: "Anonymized teasers (no address, no borrower name) matched to your buy box. Bid or accept as offered. The full file unlocks only after you win.", cta: "Open deal feed" },
  ];
  return (
    <div>
      <PageIntro eyebrow="South Florida private lending · prototype" title="Fast, fair investor loans with GT's own capital and trusted partners." lede="A clickable demo of the Lendhous platform described in Product Spec v3. Use View as in the sidebar to move between borrower, underwriter and partner views. Nothing here is real." />
      <div className="mb-8 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => go("borrower", "/apply")}>Get an instant estimate</button>
        <button className="btn-ghost" onClick={() => go("admin", "/admin")}>See the underwriting dashboard</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.title} className="glass flex flex-col p-5"><p className="eyebrow">{c.title}</p><p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">{c.body}</p><button className="btn-primary mt-4" onClick={() => go(c.r, c.href)}>{c.cta}</button></div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Prototype scope: no real auth, no real credit pulls, no file storage (uploads stay in your browser). Edit pricing in <code>lib/pricing-config.ts</code>. <Link className="font-medium text-link" href="/admin/capital">Capital dashboard</Link>.</p>
    </div>
  );
}
