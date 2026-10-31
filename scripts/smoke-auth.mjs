// End-to-end check of the B0 foundations against a running server and a seeded database:
// health, cron auth, sign-in on a password alone, where sign-in returns to, rate limits, sign-out.
// Usage: npm run db:seed && npm run build && npm start, then node scripts/smoke-auth.mjs
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const EMAIL = "uma.underwriter@lendhous.test";
const OWNER = "olivia.owner@lendhous.test";
const PASSWORD = "Lendhous2026!";
const checks = [];
const ok = (name, cond) => checks.push(`${cond ? "PASS" : "FAIL"} ${name}`);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const uma = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
const clearWindows = () => prisma.rateWindow.deleteMany({ where: { OR: [{ key: { contains: uma.id } }, { key: { contains: EMAIL } }, { key: { contains: OWNER } }] } });
await clearWindows();

const health = await (await fetch(`${BASE}/api/health`)).json();
ok(`health reports the database up (db=${health.db}, storage=${health.storage}, mail=${health.mail}, encryption=${health.encryption})`, health.ok && health.db === "ok");
ok("cron refuses a call without the secret", (await fetch(`${BASE}/api/cron`)).status === 401);
const cron = await fetch(`${BASE}/api/cron`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
ok(`cron runs the jobs with the secret (${cron.status})`, cron.status === 200);

const browser = await chromium.launch({ executablePath: CHROME });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shows = (role, text) => page.getByRole(role).filter({ hasText: text }).waitFor({ timeout: 10_000 }).then(() => true, () => false);

await page.goto(`${BASE}/admin/account/security`);
ok("security page sends a signed-out visitor to sign-in", page.url().includes("/login?next=%2Fadmin%2Faccount%2Fsecurity"));

const signIn = async ({ email = EMAIL, password = PASSWORD, path = "/login" } = {}) => {
  await page.goto(`${BASE}${path}`);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};
const signOut = async () => {
  await page.goto(`${BASE}/admin`);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL("**/login?notice=signed_out");
};

await signIn({ password: "wrong-password" });
ok("a wrong password is refused", await shows("alert", "don't match"));

await signIn();
await page.waitForURL("**/admin");
ok("a password alone signs an underwriter in, onto the pipeline", page.url().endsWith("/admin"));
ok("the sidebar shows who is signed in", (await page.getByTestId("signed-in-as").innerText()).includes("Uma Underwriter"));
ok("the session stays open", (await page.goto(`${BASE}/admin`), page.url().endsWith("/admin")));

await page.goto(`${BASE}/admin/account/security`);
ok("the security page offers a password link", await page.getByRole("button", { name: "Email me a password link" }).isVisible());
ok("the security page says nothing about sign-in codes", !/code/i.test(await page.locator("main").innerText()));
ok("the code screen is gone", (await page.goto(`${BASE}/login/verify`)).status() === 404);

await signOut();
ok("sign-out ends the session", (await page.goto(`${BASE}/admin/account/security`), page.url().includes("/login")));

await signIn({ path: "/login?next=%2Fadmin%2Faccount%2Fsecurity" });
await page.waitForURL("**/admin/account/security");
ok("sign-in returns to the page that asked for it", page.url().endsWith("/admin/account/security"));
await signOut();
for (const [label, next] of [["another site", "%2F%2Fexample.com"], ["a backslash path to another site", "%2F%5Cexample.com"], ["a tab in the path", "%2F%09%2Fexample.com"]]) {
  await signIn({ path: `/login?next=${next}` });
  await page.waitForURL("**/admin");
  ok(`sign-in won't follow ${label}`, new URL(page.url()).origin === new URL(BASE).origin);
  await signOut();
}

await signIn({ email: OWNER });
await page.waitForURL("**/admin");
await page.goto(`${BASE}/admin/settings`);
ok("settings still load for the owner", await page.getByTestId("settings-form").isVisible());
ok("settings have no sign-in code switch", !/sign-in code/i.test(await page.getByTestId("settings-form").innerText()));
await signOut();

await clearWindows();
for (let attempt = 0; attempt < 8; attempt++) {
  await signIn({ password: "wrong-password" });
  await shows("alert", "don't match");
}
await signIn({ password: "wrong-password" });
ok("a ninth try within ten minutes is refused", await shows("alert", "Too many sign-in attempts"));
await browser.close();

// Leave the seat as seeded so the script can run again.
await clearWindows();
const trail = await prisma.auditEvent.findMany({ where: { entityId: uma.id }, select: { action: true } });
ok(`the audit log recorded sign-ins, failures and sign-outs (${trail.length} rows)`, ["auth.login", "auth.login_failed", "auth.logout"].every((action) => trail.some((row) => row.action === action)));
await prisma.$disconnect();

ok(`no browser errors${errors.length ? `: ${errors[0]}` : ""}`, errors.length === 0);
console.log(checks.join("\n"));
if (checks.some((c) => c.startsWith("FAIL"))) process.exitCode = 1;
