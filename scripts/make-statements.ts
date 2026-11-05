// Makes the partners', buyers' and borrowers' statements for a month now, instead of waiting for the nightly job on the 1st: to
// catch up a month the job missed. Months already made are left as they were.
// Usage: npm run statements -- 2026-10   (no month: last month)
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const { previousMonth } = await import("../lib/investor-statements");
const { servicingDate } = await import("../lib/servicing");
const { makeStatements } = await import("../lib/statement-store");
const { makeBorrowerStatements } = await import("../lib/borrower-statement-store");
const { prisma } = await import("../lib/prisma");

const month = process.argv[2] ?? previousMonth(servicingDate(new Date()));
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
  console.error(`"${month}" isn't a month. Use YYYY-MM, like 2026-10.`);
  process.exit(2);
}
try {
  console.log(`${await makeStatements(month)} new investor statements and ${await makeBorrowerStatements(month)} new borrower statements for ${month}.`);
} finally {
  await prisma.$disconnect();
}
