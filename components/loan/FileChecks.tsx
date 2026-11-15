"use client";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/**
 * What each PDF sent for the loan says about itself (lib/pdf-signals.ts): files last saved by an editing program, typed
 * up when they should come from a bank, or changed long after they were made. Signals for the team to ask about, not proof.
 */
export function FileChecks({ deal }: { deal: Deal }) {
  const { local } = useStore();
  const checks = deal.fileChecks ?? [];
  const flagged = checks.filter((check) => check.flags.some((flag) => flag.level === "warn"));
  const noted = checks.filter((check) => !flagged.includes(check) && check.flags.length);
  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="file-checks">
      <p className="font-medium">Signs a document was edited</p>
      {!checks.length && <p className="text-muted-foreground">No PDFs sent yet. Each one is checked as it arrives.</p>}
      {checks.length > 0 && !flagged.length && <p className="text-muted-foreground" data-testid="file-checks-clear">{checks.length} PDF{checks.length === 1 ? "" : "s"} checked. None shows signs of editing{noted.length ? `; ${noted.length} with notes below` : ""}.</p>}
      {[...flagged, ...noted].map((check) => (
        <div key={check.documentId} className="rounded-[2px] border border-border p-2" data-testid={flagged.includes(check) ? "file-check-flagged" : "file-check-noted"}>
          <p className="text-xs"><span className="font-medium">{check.label}</span> · {local ? check.fileName : <a className="text-link underline underline-offset-2" href={`/api/documents/${check.documentId}`} target="_blank" rel="noreferrer">{check.fileName}</a>} · sent {shortDay(check.at.slice(0, 10))}</p>
          <ul className="mt-1 space-y-0.5 text-xs">{check.flags.map((flag) => <li key={flag.text} className={flag.level === "warn" ? "text-warn" : "text-muted-foreground"}>{flag.text}</li>)}</ul>
          {check.software.length > 0 && <p className="mt-1 text-[11px] text-faint">Made or saved by: {check.software.join(" · ")}</p>}
        </div>
      ))}
      {checks.length > 0 && <p className="text-[11px] text-faint">Combining statements or printing one to PDF can trip these innocently. Ask the borrower for the file straight from their bank before deciding anything.</p>}
    </div>
  );
}
