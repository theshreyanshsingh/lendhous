import { existsSync } from "node:fs";
import { assertReleaseEnv, isReleaseBuild } from "../lib/deploy";

// On Vercel the variables are already set. On a pm2 server they live in .env, which next build reads but tsx does not.
if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  if (!isReleaseBuild(process.env)) {
    console.log("Skipping index sync and admin bootstrap. Set VERCEL=1 or LENDHOUS_RELEASE=1 to run them.");
    return;
  }
  assertReleaseEnv(process.env);
  const { prisma } = await import("../lib/prisma");
  const { syncValidators } = await import("../lib/mongo-validators");
  const { syncIndexes } = await import("../lib/mongo-indexes");
  const validators = await syncValidators(prisma);
  const indexes = await syncIndexes(prisma);
  console.log(`Validators in sync: ${validators}. Indexes in sync: ${indexes.indexes} declared, ${indexes.created} created or rebuilt.`);
  const { bootstrapProduction, dropSecondFactorData } = await import("../lib/bootstrap");
  await bootstrapProduction(process.env);
  await dropSecondFactorData();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
