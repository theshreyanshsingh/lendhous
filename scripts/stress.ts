// A stress test for a local copy only. It fills the local database with thousands of loans (copies of the demo book's,
// all FAKE), then measures how the loan book and the running app hold up as it grows: reading the whole book, what a
// staff browser is sent, the work queue, saving one action at a time and many at once, and page times under load.
// It refuses to run against anything but a database and an app on this machine. Reseed with `npm run db:seed` after.
//
//   npm run build && npm start        (in another terminal, for the page timings)
//   npx tsx scripts/stress.ts         (STRESS_SIZES=250,1000,2500 STRESS_HTTP=0 to skip the page timings)
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import bcrypt from "bcryptjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SIZES = (process.env.STRESS_SIZES || "250,1000,2500").split(",").map(Number).filter((n) => n > 0);
const HTTP = process.env.STRESS_HTTP !== "0";
const local = (url: string) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
if (!process.env.DATABASE_URL || !local(process.env.DATABASE_URL)) throw new Error("The stress test only runs against a database on this machine.");
if (!local(BASE)) throw new Error("The stress test only loads an app on this machine.");

const { prisma } = await import("../lib/prisma");
const { demoBook, serviceDay } = await import("../lib/book");
const { readBook, runAction, rowContext } = await import("../lib/book-store");
const { scopeBook } = await import("../lib/book-access");
const { sealJson } = await import("../lib/crypto");
const { workQueue } = await import("../lib/work-queue");
const { businessReport } = await import("../lib/reports");
const { evaluate } = await import("../lib/engine");
const { nextStage } = await import("../lib/loan-stages");

const PREFIX = "stress-";
const DOMAIN = "stress.example.org";
const ms = (start: number) => Math.round(performance.now() - start);
const pct = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0; };
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const lines: string[] = [];
const say = (text: string) => { console.log(text); lines.push(text); };

// Clean out anything an earlier run left.
await prisma.bookRecord.deleteMany({ where: { id: { contains: `:${PREFIX}` } } });
await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });

