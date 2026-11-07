// An investor's monthly statement as a PDF, made the same way as the payoff letters (lib/payoff-pdf.ts): pdfkit's
// built-in Times and Helvetica, and only characters those fonts cover.
import PDFDocument from "pdfkit";
import { lateFeesToInvestors, monthName, type Statement } from "./investor-statements";

const INK = "#202B28";
const SAGE = "#677D67";
const MUTED = "#5B6660";
const money = (amount: number) => `${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function statementPdf(statement: Statement, lender: string, sample = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 48, bottom: 48, left: 54, right: 54 }, info: { Title: `${lender} statement ${statement.month}`, Author: lender, Subject: `Statement for ${statement.investor.name}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const rule = (color = SAGE, weight = 0.75) => { doc.moveDown(0.3); doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(weight).strokeColor(color).stroke(); doc.moveDown(0.5); };

    doc.font("Times-Bold").fontSize(20).fillColor(INK).text(lender, left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${statement.investor.type === "partner" ? "Participation" : "Loan owner"} statement for ${monthName(statement.month)}`);
    rule(SAGE, 1.25);
    if (sample) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#9B2C2C").text("SAMPLE ONLY. These are made-up figures."); doc.moveDown(0.4); }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(statement.investor.name);
    doc.moveDown(0.6);

    const columns = [
      { label: "Loan", width: 0.13, value: (line: Statement["lines"][number]) => line.loanNumber, align: "left" as const },
      { label: "Share", width: 0.07, value: (line: Statement["lines"][number]) => `${Math.round(line.share * 100)}%`, align: "right" as const },
      { label: "Your rate", width: 0.08, value: (line: Statement["lines"][number]) => `${line.investorRate.toFixed(2)}%`, align: "right" as const },
      { label: "Interest", width: 0.11, value: (line: Statement["lines"][number]) => money(line.interest), align: "right" as const },
      { label: "Servicing fee", width: 0.11, value: (line: Statement["lines"][number]) => money(-line.servicingFee), align: "right" as const },
      { label: "Principal", width: 0.12, value: (line: Statement["lines"][number]) => money(line.principal), align: "right" as const },
      { label: "Net to you", width: 0.12, value: (line: Statement["lines"][number]) => money(line.net), align: "right" as const },
      { label: "Balance", width: 0.14, value: (line: Statement["lines"][number]) => money(line.balance), align: "right" as const },
      { label: "Days late", width: 0.12, value: (line: Statement["lines"][number]) => String(line.daysPastDue), align: "right" as const },
    ];
    const row = (cells: string[], bold = false) => {
      const y = doc.y;
      let x = left;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK);
      cells.forEach((cell, index) => { const w = columns[index].width * width; doc.text(cell, x, y, { width: w - 6, align: columns[index].align }); x += w; });
      doc.y = y + 15;
      doc.x = left;
    };
    row(columns.map((column) => column.label), true);
    rule(MUTED, 0.5);
    if (!statement.lines.length) { doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("No loans held this month."); doc.moveDown(0.5); }
    for (const line of statement.lines) row(columns.map((column) => column.value(line)));
    rule(MUTED, 0.5);
    const t = statement.totals;
    row(["Total", "", "", money(t.interest), money(-t.servicingFee), money(t.principal), money(t.net), money(t.balance), ""], true);
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text([
      "Interest is your share of what borrowers paid this month at the loan's rate. The servicing fee is what LendHous keeps as servicer: the difference between the loan's rate and yours.",
      `Late fees collected this month: ${money(t.lateFees)}${lateFeesToInvestors() ? ", included in the net above." : ", kept by LendHous as servicer under your agreement."}`,
      "Balance is your share of the unpaid principal at the end of the month. Days late counts from the oldest unpaid payment. Questions: reply to the email this came with or call your LendHous contact.",
    ].join("\n"), left, doc.y, { width });
    doc.end();
  });
}
