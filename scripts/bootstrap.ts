import { existsSync } from "node:fs";
import { bootstrapProduction } from "../lib/bootstrap";

if (existsSync(".env")) process.loadEnvFile(".env");

bootstrapProduction()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });
