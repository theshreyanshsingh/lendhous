import bcrypt from "bcryptjs";
import { assertReleaseEnv, isDemoEmail } from "./deploy";
import { prisma } from "./prisma";

/** Production bootstrap: one approved owner-admin in the lender-house organization, and the settings row. No demo data. */
export async function bootstrapProduction(env: Record<string, string | undefined> = process.env) {
  assertReleaseEnv(env);
  const demo = await prisma.user.count({ where: { email: { endsWith: "@lendhous.test" } } });
  if (demo > 0) throw new Error("Demo accounts are already in this database. Refusing to treat it as production.");
  const email = env.ADMIN_EMAIL!.trim().toLowerCase();
  if (isDemoEmail(email)) throw new Error("ADMIN_EMAIL cannot be a demo account.");
  const existing = await prisma.user.findUnique({ where: { email }, include: { roles: true } });
  if (existing) {
    if (existing.accountStatus !== "APPROVED" || !existing.roles.some((role) => role.role === "ADMIN_OWNER")) {
      throw new Error("ADMIN_EMAIL already belongs to an account that is not an approved owner-admin.");
    }
    console.log(`Admin ${email} already exists. Password was left unchanged.`);
  } else {
    const house =
      (await prisma.organization.findFirst({ where: { type: "LENDER_HOUSE" } })) ??
      (await prisma.organization.create({ data: { name: env.LENDER_NAME?.trim() || "Lendhous", type: "LENDER_HOUSE" } }));
    await prisma.user.create({
      data: {
        email,
        name: env.ADMIN_NAME?.trim() || "Owner",
        accountStatus: "APPROVED",
        organizationId: house.id,
        passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD!, 10),
        roles: { create: [{ role: "ADMIN_OWNER" }] },
      },
    });
    console.log(`Created admin ${email}.`);
  }
  await prisma.platformSettings.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
}

const SECOND_FACTOR_FIELDS = {
  User: { totpSecretEnc: "", totpEnabled: "", recoveryHashes: "", recoveryRevealEnc: "", emailOtpFallback: "" },
  ServerSession: { secondFactorAt: "" },
  PlatformSettings: { requireStaffMfa: "" },
};

/** Sign-in is password only now, so this clears what two-factor left behind. Sessions stay open. Safe to run again. */
export async function dropSecondFactorData() {
  for (const [collection, fields] of Object.entries(SECOND_FACTOR_FIELDS)) {
    await prisma.$runCommandRaw({ update: collection, updates: [{ q: {}, u: { $unset: fields }, multi: true }] });
  }
  // Older MongoDB versions refuse to drop a collection that isn't there, so look first.
  const found = (await prisma.$runCommandRaw({ listCollections: 1, filter: { name: "LoginCode" } })) as { cursor: { firstBatch: unknown[] } };
  if (found.cursor.firstBatch.length) await prisma.$runCommandRaw({ drop: "LoginCode" });
}
