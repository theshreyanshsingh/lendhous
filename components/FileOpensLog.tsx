import type { FileOpen } from "@/lib/view-log";

const when = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** Who at the partners and buyers opened which file, and whether their copy was watermarked (rank 24). A server component. */
export function FileOpensLog({ opens, demo }: { opens: (FileOpen & { loan?: string })[]; demo: boolean }) {
  return (
    <section className="glass min-w-0 p-4 sm:p-5" data-testid="file-opens">
      <h2 className="eyebrow">Files opened by partners and buyers · last 90 days</h2>
      <p className="mt-1 text-xs text-muted-foreground">Every PDF they open carries their name, firm and the time across each page and at its foot.</p>
      {demo ? <p className="mt-3 text-sm text-muted-foreground" data-testid="file-opens-demo">On a real account, each file a partner or buyer opens is listed here.</p>
        : opens.length === 0 ? <p className="mt-3 text-sm text-muted-foreground" data-testid="file-opens-empty">No files opened in the last 90 days.</p> : (
          <table className="stack-table mt-3 w-full text-sm" data-testid="file-opens-table">
            <thead><tr><th>When</th><th>Who</th><th>File</th><th>Loan</th><th>Watermarked</th></tr></thead>
            <tbody className="divide-y divide-border">
              {opens.map((open, index) => (
                <tr key={`${open.at}-${index}`} data-testid="file-open-row">
                  <td className="tabular-nums">{when(open.at)}</td>
                  <td data-label="Who">{open.person}<span className="block text-xs text-muted-foreground">{open.firm}</span></td>
                  <td data-label="File" className="wrap-anywhere">{open.file}</td>
                  <td data-label="Loan">{open.loan ?? "–"}</td>
                  <td data-label="Watermarked">{open.watermarked === undefined ? "Not a PDF" : open.watermarked ? "Yes" : "Couldn't be (sent as is)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
