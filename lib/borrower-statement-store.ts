// Keeps each funded loan's monthly statement (lib/borrower-statements.ts) as it was made, and tells the borrower it's
// ready. Making them twice for the same month does nothing: the first one stands.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { readBook } from "@/lib/book-store";
import { borrowerStatementFor, type BorrowerStatement } from "@/lib/borrower-statements";
import { openJson, sealJson } from "@/lib/crypto";
import { notify } from "@/lib/email";
import { shortDay } from "@/lib/format";
import { monthName } from "@/lib/investor-statements";
import { notDeleted, prisma } from "@/lib/prisma";

const context = (id: string) => `BorrowerStatement:${id}`;
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Makes and emails the month's statement for every loan that gets one. Returns how many were new. */
export async function makeBorrowerStatements(month: string) {
  const { book } = await readBook();
  let made = 0;
  for (const deal of book.deals) {
    const statement = borrowerStatementFor(book, deal, month);
    if (!statement) continue;
    const id = randomUUID();
    try {
      await prisma.borrowerStatement.create({ data: { id, dealId: deal.id, borrowerId: deal.borrowerId, month, data: sealJson(statement, context(id)) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
    made++;
    // A loan the team entered for someone without a portal account has nobody to email; its statement still waits for them.
    const borrower = await prisma.user.findFirst({ where: { id: deal.borrowerId, accountStatus: "APPROVED", ...notDeleted }, select: { email: true } });
    if (!borrower) continue;
    const due = statement.paidOff ? "The loan is paid in full." : statement.nextDue ? `Your next payment is ${dollars(statement.nextDue.amount)}, due ${shortDay(statement.nextDue.on)}.` : "";
    await notify(borrower.email, `Your ${monthName(month)} statement for ${deal.loanNumber}`, `Your loan statement for ${monthName(month)} is ready. ${due}\n\nSee it, and download it as a PDF, on your loan page: ${origin()}/admin/borrower/${deal.id}#statements`, { eventCode: "statement.ready" });
    await prisma.borrowerStatement.update({ where: { id }, data: { emailedAt: new Date() } });
  }
  return made;
}

/** A loan's statements, newest first, with what each says is due. */
export async function statementsForLoan(dealId: string) {
  const rows = await prisma.borrowerStatement.findMany({ where: { dealId }, orderBy: { month: "desc" }, take: 60 });
  return rows.map((row) => {
    const statement = openJson(row.data, context(row.id)) as BorrowerStatement;
    return { id: row.id, month: row.month, principal: statement.principal, received: statement.received, nextDue: statement.nextDue, paidOff: statement.paidOff ?? null };
  });
}

export async function openBorrowerStatement(id: string) {
  const row = await prisma.borrowerStatement.findUnique({ where: { id } });
  return row ? { row, statement: openJson(row.data, context(row.id)) as BorrowerStatement } : null;
}