// The demo's loans and messages are the pattern: every kind of loan, at every stage.
const demo = demoBook();
const templates = demo.deals;
const staff = { id: "stress-staff", name: "Stella Stress (FAKE)", roleCodes: ["ADMIN_OWNER" as const] };
let made = 0;
async function growTo(size: number) {
  const rows: { id: string; kind: string; data: never }[] = [];
  for (; made < size; made++) {
    const from = templates[made % templates.length];
    const id = `${PREFIX}${made}`;
    const deal = { ...from, id, loanNumber: `LH-S${String(made).padStart(5, "0")}`, borrowerId: `${PREFIX}borrower-${made % 400}`, borrowerName: `Stress Borrower ${made % 400} (FAKE)`, brokerId: from.brokerId ? `${PREFIX}broker-${made % 25}` : undefined };
    rows.push({ id: `deals:${id}`, kind: "deals", data: sealJson(deal, rowContext(`deals:${id}`)) as never });
    for (const [n, message] of demo.messages.filter((item) => item.dealId === from.id).entries()) {
      const copy = { ...message, id: `${PREFIX}msg-${made}-${n}`, dealId: id };
      rows.push({ id: `messages:${copy.id}`, kind: "messages", data: sealJson(copy, rowContext(`messages:${copy.id}`)) as never });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await prisma.bookRecord.createMany({ data: rows.slice(i, i + 500) });
}

type Row = Record<string, string | number>;
const results: Row[] = [];

for (const size of SIZES) {
  await growTo(size);
  const row: Row = { loans: size };
  // Reading the whole book: every action and every signed-in page does this.
  const reads: number[] = [];
  let book = (await readBook()).book;
  for (let i = 0; i < 3; i++) { const start = performance.now(); book = (await readBook()).book; reads.push(ms(start)); }
  row["read book (ms)"] = pct(reads, 50);
  row["records"] = book.deals.length + book.messages.length + book.draws.length;
  // What a staff browser is sent, and a borrower's.
  const staffJson = JSON.stringify(scopeBook(book, staff));
  row["staff page data"] = mb(staffJson.length);
  row["gzipped"] = mb(gzipSync(staffJson).length);
  row["borrower page data"] = `${Math.round(JSON.stringify(scopeBook(book, { id: `${PREFIX}borrower-1`, name: "B", roleCodes: ["BORROWER"] })).length / 1024)} KB`;
  // The pipeline's sums: the work queue, each loan's next step, and the month's report.
  let start = performance.now();
  workQueue(book, { id: staff.id }, new Date());
  row["work queue (ms)"] = ms(start);
  start = performance.now();
  for (const deal of book.deals) nextStage(deal, evaluate(deal.app), serviceDay(book));
  row["next steps (ms)"] = ms(start);
  start = performance.now();
  businessReport(book, { from: "2026-01-01", to: "2026-12-31" }, serviceDay(book));
  row["report (ms)"] = ms(start);
  // Saving: one at a time, then ten at once on different loans, then ten at once on the same loan.
  // A save that throws (the database dropping a read, say) counts as failed, with why.
  const note = (n: number, dealId: string) => runAction(staff, { t: "sendMessage", dealId, from: "", side: "internal", text: `Stress note ${n}` }).catch((error: unknown) => ({ error: `threw: ${String(error).split("\n").filter(Boolean).at(-1)?.slice(0, 120)}` }));
  const why = (all: { error?: string }[]) => [...new Set(all.flatMap((result) => (result.error ? [result.error.startsWith("threw") ? "crashed" : result.error.startsWith("Someone else") ? "clash" : result.error] : [])))].join("/") || "-";
  const one: number[] = [];
  for (let i = 0; i < 5; i++) { start = performance.now(); const result = await note(i, `${PREFIX}${i}`); one.push(ms(start)); if ("error" in result) row["save error"] = result.error; }
  row["save one (ms)"] = pct(one, 50);
  for (const [label, ids] of [["10 at once", Array.from({ length: 10 }, (_, i) => `${PREFIX}${i * 7}`)], ["10 on one loan", Array.from({ length: 10 }, () => `${PREFIX}3`)]] as const) {
    start = performance.now();
    const all = await Promise.all(ids.map((dealId, i) => note(100 + i, dealId)));
    const failed = all.filter((result) => "error" in result).length;
    row[`${label} (ms)`] = ms(start);
    row[`${label} failed`] = failed ? `${failed} (${why(all as { error?: string }[])})` : 0;
  }
  row["server heap"] = mb(process.memoryUsage().heapUsed);
  results.push(row);
  say(`\n${size} loans: ${Object.entries(row).map(([key, value]) => `${key} ${value}`).join(" · ")}`);
}

// The running app under load, at the largest size.
if (HTTP) {
  const up = await fetch(BASE, { redirect: "manual" }).then((response) => response.status < 500, () => false);
  if (!up) say(`\nNo app at ${BASE}: page timings skipped. Run npm run build && npm start first.`);
  else {
    const password = randomBytes(18).toString("base64url");
    const email = `stress.owner@${DOMAIN}`;
    await prisma.user.create({ data: { email, name: "Stella Stress (FAKE)", passwordHash: await bcrypt.hash(password, 10), accountStatus: "APPROVED", roles: { create: [{ role: "ADMIN_OWNER" }] } } });
    const { chromium } = await import("playwright-core");
    const chrome = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
    const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    const cookie = (await page.context().cookies()).map((item) => `${item.name}=${item.value}`).join("; ");
    await browser.close();
    const serverPid = (() => { try { return execSync(`lsof -ti tcp:${new URL(BASE).port || 80} -sTCP:LISTEN`).toString().trim().split("\n")[0]; } catch { return ""; } })();
    const rss = () => (serverPid ? mb(Number(execSync(`ps -o rss= -p ${serverPid}`).toString().trim()) * 1024) : "?");
    say(`\nPages under load (${made} loans in the book; the app's memory ${rss()} before):`);
    // Each path: a number of requests, so many at a time. Signed-in pages read the whole book on every request.
    const runs: [string, number, number, boolean][] = [
      ["/", 200, 50, false], ["/start", 200, 50, false],
      ["/admin", 10, 1, true], ["/admin", 30, 10, true], [`/admin/deals/${PREFIX}5`, 30, 10, true], ["/admin/reports", 10, 5, true], ["/admin/servicing", 10, 5, true],
    ];
    for (const [path, total, concurrency, signedIn] of runs) {
      const times: number[] = [];
      const statuses = new Map<number, number>();
      let bytes = 0;
      let next = 0;
      // A signed-in page that came back without the book in it (an error, or a page cut short) is counted apart.
      let whole = 0;
      const sizes: number[] = [];
      const started = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < total) {
          next++;
          const start = performance.now();
          try {
            const response = await fetch(BASE + path, { headers: signedIn ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(120_000) });
            const body = await response.text();
            bytes += body.length;
            sizes.push(body.length);
            if (!signedIn || body.includes("LH-S00005")) whole++;
            statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
          } catch {
            statuses.set(0, (statuses.get(0) ?? 0) + 1);
          }
          times.push(ms(start));
        }
      }));
      const seconds = (performance.now() - started) / 1000;
      say(`${path.padEnd(28)} ${String(total).padStart(3)} requests, ${String(concurrency).padStart(2)} at a time: p50 ${pct(times, 50)} ms, p95 ${pct(times, 95)} ms, max ${Math.max(...times)} ms, ${(total / seconds).toFixed(1)}/s, ${mb(bytes / total)} each (${mb(Math.min(...sizes))} to ${mb(Math.max(...sizes))}), ${whole} whole, status ${[...statuses].map(([code, count]) => `${code || "timeout"}×${count}`).join(" ")}`);
    }
    say(`The app's memory after: ${rss()}`);
  }
}

await prisma.bookRecord.deleteMany({ where: { id: { contains: `:${PREFIX}` } } });
await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
await prisma.$disconnect();
console.log("\nStress records removed. Reseed with npm run db:seed.");
