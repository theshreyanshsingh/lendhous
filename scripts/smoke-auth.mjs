// End-to-end check of the B0 foundations against a running server and a seeded database:
// health, cron auth, sign-in, emailed sign-in codes, the role requirement, rate limits, sign-out.
// Usage: npm run db:seed && npm run build && npm start, then node scripts/smoke-auth.mjs
import { createHmac, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const EMAIL = "uma.underwriter@lendhous.test";
const PASSWORD = "Lendhous2026!";
const checks = [];
const ok = (name, cond) => checks.push(`${cond ? "PASS" : "FAIL"} ${name}`);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const uma = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
const clearWindows = () => prisma.rateWindow.deleteMany({ where: { OR: [{ key: { contains: uma.id } }, { key: { contains: EMAIL } }] } });
await clearWindows();

// Demo addresses get no mail, so this files a code the way lib/login-code.ts does, then enters it.
const plantCode = async () => {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = createHmac("sha256", process.env.AUTH_SECRET).update(`${uma.id}:${code}`).digest("hex");
  await prisma.loginCode.create({ data: { userId: uma.id, codeHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  return code;
};
// Fills the current window of a rate limit, so the next request is the one over the limit.
const fillWindow = (key, windowMs) => {
  const slot = `${key}:${Math.floor(Date.now() / windowMs)}`;
  return prisma.rateWindow.upsert({ where: { key: slot }, create: { key: slot, count: 5, expiresAt: new Date(Date.now() + windowMs) }, update: { count: 5 } });
};

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

const signIn = async (password = PASSWORD) => {
  await page.goto(`${BASE}/login`);
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};
const signOut = async () => {
  await page.goto(`${BASE}/admin`);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL("**/login?notice=signed_out");
};
const enterCode = async (code) => {
  await page.getByTestId("login-code").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
};

await signIn("wrong-password");
ok("a wrong password is refused", await shows("alert", "don't match"));

await signIn();
await page.waitForURL("**/admin");
ok("an underwriter lands on the pipeline", page.url().endsWith("/admin"));
ok("the sidebar shows who is signed in", (await page.getByTestId("signed-in-as").innerText()).includes("Uma Underwriter"));

await page.goto(`${BASE}/admin/account/security`);
await page.getByRole("button", { name: "Turn on sign-in codes" }).click();
await page.waitForURL("**notice=codes_on");
ok("sign-in codes turn on from the security page", await shows("status", "Sign-in codes are on"));
await signOut();
ok("sign-out ends the session", (await page.goto(`${BASE}/admin/account/security`), page.url().includes("/login")));

await signIn();
await page.waitForURL("**/login/verify?notice=email_sent");
ok("with codes on, sign-in sends a code to the account's address", (await page.getByTestId("code-email").innerText()) === EMAIL);
await enterCode("000000");
ok("a wrong code is refused", await shows("alert", "wrong or has expired"));
const code = await plantCode();
await enterCode(code);
await page.waitForURL("**/admin");
ok("the right code signs in", page.url().endsWith("/admin"));

await signOut();
await signIn();
await page.waitForURL("**/login/verify?notice=email_sent");
await enterCode(code);
ok("a used code is refused", await shows("alert", "wrong or has expired"));
await page.getByRole("button", { name: "Send a new code" }).click();
ok("a new code can be requested", await shows("status", "on its way"));
await enterCode(await plantCode());
await page.waitForURL("**/admin");

await clearWindows();
await page.goto(`${BASE}/admin/account/security`);
await page.getByTestId("codes-password").fill("wrong-password");
await page.getByRole("button", { name: "Turn off" }).click();
ok("turning codes off refuses a wrong password", await shows("alert", "doesn't match"));
await page.getByTestId("codes-password").fill(PASSWORD);
await page.getByRole("button", { name: "Turn off" }).click();
await page.waitForURL("**notice=codes_off");
await signOut();
await signIn();
await page.waitForURL("**/admin");
ok("with codes off, the password alone signs in", page.url().endsWith("/admin"));

// What production does. getSettings caches for twenty seconds.
await prisma.platformSettings.update({ where: { id: "default" }, data: { requireStaffMfa: true } });
await page.waitForTimeout(21_000);
await page.goto(`${BASE}/admin`);
ok("a staff session opened without a code ends when the role requires one", page.url().includes("/login"));
await signIn();
await page.waitForURL("**/login/verify?notice=email_sent");
ok("staff are asked for a code without turning anything on", page.url().includes("/login/verify"));
await enterCode(await plantCode());
await page.waitForURL("**/admin");
ok("the code opens a session that stays open", (await page.goto(`${BASE}/admin`), page.url().endsWith("/admin")));
await page.goto(`${BASE}/admin/account/security`);
ok("the security page says the role keeps codes on", await page.getByTestId("codes-required").isVisible());

await signOut();
await signIn();
await page.waitForURL("**/login/verify?notice=email_sent");
await fillWindow(`login-code-send:${uma.id}`, 10 * 60 * 1000);
await page.getByRole("button", { name: "Send a new code" }).click();
ok("a sixth code request within ten minutes is refused", await shows("alert", "Too many codes requested"));
await fillWindow(`login-code:${uma.id}`, 15 * 60 * 1000);
await enterCode(await plantCode());
ok("a sixth code within fifteen minutes is refused even when it is right", await shows("alert", "Wait fifteen minutes"));
await browser.close();

// Leave the seat as seeded so the script can run again.
await prisma.platformSettings.update({ where: { id: "default" }, data: { requireStaffMfa: false } });
await prisma.user.update({ where: { id: uma.id }, data: { emailCodeEnabled: false } });
await prisma.loginCode.deleteMany({ where: { userId: uma.id } });
await clearWindows();
const trail = await prisma.auditEvent.findMany({ where: { entityId: uma.id }, select: { action: true } });
ok(`the audit log recorded sign-ins, failures and code changes (${trail.length} rows)`, ["auth.login", "auth.login_failed", "auth.second_factor_failed", "security.login_code_on", "security.login_code_off", "auth.logout"].every((action) => trail.some((row) => row.action === action)));
ok("no sign-in code is kept in the notifications", (await prisma.notification.count({ where: { toEmail: EMAIL, subject: { contains: "sign-in code" } } })) === 0);
await prisma.$disconnect();

ok(`no browser errors${errors.length ? `: ${errors[0]}` : ""}`, errors.length === 0);
console.log(checks.join("\n"));
if (checks.some((c) => c.startsWith("FAIL"))) process.exitCode = 1;
