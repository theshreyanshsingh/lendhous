"use client";
import { useEffect, useState } from "react";
import { embedPath, embedSnippet } from "@/lib/quote-funnel";

/** The quote widget's code to paste into a website, with a copy button and a link to try it. */
export function EmbedSnippet({ referral, site, title, children }: { referral?: string; site?: string; title: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  // The site's address is only known in the browser, so it's added after the page first draws.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const code = origin ? embedSnippet(origin, { ref: referral, site }) : "";
  return (
    <div className="glass space-y-2 p-4" data-testid="embed-snippet">
      <h2 className="text-base font-medium">{title}</h2>
      <div className="text-sm text-muted-foreground">{children}</div>
      <textarea readOnly className="desk-input min-h-24 font-mono text-[11px]" value={code} data-testid="embed-code" onFocus={(event) => event.target.select()} aria-label="Code to paste into a website" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" data-testid="copy-embed" disabled={!code} onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy the code"}</button>
        <a className="text-sm text-link underline underline-offset-2" href={embedPath({ ref: referral, site })} target="_blank" rel="noreferrer" data-testid="try-embed">See the widget</a>
      </div>
    </div>
  );
}
