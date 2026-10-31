// Headless smoke test + screenshots against a running server and a seeded database (npm run db:seed).
// Usage: npm run build && npm start, then node scripts/screenshots.mjs (server on :3000)
// Each workspace is driven as its demo seat. A temporary non-demo account checks that demo data stays with demo seats.
import { existsSync } from "node:fs";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { chromium } from "playwright-core";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screenshots";
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const PASSWORD = "Lendhous2026!";
const SEATS = { borrower: "alex.sample@lendhous.test", staff: "olivia.owner@lendhous.test", partner: "pia.partner@lendhous.test" };
const NON_DEMO = "nora.nondemo@example.org";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];
const checks = [];
const ok = (name, cond) => { checks.push(`${cond ? "PASS" : "FAIL"} ${name}`); };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
const shot = async (p, name, full = true) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}`, fullPage: full }); };

// Sessions are kept per seat and swapped in later, so the run signs in once per seat (sign-in is rate limited).
const sessions = {};
async function signIn(p, email) {
  await p.context().clearCookies(); // /login sends anyone already signed in to their panel
  await p.goto(BASE + "/login");
  await p.getByTestId("login-email").fill(email);
  await p.getByTestId("login-password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
  sessions[email] = await p.context().cookies();
}
async function actAs(email) {
  await ctx.clearCookies();
  await ctx.addCookies(sessions[email]);
}

await page.goto(BASE + "/admin");
ok("a signed-out visitor is sent to sign-in", page.url().includes("/login?next=%2Fadmin"));

// The public site: every page opens without an account, and Portal login leads to sign-in
const publicRoutes = ["/", "/programs", "/programs/fix-flip", "/programs/dscr", "/programs/bridge", "/programs/construction", "/programs/portfolio", "/about", "/resources", "/resources/first-investment", "/resources/leverage", "/resources/dscr-explained", "/resources/draws", "/resources/interest-only", "/calculators", "/start", "/disclosures"];
const statuses = await Promise.all(publicRoutes.map(async (r) => [r, (await fetch(BASE + r, { redirect: "manual" })).status]));
const broken = statuses.filter(([, status]) => status !== 200);
ok(`all ${publicRoutes.length} public pages open without an account${broken.length ? ` (${broken.join("; ")})` : ""}`, broken.length === 0);
ok("an unknown program page is a 404", (await fetch(BASE + "/programs/nope")).status === 404);

await page.goto(BASE + "/");
ok("the landing page is the main page", (await page.locator("h1").innerText()).includes("A considered"));
ok("the hero photo loads", await page.locator(".hero-visual img").evaluate((img) => img.complete && img.naturalWidth > 0));
await shot(page, "00-landing-page.png");
const links = [...new Set(await page.locator("a[href^='/']").evaluateAll((items) => items.map((a) => a.getAttribute("href"))))];
const deadLinks = (await Promise.all(links.map(async (href) => [href, (await fetch(BASE + href, { redirect: "manual" })).status]))).filter(([, status]) => status !== 200);
ok(`every link on the landing page works${deadLinks.length ? ` (${deadLinks.join("; ")})` : ""}`, deadLinks.length === 0);
await page.getByTestId("portal-login").click();
await page.waitForURL("**/login");
ok("Portal login opens the sign-in page", new URL(page.url()).pathname === "/login");
await page.goto(BASE + "/portal/team");
ok("the old portal address leads to sign-in", new URL(page.url()).pathname === "/login");

await page.goto(BASE + "/calculators");
ok("the rental calculator shows the example result", (await page.getByTestId("calc-result").innerText()) === "1.31×");
await page.getByTestId("calc-rent").fill("3500");
ok("the rental calculator updates live", (await page.getByTestId("calc-result").innerText()) === "1.53×");
await page.getByTestId("calc-tab-flip").click();
ok("the flip calculator shows the example margin", (await page.getByTestId("calc-result").innerText()) === "$40,800");
await page.getByTestId("calc-tab-leverage").click();
ok("the leverage calculator takes the lower cap", (await page.getByTestId("calc-result").innerText()) === "$262,500");
await page.getByTestId("calc-value").fill("");
ok("an empty calculator input shows an error instead of a number", (await page.getByRole("alert").filter({ hasText: "non-negative" }).count()) === 1);

await page.goto(BASE + "/start");
await page.getByLabel("Property city").fill("Dallas");
await page.getByLabel("Property state").fill("TX");
await page.getByLabel("Purchase price or current value ($)").fill("300000");
await page.getByLabel("Requested loan amount ($)").fill("240000");
await page.getByLabel("Exit strategy & project notes").fill("Renovate and sell.");
await page.getByRole("button", { name: "Prepare my brief" }).click();
const brief = await page.getByTestId("deal-brief").innerText();
ok("the deal brief is prepared in the browser", brief.includes("Program: Fix & flip") && brief.includes("Property city: Dallas") && brief.includes("Not submitted to LendHous"));

await page.evaluate(() => localStorage.setItem("lendhous-theme", "dark"));
await page.goto(BASE + "/");
ok("the public site stays light when the portal is set to dark", await page.locator(".site").evaluate((site) => document.documentElement.classList.contains("dark") && getComputedStyle(site).backgroundColor === "rgb(250, 251, 248)"));
await page.evaluate(() => localStorage.setItem("lendhous-theme", "light"));

// 1. Borrower seat: application wizard with live estimate
await signIn(page, SEATS.borrower);
ok("the borrower seat lands on My loans", new URL(page.url()).pathname === "/admin/borrower");
ok("no prototype banner or view switcher", !(await page.locator("body").innerText()).includes("CLICKABLE PROTOTYPE") && (await page.getByText("View as").count()) === 0);
ok("the demo seat is marked as a demo account", await page.getByTestId("demo-account").isVisible());
await page.goto(BASE + "/admin");
ok("the borrower seat can't open the staff pipeline", new URL(page.url()).pathname === "/admin/borrower");

await page.goto(BASE + "/admin/apply");
await page.getByTestId("next").click(); // -> property
await page.getByTestId("next").click(); // -> deal numbers
const before = await page.getByTestId("est-loan").innerText();
await page.getByTestId("rehab").fill("60000");
await page.waitForTimeout(200);
const after = await page.getByTestId("est-loan").innerText();
ok(`live estimate shows $340,000 for the Spec worked example (got ${before})`, before.includes("340,000"));
ok(`estimate updates live when rehab changes (${before} → ${after}; expect $306,000 = 85% LTC of $360k)`, after.includes("306,000"));
await page.getByTestId("rehab").fill("100000");
await shot(page, "01-borrower-application-live-estimate.png");

// owner-occupied hard stop
await page.goto(BASE + "/admin/apply");
await page.getByTestId("next").click();
await page.getByText("I or a family member will live here").click();
ok("owner-occupied shows hard stop", await page.getByTestId("owner-occ-stop").isVisible());
ok("owner-occupied blocks Continue", await page.getByTestId("next").isDisabled());

// complete + submit an application
await page.goto(BASE + "/admin/apply");
for (let i = 0; i < 5; i++) await page.getByTestId("next").click();
for (const c of ["bp", "noo", "consent"]) await page.getByTestId(`cert-${c}`).check();
await page.getByTestId("submit").click();
await page.waitForURL("**/borrower");
ok("submitted application appears on borrower dashboard", (await page.getByTestId("borrower-loan-card").count()) >= 3);
const newLoan = (await page.getByTestId("borrower-loan-card").first().innerText()).match(/LH-DEMO-\d+/)?.[0];

// 2. Borrower dashboard + doc upload
await shot(page, "02-borrower-dashboard.png");
await page.goto(BASE + "/admin/borrower/d1");
const fileInput = page.getByTestId("file-input");
await page.getByTestId("doc-bank").getByRole("button", { name: "Upload" }).click().catch(() => {});
await fileInput.setInputFiles({ name: "FAKE-bank-statement-sep-2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") });
await page.waitForTimeout(250);
ok("document upload changes status to Uploaded", (await page.getByTestId("doc-bank").innerText()).includes("Uploaded"));
await shot(page, "03-borrower-loan-document-center.png");

// 3. Staff seat: pipeline
await signIn(page, SEATS.staff);
ok("the staff seat lands on the pipeline", new URL(page.url()).pathname === "/admin");
await page.goto(BASE + "/login");
ok("Portal login takes someone already signed in straight to the panel", new URL(page.url()).pathname === "/admin");
// the saved demo book loads after the first render, so wait for the row rather than reading the table at once
ok(`the staff seat sees the borrower's new application (${newLoan})`, !!newLoan && (await page.getByTestId("pipeline-table").getByText(newLoan).waitFor({ timeout: 5000 }).then(() => true, () => false)));
await shot(page, "04-admin-pipeline-scoring.png");
// 4. Deal workspace numbers & ratios
await page.goto(BASE + "/admin/deals/d1");
ok("deal d1 LTC pill shows 85.0%", (await page.getByTestId("ratio-LTC").innerText()).includes("85.0%"));
await shot(page, "05-admin-deal-ratios.png");
// 5. Capital routing: send a teaser to the demo partner seat's organization, partner bids, staff accepts
await page.getByTestId("tab-Capital Routing").click();
const rec = await page.getByTestId("route-rec").innerText();
ok(`routing recommendation shown (${rec.split("\n")[0]})`, rec.length > 0);
await page.getByText("Demo Partner Capital A (FAKE)").locator("xpath=ancestor::li").locator("input[type=checkbox]").check();
await page.getByTestId("send-teaser").click();
await page.getByTestId("route-split").click();
await shot(page, "06-admin-capital-routing.png");

