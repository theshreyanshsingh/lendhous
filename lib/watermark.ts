// Watermarks on the PDFs partners and buyers open (docs/competitor-gaps-2026-11-09.md, rank 24). A loan's appraisal, title
// and the borrower's papers shared under the NDA carry the person, their firm and when they opened it, faintly across each
// page and in a line at its foot, so a copy that turns up somewhere says where it came from. Every open is already in the
// audit log; this makes the copy itself traceable. A PDF that can't be stamped (encrypted, damaged, or too slow to read)
// goes out as it is and the log says so, since the firm is entitled to the file.
//
// The PDF is read in a worker thread with a time limit: pdf-lib's parser slows to a crawl on some malformed files (a few
// hundred kilobytes of padding takes minutes), and on the server's own thread that would stop every other request.
import { Worker } from "node:worker_threads";

const ZONE = "America/New_York";
/** How long a stamp may take before the file goes out unstamped. */
export const STAMP_TIMEOUT_MS = 4_000;

/** The line stamped on each page. */
export function stampLine(person: string, firm: string, at: Date) {
  const when = at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: ZONE, timeZoneName: "short" });
  // Only characters the standard PDF font can draw: a name with others is reduced, not refused.
  const plain = (text: string) => text.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim();
  return `Opened by ${plain(person) || "a partner"} of ${plain(firm) || "a partner firm"} on ${plain(when)}. LendHous confidential, shared under NDA.`;
}

/** A file shaped like a whole PDF: its header, and the cross-reference pointer and end marker in its last bytes. */
export function looksLikePdf(bytes: Uint8Array) {
  if (bytes.length < 64 || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") return false;
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString("latin1");
  return tail.includes("startxref") && tail.includes("%%EOF");
}

// Run as its own script in the worker. It loads pdf-lib from the app's node_modules, so the main bundle never carries it.
const STAMPER = `
const { parentPort, workerData } = require("node:worker_threads");
const { degrees, PDFDocument, rgb, StandardFonts } = require("pdf-lib");
(async () => {
  const { bytes, line } = workerData;
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const foot = Math.min(7, Math.max(5, width / 90));
    page.drawText(line, { x: 18, y: 10, size: foot, font, color: rgb(0.35, 0.35, 0.35), opacity: 0.85, maxWidth: width - 36 });
    const across = Math.min(16, Math.max(9, width / 50));
    const textWidth = font.widthOfTextAtSize(line, across);
    const angle = Math.atan2(height, width);
    page.drawText(line, { x: width / 2 - (Math.cos(angle) * textWidth) / 2, y: height / 2 - (Math.sin(angle) * textWidth) / 2, size: across, font, color: rgb(0.5, 0.5, 0.5), opacity: 0.18, rotate: degrees((angle * 180) / Math.PI) });
  }
  const out = await pdf.save();
  parentPort.postMessage(out, [out.buffer]);
})().catch(() => parentPort.postMessage(null));
`;

/** The PDF with the line on every page, or null when it can't be stamped in time. */
export function watermarkPdf(bytes: Uint8Array, line: string, timeoutMs = STAMP_TIMEOUT_MS): Promise<Uint8Array | null> {
  if (!looksLikePdf(bytes)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Uint8Array | null) => { if (!settled) { settled = true; resolve(value); } };
    let worker: Worker;
    try {
      worker = new Worker(STAMPER, { eval: true, workerData: { bytes, line }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    } catch {
      finish(null);
      return;
    }
    const timer = setTimeout(() => { finish(null); void worker.terminate(); }, timeoutMs);
    worker.once("message", (out: Uint8Array | null) => { clearTimeout(timer); finish(out ? new Uint8Array(out) : null); void worker.terminate(); });
    worker.once("error", () => { clearTimeout(timer); finish(null); });
    worker.once("exit", () => { clearTimeout(timer); finish(null); });
  });
}
