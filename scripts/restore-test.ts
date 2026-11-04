// Checks that a backup restores and opens: the main collections are there and encrypted records open with this
// server's keys (DEPLOY.md, "Backups and the restore test"). It only reads, except to drop a scratch copy it made.
//
//   RESTORE_DATABASE_URL=<a restored copy> npm run restore:test       an Atlas snapshot restored to another cluster or database
//   npm run restore:test -- --archive lendhous.archive.gz               a mongodump archive, restored into a scratch database
//                                                                       on DATABASE_URL's server and dropped afterwards
//                                                                       (needs mongorestore; add --keep to keep it)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { checkRestore } from "../lib/restore-check";

if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2);
const archive = args[args.indexOf("--archive") + 1] && args.includes("--archive") ? args[args.indexOf("--archive") + 1] : "";
const keep = args.includes("--keep");
const fail = (message: string): never => { console.error(message); process.exit(2); };

/** The same server with another database name. */
const withDatabase = (url: string, name: string) => {
  const match = url.match(/^(mongodb(?:\+srv)?:\/\/[^/?]+)\/?([^?]*)(\?.*)?$/);
  if (!match) fail("DATABASE_URL isn't a MongoDB address.");
  return { url: `${match![1]}/${name}${match![3] ?? ""}`, source: match![2] || "lendhous", server: `${match![1]}/${match![3] ?? ""}` };
};

let url = process.env.RESTORE_DATABASE_URL ?? "";
let scratch = "";
if (archive) {
  if (!existsSync(archive)) fail(`There's no file at ${archive}.`);
  if (spawnSync("mongorestore", ["--version"]).status !== 0) fail("mongorestore isn't installed. Install the MongoDB Database Tools, or restore the backup yourself and set RESTORE_DATABASE_URL.");
  const live = process.env.DATABASE_URL ?? fail("Set DATABASE_URL to the server to restore onto.");
  const target = withDatabase(live, `lendhous_restore_${Date.now()}`);
  scratch = target.url.split("/").pop()!.split("?")[0];
  console.log(`Restoring ${archive} into ${scratch}…`);
  const restored = spawnSync("mongorestore", [`--uri=${target.server}`, `--archive=${archive}`, ...(archive.endsWith(".gz") ? ["--gzip"] : []), `--nsFrom=${target.source}.*`, `--nsTo=${scratch}.*`], { stdio: "inherit" });
  if (restored.status !== 0) fail("mongorestore failed; nothing was checked.");
  url = target.url;
}
if (!url) fail("Set RESTORE_DATABASE_URL to a restored copy, or pass --archive <mongodump archive>. See DEPLOY.md.");
if (url === process.env.DATABASE_URL) console.log("Note: this is the live database, not a restored copy. It checks the keys, not the backup.");

const db = new PrismaClient({ datasourceUrl: url });
try {
  const report = await checkRestore(db);
  console.log("\nIn the copy:");
  for (const [name, count] of Object.entries(report.counts)) console.log(`  ${name}: ${count}`);
  console.log("\nOpened with this server's keys:");
  for (const [name, result] of Object.entries(report.opened)) console.log(`  ${name}: ${result.checked - result.failed} of ${result.checked}`);
  console.log(report.problems.length ? `\nFAIL\n${report.problems.map((problem) => `  ${problem}`).join("\n")}` : "\nPASS: the backup restores and its records open.");
  if (scratch && !keep) { await db.$runCommandRaw({ dropDatabase: 1 }); console.log(`Dropped ${scratch}.`); }
  process.exitCode = report.problems.length ? 1 : 0;
} finally {
  await db.$disconnect();
}
