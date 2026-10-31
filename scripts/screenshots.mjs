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
const SEATS = { borrower: "alex.sample@lendhous.test", staff: "olivia.owner@lendhous.test", partner: "pia.partner@lendhous.test", buyer: "bella.buyer@lendhous.test", underwriter: "uma.underwriter@lendhous.test" };
const NON_DEMO = "nora.nondemo@example.org";
const INVITED = "ines.invited@example.org";
const INVITED_PASSWORD = "a-long-test-password";
const LEAD_NAME = "Smoke Test Lead";
const LEAD_EMAIL = "smoke.lead@example.org";
fs.mkdirSync(OUT, { recursive: true });
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
// A run that crashed part-way can leave its test brief behind, and briefs are rate limited per connection.
await prisma.lead.deleteMany({ where: { email: LEAD_EMAIL } });
await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "lead:" } } });
await prisma.user.deleteMany({ where: { email: INVITED } });
await prisma.rateWindow.deleteMany({ where: { key: { contains: INVITED } } });
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
ok("the landing page shows all five programs", (await page.getByTestId("home-program").count()) === 5);
ok("the quick check shows the lower cap", (await page.getByTestId("quick-result").innerText()) === "$262,500");
await page.getByTestId("quick-value").fill("500000");
ok("the quick check updates live", (await page.getByTestId("quick-result").innerText()) === "$285,000");
ok("search engines are kept out of the panel", (await (await fetch(BASE + "/robots.txt")).text()).includes("Disallow: /admin"));
ok("the sitemap lists the program pages", (await (await fetch(BASE + "/sitemap.xml")).text()).includes("/programs/fix-flip"));
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
await page.getByLabel("Your name").fill(LEAD_NAME);
await page.getByLabel("Email").fill(LEAD_EMAIL);
await page.getByLabel("Property city").fill("Dallas");
await page.getByLabel("Property state").fill("TX");
await page.getByLabel("Purchase price or current value ($)").fill("300000");
await page.getByLabel("Requested loan amount ($)").fill("240000");
await page.getByLabel("Exit strategy & project notes").fill("Renovate and sell.");
await page.getByRole("button", { name: "Send to LendHous" }).click();
const brief = await page.getByTestId("deal-brief").innerText();
ok("the deal brief goes to the team, with a copy to keep", brief.includes("The team has your project") && brief.includes("Program: Fix & flip") && brief.includes("Property: Dallas, TX") && (await page.getByRole("button", { name: "Download a copy" }).count()) === 1);

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
await page.goto(BASE + "/admin/leads");
ok("the borrower seat can't open the website leads", new URL(page.url()).pathname === "/admin/borrower");

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
await page.goto(BASE + "/admin/leads");
const inbox = page.getByTestId("leads-table").locator("tr", { hasText: LEAD_NAME });
ok("the website brief reaches the staff inbox", (await inbox.count()) === 1 && (await inbox.innerText()).includes("$240,000"));
await inbox.getByRole("button", { name: "Mark contacted" }).click();
ok("staff can mark a lead contacted", await inbox.getByText("Contacted").waitFor({ timeout: 5000 }).then(() => true, () => false));
await shot(page, "04b-admin-website-leads.png");
await page.goto(BASE + "/admin");
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

