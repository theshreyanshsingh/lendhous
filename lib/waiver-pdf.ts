// A statutory lien waiver (lib/waiver-forms.ts) as a one-page PDF for the lienor to sign. pdfkit and its built-in fonts,
// like the letters (lib/letter-pdf.ts).
import PDFDocument from "pdfkit";
import { waiverText, type WaiverFields } from "./waiver-forms";

const INK = "#202B28";
const MUTED = "#5B6660";
// pdfkit's built-in fonts draw Windows-1252 only.
const plain = (text: string) => text.normalize("NFKD").replace(/[^\x20-\x7E\n]/g, "");

export function waiverPdf(fields: WaiverFields, loanNumber: string): Promise<Buffer> {
  const form = waiverText(fields);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 72, bottom: 72, left: 72, right: 72 }, info: { Title: form.title, Author: "LendHous" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    doc.font("Times-Bold").fontSize(14).fillColor(INK).text(form.title, left, doc.y, { width, align: "center" });
    doc.moveDown(1.5);
    doc.font("Times-Roman").fontSize(12).fillColor(INK).text(plain(form.body), { width, align: "left", lineGap: 3 });
    doc.moveDown(2.5);
    doc.text("DATED on ____________________, ________ (year).", { width });
    doc.moveDown(2.5);
    const line = (label: string, value = "") => {
      doc.text(value ? plain(value) : " ", { width: width / 2 });
      doc.moveTo(left, doc.y).lineTo(left + width / 2, doc.y).lineWidth(0.75).strokeColor(INK).stroke();
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label, { width: width / 2 });
      doc.font("Times-Roman").fontSize(12).fillColor(INK).moveDown(1.2);
    };
    line("(Lienor)", fields.lienor);
    line("By: (signature, name and title)");
    doc.moveDown(2);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`The form of ${form.cite}, filled in by LendHous for loan ${plain(loanNumber)}. A lienor who signs in exchange for a check may make it conditional on the check clearing (713.20(7)). Return the signed copy with the draw.`, { width });
    doc.end();
  });
}
