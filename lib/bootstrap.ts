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
