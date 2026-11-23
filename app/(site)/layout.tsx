import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { SitePhoneCta } from "@/components/site-phone-cta";
import { siteContact } from "@/lib/site-contact";
import "./site.css";

export const metadata: Metadata = {
  title: { absolute: "LendHous | Real Estate Investment Financing", template: "%s | LendHous" },
  description: "Explore real estate investment financing with LendHous LLC. Fix and flip, rental and bridge loan resources, calculators, and investor tools.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  openGraph: { siteName: "LendHous", type: "website", images: ["/images/florida-home.png"] },
};

// The footer shows the contact details from Settings, so pages built ahead are rebuilt at most five minutes after they
// change (saving Settings also rebuilds them straight away).
export const revalidate = 300;

// The public website. No page here needs an account; the signed-in panel lives under /admin.
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const contact = await siteContact();
  return (
    <div className="site">
      <SiteHeader />
      {children}
      <SiteFooter contact={contact} />
      <SitePhoneCta />
    </div>
  );
}
