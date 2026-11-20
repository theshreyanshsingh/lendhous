"use client";
import { useEffect, useState } from "react";
import { embedPath, embedSnippet } from "@/lib/quote-funnel";
import { phonePill } from "@/lib/ui-classes";

/** The quote widget's code to paste into a website, with a copy button and a link to try it. */
export function EmbedSnippet({ referral, site, title, children, brandable = false }: { referral?: string; site?: string; title: string; children: React.ReactNode; brandable?: boolean }) {
  const [copied, setCopied] = useState(false);
  // A broker with its brand set can show it on the widget instead of LendHous's.
  const [branded, setBranded] = useState(false);
  const brand = brandable && branded;
  // The site's address is only known in the browser, so it's added after the page first draws.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const code = origin ? embedSnippet(origin, { ref: referral, site, brand }) : "";
  return (
    <div className="glass space-y-2 p-4" data-testid="embed-snippet">
      <h2 className="text-base font-medium">{title}</h2>
      <div className="text-sm text-muted-foreground">{children}</div>
      {brandable && <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="embed-branded" checked={branded} onChange={(event) => setBranded(event.target.checked)} />Show my brand on the widget (it still says loans are made by LendHous)</label>}
      <textarea readOnly className="desk-input min-h-24 font-mono text-[11px]" value={code} data-testid="embed-code" onFocus={(event) => event.target.select()} aria-label="Code to paste into a website" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" data-testid="copy-embed" disabled={!code} onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy the code"}</button>
        <a className={`text-sm text-link underline underline-offset-2 ${phonePill}`} href={embedPath({ ref: referral, site, brand })} target="_blank" rel="noreferrer" data-testid="try-embed">See the widget</a>
      </div>
    </div>
  );
}
