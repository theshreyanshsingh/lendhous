// The term sheet as a PDF, made on the server with pdfkit like the payoff letters (lib/payoff-pdf.ts says why). Times
// stands in for Georgia and Helvetica for Verdana, and the text stays inside Windows-1252, which those fonts cover.
import PDFDocument from "pdfkit";
import type { SheetContent } from "./term-sheets";

const INK = "#202B28";
const SAGE = "#677D67";
const MUTED = "#5B6660";

export function termSheetPdf(content: SheetContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 56, bottom: 56, left: 64, right: 64 }, info: { Title: `${content.title}: ${content.subtitle}`, Author: content.lender } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const rule = (color = SAGE, weight = 0.75) => { doc.moveDown(0.4); doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(weight).strokeColor(color).stroke(); doc.moveDown(0.6); };
    // A label and its value side by side; the value wraps in its own column.
    const pair = (label: string, value: string, labelWidth: number) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(label, left, y, { width: labelWidth - 8 });
      const below = doc.y;
      doc.fillColor(INK).text(value, left + labelWidth, y, { width: width - labelWidth });
      doc.y = Math.max(below, doc.y);
      doc.moveDown(0.3);
    };
    const heading = (text: string) => { doc.font("Times-Bold").fontSize(13).fillColor(INK).text(text, left, doc.y); doc.moveDown(0.4); };

    doc.font("Times-Bold").fontSize(22).fillColor(INK).text(content.lender, left, doc.y);
    doc.font("Times-Roman").fontSize(15).text(content.title);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(content.subtitle);
    rule(SAGE, 1.25);
    if (content.sample) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#9B2C2C").text("SAMPLE ONLY. These are made-up figures, not a real term sheet."); doc.moveDown(0.5); }
    if (content.banner) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#9B2C2C").text(content.banner); doc.moveDown(0.5); }
    for (const [label, value] of content.facts) pair(label, value, 90);
    rule();
    heading("Terms");
    for (const [label, value] of content.terms) pair(label, value, 170);
    if (content.conditions.length) {
      rule();
      heading("Still needed before closing");
      doc.font("Helvetica").fontSize(10).fillColor(INK);
      for (const item of content.conditions) doc.text(`- ${item}`, left + 8, doc.y, { width: width - 8 });
      doc.moveDown(0.4);
    }
    rule();
    for (const paragraph of content.paragraphs) { doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(paragraph, left, doc.y, { width, lineGap: 2 }); doc.moveDown(0.5); }
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(content.signature, left, doc.y, { width });
    doc.end();
  });
}
