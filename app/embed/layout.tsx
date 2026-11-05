import type { Metadata } from "next";
import "../(site)/site.css";

export const metadata: Metadata = { title: "LendHous loan quote", robots: { index: false, follow: false } };

// The quote widget other sites frame: the public site's look, without its header and footer.
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="site embed">{children}</div>;
}