await signIn(page, SEATS.partner);
ok("the partner seat lands on its deal feed", new URL(page.url()).pathname === "/admin/partner");
ok("the partner sees the teaser", (await page.getByTestId("teaser-card").count()) >= 1);
const feedText = await page.locator("main").innerText();
ok("teaser hides street address and borrower name", !feedText.includes("123 Example St") && !feedText.includes("Alex Sample"));
await shot(page, "07-partner-deal-feed.png");
await page.goto(BASE + "/admin/partner/teasers/d1");
await page.getByTestId("place-bid").click();
ok("bid recorded", await page.getByTestId("my-bid").isVisible());

await actAs(SEATS.staff);
await page.goto(BASE + "/admin/deals/d1");
await page.getByTestId("tab-Capital Routing").click();
await page.getByTestId("accept-bid").first().click();
await page.waitForTimeout(200);
ok("bid accepted", (await page.locator("main").innerText()).includes("accepted"));

await actAs(SEATS.partner);
await page.goto(BASE + "/admin/partner/teasers/d1");
ok("deal room unlocks for the winning partner", await page.getByTestId("deal-room-open").isVisible());
await shot(page, "08-partner-deal-room-unlocked.png");

// 6. A non-demo account in the same browser sees none of the demo data saved there
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
await prisma.user.deleteMany({ where: { email: NON_DEMO } });
const nora = await prisma.user.create({ data: { email: NON_DEMO, name: "Nora Nondemo", passwordHash: await bcrypt.hash(PASSWORD, 10), accountStatus: "APPROVED", roles: { create: [{ role: "UNDERWRITER" }] } } });
try {
  await signIn(page, NON_DEMO);
  const pipeline = await page.locator("main").innerText();
  ok("a non-demo staff account sees an empty pipeline", pipeline.includes("No loans in the pipeline yet.") && !pipeline.includes("LH-DEMO"));
  ok("a non-demo account isn't marked as demo and can't reset demo data", (await page.getByTestId("demo-account").count()) === 0 && (await page.getByText("Reset demo data").count()) === 0);
  await page.goto(BASE + "/admin/capital");
  ok("a non-demo account sees no demo capital sources", (await page.locator("main").innerText()).includes("No capital sources yet."));
  await page.goto(BASE + "/admin/deals/d1");
  ok("a non-demo account can't open a demo deal", (await page.locator("main").innerText()).includes("Deal not found"));
} finally {
  await prisma.serverSession.deleteMany({ where: { userId: nora.id } });
  await prisma.rateWindow.deleteMany({ where: { key: { contains: NON_DEMO } } });
  await prisma.user.delete({ where: { id: nora.id } });
  await prisma.$disconnect();
}

