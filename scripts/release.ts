import { assertReleaseEnv, isReleaseBuild } from "../lib/deploy";

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
  const { bootstrapProduction } = await import("../lib/bootstrap");
  await bootstrapProduction(process.env);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
