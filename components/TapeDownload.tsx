"use client";
import { Download } from "lucide-react";
import { downloadCsv, downloadFile } from "@/lib/csv";
import { tapeFileName, tapeJson, type TapeRow, type TapeVersion } from "@/lib/loan-tape";

/**
 * Saves a loan tape as CSV, for a spreadsheet, or JSON, which also lists what every column means. The rows are worked
 * out before they get here, so this only writes files.
 */
export function TapeDownload({ rows, version, asOf, what = "loans", testId = "tape" }: { rows: TapeRow[]; version: TapeVersion; asOf: string; what?: string; testId?: string }) {
  const small = "btn-ghost h-9! px-3! text-xs!";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={small} data-testid={`${testId}-csv`} disabled={!rows.length} onClick={() => downloadCsv(tapeFileName(version, asOf, "csv", what), rows)}><Download size={14} aria-hidden="true" /> CSV</button>
      <button type="button" className={small} data-testid={`${testId}-json`} disabled={!rows.length} onClick={() => downloadFile(tapeFileName(version, asOf, "json", what), tapeJson(rows, version, asOf), "application/json")}><Download size={14} aria-hidden="true" /> JSON</button>
      <span className="text-xs text-muted-foreground">{rows.length} loan{rows.length === 1 ? "" : "s"}</span>
    </div>
  );
}
