// Demo seats for local and staging databases. Every person and company here is FAKE. Starts by dropping the
// database, so it refuses to run in production (lib/deploy.ts), as UPB Capital's seed does.
import { existsSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient, type RoleCode } from "@prisma/client";
import { assertDemoSeedAllowed, assertMongoUrl, DEMO_DOMAIN, DEV_DEMO_PASSWORD } from "../lib/deploy";
import { syncIndexes } from "../lib/mongo-indexes";
import { syncValidators } from "../lib/mongo-validators";

if (existsSync(".env")) process.loadEnvFile(".env");
assertDemoSeedAllowed();
assertMongoUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

const seats: { local: string; name: string; roles: RoleCode[]; org?: "house" | "partner" | "broker" }[] = [
  { local: "olivia.owner", name: "Olivia Owner (FAKE)", roles: ["ADMIN_OWNER"], org: "house" },
  { local: "uma.underwriter", name: "Uma Underwriter (FAKE)", roles: ["UNDERWRITER"], org: "house" },
  { local: "pat.processor", name: "Pat Processor (FAKE)", roles: ["PROCESSOR"], org: "house" },
  { local: "cam.capital", name: "Cam Capital (FAKE)", roles: ["CAPITAL_MANAGER"], org: "house" },
  { local: "ivan.inspector", name: "Ivan Inspector (FAKE)", roles: ["INSPECTOR"], org: "house" },
  { local: "alex.sample", name: "Alex Sample (FAKE)", roles: ["BORROWER"] },
  { local: "pia.partner", name: "Pia Partner (FAKE)", roles: ["PARTNER_LENDER"], org: "partner" },
  { local: "bea.broker", name: "Bea Broker (FAKE)", roles: ["BROKER"], org: "broker" },
];

async function main() {
  await prisma.$runCommandRaw({ dropDatabase: 1 });
  await syncValidators(prisma);
  await syncIndexes(prisma);
  const orgs = {
    house: await prisma.organization.create({ data: { name: "Lendhous Demo Lender (FAKE)", type: "LENDER_HOUSE" } }),
    partner: await prisma.organization.create({ data: { name: "Demo Partner Capital A (FAKE)", type: "PARTNER_LENDER" } }),
    broker: await prisma.organization.create({ data: { name: "Demo Brokerage (FAKE)", type: "BROKER", licenseNumbers: ["FAKE-0000"] } }),
  };
  const passwordHash = await bcrypt.hash(DEV_DEMO_PASSWORD, 10);
  for (const seat of seats) {
    await prisma.user.create({
      data: {
        email: `${seat.local}@${DEMO_DOMAIN}`,
        name: seat.name,
        passwordHash,
        accountStatus: "APPROVED",
        organizationId: seat.org ? orgs[seat.org].id : undefined,
        roles: { create: seat.roles.map((role) => ({ role })) },
      },
    });
  }
  // Demo convenience only: staff and partner seats can sign in without an authenticator. Production bootstrap
  // leaves the default (required). Turn it back on in the demo with requireStaffMfa: true.
  await prisma.platformSettings.create({ data: { id: "default", requireStaffMfa: false } });
  console.log(`Seeded ${seats.length} demo seats (password ${DEV_DEMO_PASSWORD}) in 3 organizations.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
