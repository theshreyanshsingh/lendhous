// The adverse action notice (or statement of reasons) as a PDF letter, made on the server with pdfkit like the payoff
// letters and term sheets. The built-in fonts cover Windows-1252, so the text stays inside it.
import PDFDocument from "pdfkit";
import type { NoticeContent } from "./adverse-action";

const INK = "#202B28";
const SAGE = "#677D67";
const MUTED = "#5B6660";

export function noticePdf(content: NoticeContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 }, info: { Title: content.title, Author: content.lender.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    doc.font("Times-Bold").fontSize(20).fillColor(INK).text(content.lender.name, left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text([content.lender.address, content.lender.phone].filter(Boolean).join("  |  "));
    doc.moveDown(0.4); doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.25).strokeColor(SAGE).stroke(); doc.moveDown(0.8);
    if (content.sample) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#9B2C2C").text("SAMPLE ONLY. A made-up applicant, not a real notice."); doc.moveDown(0.5); }
    doc.font("Times-Roman").fontSize(15).fillColor(INK).text(content.title);
    doc.font("Helvetica").fontSize(10).text(content.date);
    doc.moveDown(0.8);
    doc.text(content.to.join("\n"));
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text(`Re: ${content.re}`, { width });
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(10.5);
    for (const paragraph of content.paragraphs) { doc.text(paragraph, left, doc.y, { width, lineGap: 2 }); doc.moveDown(0.5); }
    for (const reason of content.reasons) { doc.text(`-  ${reason}`, left + 12, doc.y, { width: width - 12, lineGap: 2 }); doc.moveDown(0.2); }
    if (content.reasons.length) doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(content.ecoa, left, doc.y, { width, lineGap: 2 });
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(10.5).text(`Sincerely,\n${content.lender.name}`);
    doc.end();
  });
}
