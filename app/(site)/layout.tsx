import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./site.css";

export const metadata: Metadata = {
  title: { absolute: "LendHous | Real Estate Investment Financing", template: "%s | LendHous" },
  description: "Explore real estate investment financing with LendHous LLC. Fix and flip, rental and bridge loan resources, calculators, and investor tools.",
};

// The public website. No page here needs an account; the signed-in panel lives under /admin.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
