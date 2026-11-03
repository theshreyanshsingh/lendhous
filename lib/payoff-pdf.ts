// The payoff letter as a PDF, which is what a title company files and what Florida's statute expects to be delivered.
// pdfkit: maintained, no browser or native binary to run on the server, and its built-in fonts need nothing shipped
// with the app. Times stands in for the brand's Georgia and Helvetica for Verdana; neither can be embedded without a
// licensed font file. Those fonts only cover Windows-1252, so the text avoids characters outside it (no "−" or "→").
import PDFDocument from "pdfkit";
import type { LetterContent } from "./payoffs";

const INK = "#202B28";
const SAGE = "#677D67";
const MUTED = "#5B6660";
const money = (amount: number) => `${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function letterPdf(content: LetterContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 }, info: { Title: `Payoff letter ${content.reference}`, Author: content.lender, Subject: "Payoff letter (estoppel letter, s. 701.04, Florida Statutes)" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const rule = (color = SAGE, weight = 0.75) => { doc.moveDown(0.4); doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(weight).strokeColor(color).stroke(); doc.moveDown(0.6); };
    // A label on the left and an amount on the right, on one line, with an optional smaller note under the label.
    const row = (label: string, amount: string, options: { bold?: boolean; detail?: string } = {}) => {
      const y = doc.y;
      doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10.5).fillColor(INK).text(label, left, y, { width: width - 130 });
      const after = doc.y;
      doc.text(amount, left + width - 130, y, { width: 130, align: "right" });
      doc.y = after;
      if (options.detail) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(options.detail, left, doc.y, { width: width - 130 });
      doc.moveDown(0.35);
    };

    doc.font("Times-Bold").fontSize(22).fillColor(INK).text(content.lender, left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Payoff letter (estoppel letter under section 701.04, Florida Statutes)");
    rule(SAGE, 1.25);
    if (content.sample) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#9B2C2C").text("SAMPLE ONLY. These are made-up figures, not a real payoff letter."); doc.moveDown(0.5); }
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(`Issued ${content.issuedOn}`).text(`Reference ${content.reference}`);
    if (content.corrected) { doc.moveDown(0.5); doc.font("Helvetica-Bold").text(`Corrected letter. ${content.corrected}`); }
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(10).text("To");
    doc.font("Helvetica").text(content.to.join("\n"));
    doc.moveDown(0.8);
    for (const [label, value] of content.loan) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(label, left, y, { width: 90 });
      doc.fillColor(INK).text(value, left + 90, y, { width: width - 90 });
    }
    doc.moveDown(0.6);
    rule();
    doc.font("Times-Bold").fontSize(14).fillColor(INK).text("Amount to pay off the loan", left, doc.y);
    doc.moveDown(0.5);
    for (const item of content.rows) row(item.label, money(item.amount), { detail: item.detail });
    rule(INK, 0.75);
    row(content.total.label, money(content.total.amount), { bold: true });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(content.perDiem, left, doc.y, { width });
    rule();
    for (const paragraph of content.paragraphs) { doc.font("Helvetica").fontSize(10).fillColor(INK).text(paragraph, left, doc.y, { width, lineGap: 2 }); doc.moveDown(0.6); }
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`${content.lender} - ${content.reference}`, left, doc.y, { width });
    doc.end();
  });
}
