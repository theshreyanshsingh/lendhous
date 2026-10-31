import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./(site)/site.css";

export default function NotFound() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="cta">
        <div className="eyebrow">404 / PAGE NOT FOUND</div>
        <h1>Let’s get you<br /><em>back on track.</em></h1>
        <p style={{ marginTop: 25 }}>This page isn’t available. Explore our financing guides or return home.</p>
        <Link className="button" href="/">Return to LendHous</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
