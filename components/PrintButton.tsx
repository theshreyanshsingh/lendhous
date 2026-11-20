"use client";

/** Opens the browser's print dialog, where "Save as PDF" is one of the printers. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return <button type="button" className="btn-primary" data-testid="print-sheet" onClick={() => window.print()}>{label}</button>;
}
