// A pre-approval or proof-of-funds letter as a PDF, with a QR code to its verify page. pdfkit and its built-in fonts,
// like the payoff letters (lib/payoff-pdf.ts), so only Windows-1252 characters.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { LETTER_DISCLAIMER, LETTER_KIND, type LetterDetails } from "./letters";

const INK = "#202B28";
const SAGE = "#677D67";
const MUTED = "#5B6660";
const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const PROGRAM: Record<string, string> = { fix_flip: "fix and flip", bridge: "bridge", ground_up: "new construction", dscr: "DSCR rental" };

export type LetterPdf = { number: string; issuedOn: string; expiresOn: string; details: LetterDetails; issuedBy: string; verifyUrl: string; lender: string; phone: string; sample?: boolean };

export async function letterPdf(letter: LetterPdf): Promise<Buffer> {
  const qr = await QRCode.toBuffer(letter.verifyUrl, { margin: 1, width: 220, color: { dark: INK, light: "#FFFFFF" } });
  return new Promise((resolve, reject) => {
    const { details } = letter;
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 }, info: { Title: `${LETTER_KIND[details.kind]} letter ${letter.number}`, Author: letter.lender } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const rule = () => { doc.moveDown(0.4); doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.25).strokeColor(SAGE).stroke(); doc.moveDown(0.6); };

    doc.font("Times-Bold").fontSize(22).fillColor(INK).text(letter.lender, left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${LETTER_KIND[details.kind]} letter`);
    rule();
    if (letter.sample) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#9B2C2C").text("SAMPLE ONLY. This is not a real letter."); doc.moveDown(0.5); }
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(`Letter ${letter.number}`).text(`Issued ${longDay(letter.issuedOn)}`).font("Helvetica-Bold").text(`Valid through ${longDay(letter.expiresOn)}`);
    doc.moveDown(0.8);
    const who = details.entityName.trim() ? `${details.entityName.trim()} (${details.name.trim()})` : details.name.trim();
    const where = details.propertyAddress.trim() ? ` for the property at ${details.propertyAddress.trim()}` : "";
    const body = details.kind === "pre_qualification"
      ? `${details.brokerName ?? "Your broker"}, through ${letter.lender}, has reviewed the information provided and pre-qualifies ${who} for a business-purpose ${PROGRAM[details.product] ?? details.product} loan of up to ${dollars(details.maxLoan)}${where}, toward a purchase price of up to ${dollars(details.maxPurchasePrice)}. ${letter.lender} is the lender; ${details.brokerName ?? "the broker"} is an independent broker who can't approve a loan.`
      : details.kind === "pre_approval"
      ? `${letter.lender} has reviewed the information provided and pre-approves ${who} for a business-purpose ${PROGRAM[details.product] ?? details.product} loan of up to ${dollars(details.maxLoan)}${where}, toward a purchase price of up to ${dollars(details.maxPurchasePrice)}.`
      : `${letter.lender} confirms that it is prepared to lend up to ${dollars(details.maxLoan)} to ${who} toward the purchase of investment property${where} at a price of up to ${dollars(details.maxPurchasePrice)}, on the conditions below.`;
    doc.font("Helvetica").fontSize(11).fillColor(INK).text(body, { width, lineGap: 2 });
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(10).text("Conditions");
    doc.font("Helvetica").fontSize(10);
    for (const item of details.conditions.filter((line) => line.trim())) doc.text(`-  ${item.trim()}`, left + 6, doc.y, { width: width - 6 });
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(LETTER_DISCLAIMER.join(" "), left, doc.y, { width });
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(details.brokerName ? `Issued by ${letter.issuedBy}, ${details.brokerName}, through ${letter.lender}` : `Issued by ${letter.issuedBy}, ${letter.lender}`);
    doc.moveDown(1);
    const top = doc.y;
    doc.image(qr, left, top, { width: 92 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Check this letter", left + 108, top + 8);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Scan the code or open ${letter.verifyUrl} to see that it's genuine and still valid.${letter.phone ? ` Or call ${letter.lender} at ${letter.phone}.` : ""}`, left + 108, doc.y, { width: width - 108 });
    doc.end();
  });
}
