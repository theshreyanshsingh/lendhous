// Encrypts records and files saved before encryption was switched on. Run it after the new build is serving:
// the old build can't read encrypted records. Safe to run again. Usage: npm run db:encrypt
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const { encryptionMode, fieldKeys } = await import("../lib/crypto");
  if ((process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https://") && encryptionMode() !== "keys") throw new Error("FIELD_ENCRYPTION_KEYS is required on a live site.");
  const { encryptStoredData } = await import("../lib/encrypt-data");
  const { prisma } = await import("../lib/prisma");
  const done = await encryptStoredData();
  console.log(`Encrypted with key ${fieldKeys()[0].id}: ${done.records} loan records, ${done.leads} leads, ${done.notices} notices, ${done.documentNames} file names, ${done.files} files.`);
  if (done.missing) console.log(`${done.missing} files couldn't be read. Look at the errors above, then run this again.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