// 6. Loan buyer seat: browses blind loans, prices one and makes an offer; staff sell it; the file unlocks
const pathOf = (p) => new URL(p.url()).pathname;
await actAs(SEATS.staff);
await page.goto(BASE + "/admin");
ok("the headline card says what it means", (await page.locator("main").innerText()).includes("Capital available") && !/\bGT\b/.test(await page.locator("main").innerText()));
await page.waitForTimeout(300);
const capitalBefore = parseFloat((await page.getByTestId("capital-available").innerText()).replace(/[^0-9.]/g, ""));
await signIn(page, SEATS.buyer);
ok("the buyer seat lands on loans for sale", pathOf(page) === "/admin/buyer");
const market = await page.locator("main").innerText();
ok(`the buyer sees the loans for sale (${await page.getByTestId("loan-for-sale").count()})`, (await page.getByTestId("loan-for-sale").count()) === 5);
ok("the market hides street addresses and borrower names", !market.includes("410 Test Harbor Way") && !market.includes("Quinn Sample") && !market.includes("Quinn Flips"));
await shot(page, "10-buyer-loans-for-sale.png");
await page.goto(BASE + "/admin");
ok("the buyer seat can't open the staff pipeline", pathOf(page) === "/admin/buyer");
await page.goto(BASE + "/admin/members");
ok("the buyer seat can't open the members page", pathOf(page) === "/admin/buyer");
await page.goto(BASE + "/admin/partner");
ok("the buyer seat can't open the partner feed", pathOf(page) === "/admin/buyer");
await page.goto(BASE + "/admin/buyer/loans/s-d12");
ok("a loan with draws left warns the buyer", (await page.getByTestId("holdback-warning").innerText()).includes("$420,000"));
await page.goto(BASE + "/admin/buyer/loans/s-d9");
const yieldAtAsk = parseFloat(await page.getByTestId("price-yield").innerText());
await page.getByTestId("price-input").fill("96");
ok("pricing a loan shows the dollars", (await page.getByTestId("price-dollars").innerText()) === "$345,600");
ok("a lower price shows a higher yield", parseFloat(await page.getByTestId("price-yield").innerText()) > yieldAtAsk);
ok("the blind loan page hides the address", !(await page.locator("main").innerText()).includes("410 Test Harbor Way"));
await shot(page, "11-buyer-price-a-loan.png");
await page.getByTestId("send-offer").click();
ok("the offer is recorded", await page.getByTestId("my-offer").waitFor({ timeout: 5000 }).then(() => true, () => false));
await page.goto(BASE + "/admin/buyer/portfolio");
await page.getByTestId("my-offer-row").first().waitFor({ timeout: 5000 });
ok("the buyer's page shows the loan they own and their offers", (await page.getByTestId("owned-loan").count()) === 1 && (await page.getByTestId("my-offer-row").count()) === 2);
await shot(page, "12-buyer-portfolio.png");
await page.goto(BASE + "/admin/buyer/loans/s-d14");
ok("a loan the buyer owns shows its address and file", await page.getByTestId("file-open").waitFor({ timeout: 5000 }).then(() => true, () => false) && (await page.getByTestId("loan-heading").innerText()).includes("250 Sample Shore Dr"));

