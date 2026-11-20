import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { looksLikePdf, stampLine, watermarkPdf } from "@/lib/watermark";

/** Every content stream's text, inflated where it's compressed. */
function streamsOf(bytes: Uint8Array) {
  const raw = Buffer.from(bytes);
  const text = raw.toString("latin1");
  const out: string[] = [];
  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = text.indexOf("endstream", start);
    const body = raw.subarray(start, end);
    try { out.push(inflateSync(body).toString("latin1")); } catch { out.push(body.toString("latin1")); }
  }
  return out.join("\n");
}
const hex = (text: string) => Buffer.from(text, "latin1").toString("hex").toUpperCase();

describe("watermarks on the PDFs partners and buyers open (rank 24)", () => {
  const line = stampLine("Pia Partner", "Demo Partner Capital A (FAKE)", new Date("2026-11-20T15:04:00Z"));

  it("names the person, the firm and when, in Florida's time", () => {
    expect(line).toBe("Opened by Pia Partner of Demo Partner Capital A (FAKE) on Nov 20, 2026, 10:04 AM EST. LendHous confidential, shared under NDA.");
    expect(stampLine("José Núñez", "Firma ✓", new Date("2026-11-20T15:04:00Z"))).toMatch(/^Opened by Jose Nunez of Firma on /);
  });

  it("stamps every page, and gives back null for a file it can't read", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    pdf.addPage([612, 792]);
    const stamped = await watermarkPdf(await pdf.save(), line);
    expect(stamped).not.toBeNull();
    const reopened = await PDFDocument.load(stamped!);
    expect(reopened.getPageCount()).toBe(2);
    const content = streamsOf(stamped!);
    // pdf-lib writes text as hex strings in the content stream: twice on each of the two pages.
    expect(content.split(hex("Opened by Pia Partner")).length - 1).toBe(4);
    expect(await watermarkPdf(new TextEncoder().encode("not a pdf"), line)).toBeNull();
  });

  it("gives up in time on a file that would take the parser minutes, without holding up the server", async () => {
    // A PDF header and padding, the shape that slows pdf-lib's parser quadratically.
    const padded = Buffer.concat([Buffer.from("%PDF-1.4 test\n"), Buffer.alloc(3 * 1024 * 1024, 32)]);
    expect(looksLikePdf(padded)).toBe(false);
    const started = Date.now();
    expect(await watermarkPdf(padded, line)).toBeNull();
    expect(Date.now() - started).toBeLessThan(100);
    // Shaped like a PDF but still slow: the worker is stopped at the time limit.
    const shaped = Buffer.concat([Buffer.from("%PDF-1.4 test\n"), Buffer.alloc(400 * 1024, 32), Buffer.from("\nstartxref\n0\n%%EOF\n")]);
    const timed = Date.now();
    let ticks = 0;
    const ticking = setInterval(() => ticks++, 50);
    expect(await watermarkPdf(shaped, line, 1_000)).toBeNull();
    clearInterval(ticking);
    expect(Date.now() - timed).toBeLessThan(2_500);
    // The main thread kept running while the worker parsed.
    expect(ticks).toBeGreaterThan(10);
  });
});
