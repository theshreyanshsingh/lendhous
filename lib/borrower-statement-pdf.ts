// A borrower's monthly statement as a PDF, made like the investor statements (lib/statement-pdf.ts): pdfkit's built-in
// Times and Helvetica, and only characters those fonts cover.
import PDFDocument from "pdfkit";
import type { BorrowerStatement } from "./borrower-statements";
import { BANKRUPTCY_NOTE } from "./collections";
import { shortDay } from "./format";
import { monthName } from "./investor-statements";

const INK = "#202B28";
const SAGE = "#677D67";
const MUTED = "#5B6660";
const BAD = "#9B2C2C";
const money = (amount: number) => `${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function borrowerStatementPdf(statement: BorrowerStatement, lender: string, howToPay: string, sample = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 54, left: 60, right: 60 }, info: { Title: `${lender} loan statement ${statement.month}`, Author: lender, Subject: `Statement for ${statement.loanNumber}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const rule = (color = SAGE, weight = 0.75) => { doc.moveDown(0.3); doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(weight).strokeColor(color).stroke(); doc.moveDown(0.5); };
    const heading = (text: string) => { doc.moveDown(0.6); doc.font("Helvetica-Bold").fontSize(9).fillColor(SAGE).text(text.toUpperCase(), left, doc.y, { characterSpacing: 1 }); doc.moveDown(0.3); };
    const line = (label: string, value: string, bold = false, color = INK) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(MUTED).text(label, left, y, { width: width * 0.62 });
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(color).text(value, left + width * 0.62, y, { width: width * 0.38, align: "right" });
      doc.y = Math.max(doc.y, y + 14);
    };

    doc.font("Times-Bold").fontSize(20).fillColor(INK).text(lender, left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Loan statement for ${monthName(statement.month)} · dated ${shortDay(statement.statementDate)}`);
    rule(SAGE, 1.25);
    if (sample) { doc.font("Helvetica-Bold").fontSize(10).fillColor(BAD).text("SAMPLE ONLY. These are made-up figures."); doc.moveDown(0.4); }
    if (statement.bankruptcy) { doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(BANKRUPTCY_NOTE, left, doc.y, { width }); doc.moveDown(0.4); }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`${statement.loanNumber} · ${statement.property}`);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text([statement.borrowerName, statement.entityName].filter(Boolean).join(" · "));

    heading(statement.paidOff ? "Paid off" : "What's due");
    if (statement.paidOff) line("Paid in full on", shortDay(statement.paidOff), true);
    else {
      if (statement.amountDue > 0) line(`Past due now${statement.daysPastDue ? ` (${statement.daysPastDue} days)` : ""}`, money(statement.amountDue), true, BAD);
      line(statement.nextDue ? `Next payment, due ${shortDay(statement.nextDue.on)}` : "Next payment", statement.nextDue ? money(statement.nextDue.amount) : "None due", true);
    }

    heading(`During ${monthName(statement.month)}`);
    if (!statement.payments.length) line("Payments received", "None");
    for (const payment of statement.payments) line(`Payment received ${shortDay(payment.on)} (${payment.method})`, money(payment.amount));
    if (statement.payments.length > 1) line("Total received", money(statement.received), true);
    for (const bill of statement.billed) line(`Payment due ${shortDay(bill.due)}`, money(bill.amount));
    if (statement.lateFees) line("Late fees charged", money(statement.lateFees), false, BAD);
    for (const draw of statement.draws) line(`Draw paid ${shortDay(draw.on)}`, money(draw.amount));

    heading("The loan");
    line("Principal balance", money(statement.principal), true);
    line("Interest rate", `${statement.rate.toFixed(2)}% ${statement.interestOn}`);
    line("Matures", shortDay(statement.maturity));
    if (statement.holdback.total > 0) {
      line("Rehab money held back", money(statement.holdback.total));
      line("Paid out in draws so far", money(statement.holdback.drawn));
      line("Still to draw", money(statement.holdback.remaining));
    }
    if (statement.feesOwed) line("Fees owed", money(statement.feesOwed), false, BAD);
    line(`Interest paid in ${statement.month.slice(0, 4)} so far`, money(statement.interestThisYear));
    if (statement.payoff) {
      heading("Paying it off");
      line(`Estimated payoff, good through ${shortDay(statement.payoff.goodThrough)}`, money(statement.payoff.total), true);
      line("Each day after that adds", money(statement.payoff.perDiem));
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text("An estimate. To pay the loan off, ask for a payoff letter from your loan page; its figures are the ones to pay.", left, doc.y + 2, { width });
    }

    heading("How to pay");
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(howToPay.trim() || "Call your LendHous servicing team for how to pay.", left, doc.y, { width });
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(BAD).text("We will never email you new payment or wire instructions. Before you send money, confirm the instructions by calling a LendHous number you already have.", left, doc.y, { width });
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("A business-purpose loan. Questions about this statement: message your team from your loan page, or call your loan officer.", left, doc.y, { width });
    doc.end();
  });
}