await actAs(SEATS.staff);
await page.goto(BASE + "/admin/loan-sales");
const sale = page.getByTestId("sale-row").filter({ hasText: "LH-DEMO-1009" });
await sale.getByTestId("offer-row").first().waitFor({ timeout: 5000 });
ok("the buyer's offer reaches staff", (await sale.getByTestId("offer-row").filter({ hasText: "96.00" }).count()) === 1);
await shot(page, "13-admin-loan-sales.png");
await sale.getByTestId("accept-offer").click();
ok("accepting an offer sells the loan", await page.getByTestId("sold-row").filter({ hasText: "LH-DEMO-1009" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
const ready = page.getByTestId("eligible-row").filter({ hasText: "LH-DEMO-1017" });
await ready.getByTestId("ask-input").fill("99");
await ready.getByTestId("list-loan").click();
ok("staff can list another funded loan", await page.getByTestId("sale-row").filter({ hasText: "LH-DEMO-1017" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
await page.goto(BASE + "/admin");
await page.waitForTimeout(300);
const capitalAfter = parseFloat((await page.getByTestId("capital-available").innerText()).replace(/[^0-9.]/g, ""));
ok(`selling a loan frees capital ($${capitalBefore}M to $${capitalAfter}M)`, capitalAfter > capitalBefore);
await actAs(SEATS.buyer);
await page.goto(BASE + "/admin/buyer/loans/s-d9");
ok("after the sale the buyer gets the address and file", await page.getByTestId("file-open").waitFor({ timeout: 5000 }).then(() => true, () => false) && (await page.getByTestId("loan-heading").innerText()).includes("410 Test Harbor Way"));
await page.goto(BASE + "/admin/buyer");
ok("the newly listed loan appears for the buyer", await page.getByTestId("loan-for-sale").filter({ hasText: "N-1017" }).waitFor({ timeout: 5000 }).then(() => true, () => false));

// 7. Members: the owner invites someone, who sets a password from the link and signs in; then changes and removes them
await signIn(page, SEATS.underwriter);
await page.goto(BASE + "/admin/members");
ok("a non-owner can't open the members page", pathOf(page) === "/admin");
ok("a non-owner has no Members link", (await page.getByRole("link", { name: "Members" }).count()) === 0);
await actAs(SEATS.staff);
await page.goto(BASE + "/admin/members");
ok("the owner sees every member", (await page.getByTestId("member-row").count()) === 9);
await shot(page, "14-admin-members.png");
await page.getByTestId("invite-member").click();
await page.getByTestId("member-name").fill("Ines Invited");
await page.getByTestId("member-email").fill(INVITED);
await page.getByTestId("role-PROCESSOR").click();
await page.getByTestId("role-LOAN_BUYER").click();
await page.getByRole("button", { name: "Send invitation" }).click();
const link = await page.getByTestId("issued-link").innerText();
ok("an invitation gives a one-time link", link.includes("/login/set-password?token="));
ok("the owner is told the address takes no mail here", (await page.getByTestId("issued-mail").innerText()).includes("Share this link"));
await page.getByRole("button", { name: "Done" }).click();
const invitedRow = page.getByTestId("member-row").filter({ hasText: INVITED });
ok("the invited person shows as invited", (await invitedRow.innerText()).includes("Invited") && (await invitedRow.innerText()).includes("Loan buyer"));

const outsider = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const op = await outsider.newPage();
const linkPath = BASE + new URL(link).pathname + new URL(link).search;
await op.goto(linkPath);
ok("the link names the account", (await op.getByTestId("password-email").innerText()) === INVITED);
await op.getByTestId("new-password").fill(INVITED_PASSWORD);
await op.getByTestId("confirm-password").fill("a-different-password");
await op.getByRole("button", { name: "Save password" }).click();
ok("two different passwords are refused", await op.getByRole("alert").filter({ hasText: "don't match" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
await op.getByTestId("new-password").fill(INVITED_PASSWORD);
await op.getByTestId("confirm-password").fill(INVITED_PASSWORD);
await op.getByRole("button", { name: "Save password" }).click();
await op.waitForURL("**/login?notice=password_set");
ok("setting a password leads to sign-in", (await op.locator("main").innerText()).includes("Your password is set"));
await op.goto(linkPath);
ok("the link works only once", await op.getByTestId("password-link-dead").isVisible());
await op.goto(BASE + "/login");
await op.getByTestId("login-email").fill(INVITED);
await op.getByTestId("login-password").fill(INVITED_PASSWORD);
await op.getByRole("button", { name: "Sign in" }).click();
await op.waitForURL("**/admin/buyer");
ok("the invited buyer signs in to the buyer workspace, empty until it has records", await op.getByTestId("no-buyer-org").isVisible());
await op.getByTestId("load-sample").click();
ok("a real buyer account can load sample loans", await op.getByTestId("loan-for-sale").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
await op.reload();
ok("sample data survives a reload", await op.getByTestId("loan-for-sale").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
await op.getByTestId("clear-sample").click();
ok("sample data clears with one click", await op.getByTestId("no-buyer-org").waitFor({ timeout: 5000 }).then(() => true, () => false));

await invitedRow.getByTestId("modify-member").click();
await page.getByTestId("member-title").fill("Note desk");
await page.getByTestId("perm-view_audit").click();
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByTestId("member-form").waitFor({ state: "detached", timeout: 5000 });
await invitedRow.getByText("Custom").waitFor({ timeout: 5000 });
ok("changing one person's access is saved and flagged", (await invitedRow.innerText()).includes("Note desk") && (await invitedRow.innerText()).includes("Custom"));
await invitedRow.getByTestId("remove-member").click();
await page.getByRole("button", { name: "Remove member" }).click();
ok("removing a member takes them off the list", await invitedRow.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false));
await op.goto(BASE + "/admin/buyer");
ok("a removed member's session ends at once", pathOf(op).startsWith("/login"));
await op.getByTestId("login-email").fill(INVITED);
await op.getByTestId("login-password").fill(INVITED_PASSWORD);
await op.getByRole("button", { name: "Sign in" }).click();
ok("a removed member can't sign in", await op.getByRole("alert").filter({ hasText: "don't match" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
await outsider.close();
ok("the owner can't remove their own account", await page.getByTestId("member-row").filter({ hasText: SEATS.staff }).getByTestId("remove-member").isDisabled());

// 8. A non-demo account in the same browser sees none of the demo data saved there
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
  await page.goto(BASE + "/admin");
  await page.getByTestId("load-sample").click();
  ok("a non-demo account can load sample data", (await page.locator("main").innerText()).includes("LH-DEMO-1001") && (await page.getByTestId("capital-available").innerText()) !== "—");
  ok("sample data is labeled as fake", (await page.getByTestId("sample-data-bar").innerText()).includes("FAKE"));
  await page.getByTestId("clear-sample").click();
  ok("clearing sample data empties the pipeline again", (await page.locator("main").innerText()).includes("No loans in the pipeline yet."));
} finally {
  await prisma.serverSession.deleteMany({ where: { userId: nora.id } });
  await prisma.rateWindow.deleteMany({ where: { key: { contains: NON_DEMO } } });
  await prisma.user.delete({ where: { id: nora.id } });
  await prisma.lead.deleteMany({ where: { email: LEAD_EMAIL } });
  await prisma.user.deleteMany({ where: { email: INVITED } });
  await prisma.rateWindow.deleteMany({ where: { key: { contains: INVITED } } });
  await prisma.$disconnect();
}

// mobile view
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.addCookies(sessions[SEATS.borrower]);
const mp = await m.newPage();
await mp.goto(BASE + "/");
ok("the phone header keeps the main action in view", await mp.locator(".nav-actions .button").isVisible());
await mp.getByTestId("site-menu").click();
await mp.getByTestId("mobile-portal-login").click();
ok("the phone menu reaches Portal login, then the panel", await mp.waitForURL("**/admin/borrower").then(() => true, () => false));
await mp.goto(BASE + "/admin/apply");
await mp.getByTestId("next").click(); await mp.getByTestId("next").click();
await mp.waitForTimeout(300);
await shot(mp, "09-mobile-application.png", false);
await m.close();

// The sheets and the menu open over the page, so the phone-check script doesn't see them.
const phone = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await phone.addCookies(sessions[SEATS.staff]);
const pp = await phone.newPage();
const fits = () => pp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll("[data-slot='sheet-content'] *")].every((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1));
await pp.goto(BASE + "/admin");
await pp.getByRole("button", { name: "Open navigation" }).click();
await pp.getByRole("link", { name: "Members" }).click();
await pp.waitForURL("**/admin/members");
ok("the phone menu reaches the members page", pathOf(pp) === "/admin/members");
await pp.getByTestId("invite-member").click();
await pp.getByTestId("member-name").waitFor();
ok("the invite sheet fits a phone", await fits());
await shot(pp, "15-mobile-invite-member.png", false);
await phone.close();

// cold load of every route in a fresh browser, as the seat that owns it: catches hydration mismatches that
// client-side navigation hides
const routes = [["/", null], ["/calculators", null], ["/start", null], ["/resources", null], ["/admin/apply", SEATS.borrower], ["/admin/borrower", SEATS.borrower], ["/admin/borrower/d2", SEATS.borrower], ["/admin", SEATS.staff], ["/admin/deals/d1", SEATS.staff], ["/admin/capital", SEATS.staff], ["/admin/loan-sales", SEATS.staff], ["/admin/members", SEATS.staff], ["/admin/buyer", SEATS.buyer], ["/admin/buyer/loans/s-d10", SEATS.buyer], ["/admin/buyer/portfolio", SEATS.buyer], ["/admin/partner", SEATS.partner], ["/admin/partner/teasers/d3", SEATS.partner]];
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