// mobile view
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.addCookies(sessions[SEATS.borrower]);
const mp = await m.newPage();
await mp.goto(BASE + "/admin/apply");
await mp.getByTestId("next").click(); await mp.getByTestId("next").click();
await mp.waitForTimeout(300);
await shot(mp, "09-mobile-application.png", false);

// cold load of every route in a fresh browser, as the seat that owns it: catches hydration mismatches that
// client-side navigation hides
const routes = [["/", null], ["/calculators", null], ["/start", null], ["/resources", null], ["/admin/apply", SEATS.borrower], ["/admin/borrower", SEATS.borrower], ["/admin/borrower/d2", SEATS.borrower], ["/admin", SEATS.staff], ["/admin/deals/d1", SEATS.staff], ["/admin/capital", SEATS.staff], ["/admin/partner", SEATS.partner], ["/admin/partner/teasers/d3", SEATS.partner]];
for (const [r, seat] of routes) {
  const c = await browser.newContext(); if (seat) await c.addCookies(sessions[seat]); const p = await c.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (msg) => { if (msg.type() === "error") errs.push(msg.text()); });
  await p.goto(BASE + r, { waitUntil: "networkidle" }); await p.waitForTimeout(300);
  ok(`cold load ${r} has no errors${errs.length ? ` (${errs[0].slice(0, 40)}…)` : ""}`, errs.length === 0);
  await c.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/smoke-test-results.txt`, checks.join("\n") + "\n\nBrowser errors: " + (errors.length ? "\n" + errors.join("\n") : "none") + "\n");
console.log(checks.join("\n")); console.log("errors:", errors.length ? errors : "none");
if (errors.length || checks.some((c) => c.startsWith("FAIL"))) process.exitCode = 1;
