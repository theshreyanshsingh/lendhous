// A local one-node MongoDB replica set for when Docker isn't running (docker-compose.yml is the other option).
// Prisma needs a replica set for transactions. Data persists in .mongo-data/. Stop with Ctrl-C.
import { mkdirSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const port = Number(process.env.DEV_DB_PORT || 27017);
const dbPath = ".mongo-data";
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  binary: { version: process.env.MONGOMS_VERSION || "7.0.24" },
  replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ port, dbPath }],
});
console.log(`MongoDB replica set rs0 on 127.0.0.1:${port} (data in ${dbPath}/).`);
console.log(`DATABASE_URL="mongodb://127.0.0.1:${port}/lendhous?directConnection=true"`);

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
