import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Soft delete on MongoDB: Prisma leaves an unset optional field out of the document, and `deletedAt: null` only
// matches a stored null, so that filter on its own finds nothing. Spread this into a where clause instead.
export const notDeleted = { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };
