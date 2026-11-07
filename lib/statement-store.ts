// Keeps each investor's monthly statement (lib/investor-statements.ts) as it was made, and tells the investor's people
// it's ready. Making them twice for the same month does nothing: the first one stands.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { readBook } from "@/lib/book-store";
import { openJson, sealJson } from "@/lib/crypto";
import { notify } from "@/lib/email";
import { monthName, setInvestorFees, statementFor, type Investor, type Statement } from "@/lib/investor-statements";
import { freshSettings } from "@/lib/settings";
import { notDeleted, prisma } from "@/lib/prisma";

const context = (id: string) => `InvestorStatement:${id}`;
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const PORTFOLIO: Record<Investor["type"], string> = { partner: "/admin/partner/portfolio", buyer: "/admin/buyer/portfolio" };
const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Makes and emails the month's statement for every partner and buyer that held a loan in it. Returns how many were new. */
export async function makeStatements(month: string) {
  // Statements follow the fee split an owner chose in Settings.
  setInvestorFees({ lateFees: (await freshSettings()).lateFeesToInvestors === true });
  const { book } = await readBook();
  const investors: Investor[] = [...book.partners.map((partner) => ({ type: "partner" as const, id: partner.id })), ...book.buyers.map((buyer) => ({ type: "buyer" as const, id: buyer.id }))];
  let made = 0;
  for (const investor of investors) {
    const statement = statementFor(book, investor, month);
    if (!statement.lines.length) continue;
    const id = randomUUID();
    try {
      await prisma.investorStatement.create({ data: { id, investorType: investor.type, investorId: investor.id, month, data: sealJson(statement, context(id)) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
    const people = await prisma.user.findMany({ where: { AND: [{ OR: [{ id: investor.id }, { organizationId: investor.id }] }, notDeleted], accountStatus: "APPROVED" }, select: { email: true } });
    for (const person of people) {
      await notify(person.email, `Your ${monthName(month)} statement from LendHous`, `Your statement for ${monthName(month)} is ready: ${dollars(statement.totals.net)} to you across ${statement.lines.length} loan${statement.lines.length === 1 ? "" : "s"}, with ${dollars(statement.totals.balance)} outstanding at the end of the month.\n\nDownload it as a PDF or a spreadsheet from your portfolio: ${origin()}${PORTFOLIO[investor.type]}`, { eventCode: "statement.ready" });
    }
    await prisma.investorStatement.update({ where: { id }, data: { emailedAt: new Date() } });
    made++;
  }
  return made;
}

/** An investor's statements, newest first, with their totals. */
export async function statementsOf(investor: Investor) {
  const rows = await prisma.investorStatement.findMany({ where: { investorType: investor.type, investorId: investor.id }, orderBy: { month: "desc" }, take: 36 });
  return rows.map((row) => {
    const statement = openJson(row.data, context(row.id)) as Statement;
    return { id: row.id, month: row.month, net: statement.totals.net, balance: statement.totals.balance, loans: statement.lines.length };
  });
}

export async function openStatement(id: string) {
  const row = await prisma.investorStatement.findUnique({ where: { id } });
  return row ? { row, statement: openJson(row.data, context(row.id)) as Statement } : null;
}
