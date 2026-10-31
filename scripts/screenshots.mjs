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
const SEATS = { borrower: "alex.sample@lendhous.test", staff: "olivia.owner@lendhous.test", partner: "pia.partner@lendhous.test", buyer: "bella.buyer@lendhous.test", underwriter: "uma.underwriter@lendhous.test", broker: "bea.broker@lendhous.test" };
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
// The saved demo book loads just after the first render, so give it a moment before reading the figure.
const capitalNow = async () => {
  await page.goto(BASE + "/admin/capital");
  await page.waitForTimeout(300);
  return parseFloat((await page.getByTestId("capital-available").innerText()).replace(/[^0-9.]/g, ""));
};
await actAs(SEATS.staff);
await page.goto(BASE + "/admin");
ok("the pipeline doesn't show capital available or any GT label", !(await page.locator("main").innerText()).includes("available") && !/\bGT\b/.test(await page.locator("main").innerText()));
const capitalBefore = await capitalNow();
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
const capitalAfter = await capitalNow();
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

// 8. The loan from the borrower's side: accept the terms, budget the work, ask for a draw, get a payoff, send a message
const seen = (locator) => locator.waitFor({ timeout: 5000 }).then(() => true, () => false);
await signIn(page, SEATS.borrower);
await page.goto(BASE + "/admin/borrower/d18");
await seen(page.getByTestId("term-sheet"));
ok("the borrower sees the term sheet's numbers", (await page.getByTestId("term-sheet").innerText()).includes("Cash to close"));
ok("a term sheet can't be accepted without a name and agreement", await page.getByTestId("accept-term-sheet").isDisabled());
await page.getByTestId("term-sheet-name").fill("Alex Sample");
await page.getByTestId("term-sheet-agree").check();
await shot(page, "16-borrower-term-sheet.png");
await page.getByTestId("accept-term-sheet").click();
ok("the borrower accepts the term sheet online", (await seen(page.getByTestId("term-sheet-signed"))) && (await page.getByTestId("term-sheet-signed").innerText()).includes("Alex Sample"));

await page.goto(BASE + "/admin/borrower/d1");
await seen(page.getByTestId("scope-lines"));
await page.getByTestId("scope-demolition").fill("1");
ok("a scope of work that doesn't add up is refused", (await seen(page.getByTestId("scope-error"))) && (await page.getByTestId("save-scope").isDisabled()));
await page.getByTestId("scope-demolition").fill("6000");
await page.getByTestId("scope-summary").fill("Cosmetic rehab of a three-bed home.");
await page.getByTestId("save-scope").click();
ok("the borrower submits the scope of work", await seen(page.getByTestId("scope-saved")));
await page.getByTestId("message-text").fill("Is the appraisal back yet?");
await page.getByTestId("send-message").click();
ok("the borrower can message the team", await seen(page.getByTestId("loan-message").filter({ hasText: "Is the appraisal back yet?" })));

await page.goto(BASE + "/admin/borrower/d2");
await seen(page.getByTestId("request-draw"));
ok("the borrower sees the draw in progress", (await page.getByTestId("my-draw").count()) === 1);
await page.getByTestId("request-draw").click();
await page.getByTestId("draw-plumbing").fill("3000");
ok("a draw needs a contact and a certification", await page.getByTestId("submit-draw").isDisabled());
await page.getByTestId("draw-note").fill("Rough plumbing is finished.");
await page.getByTestId("draw-contact").fill("Alex Sample, (555) 010-0100");
await page.getByTestId("draw-photos").setInputFiles({ name: "rough-plumbing.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake") });
await page.getByTestId("draw-certify").check();
await shot(page, "17-borrower-request-draw.png");
await page.getByTestId("submit-draw").click();
ok("the borrower requests a draw against the budget", await page.getByTestId("my-draw").nth(1).waitFor({ timeout: 5000 }).then(() => true, () => false));
await page.getByTestId("payoff-date").fill("2026-11-15");
ok("the borrower sees a payoff figure", (await page.getByTestId("payoff-total").innerText()).startsWith("$"));
await page.getByTestId("request-payoff").click();
ok("the borrower requests a payoff statement", await seen(page.getByTestId("my-payoffs")));
ok("no dead draw button is left", (await page.getByText("coming soon").count()) === 0);

// 9. The same loans from the staff side: draws, servicing, moving a loan forward, and the conversation
await actAs(SEATS.staff);
await page.goto(BASE + "/admin/draws");
const draw = page.getByTestId("draw-card").filter({ hasText: "Cabinets are in" });
await seen(draw);
await shot(page, "18-admin-draws.png");
await draw.getByTestId("send-inspector").click();
await draw.getByTestId("observed-kitchen").fill("100");
ok("an inspection needs every line filled in", await draw.getByTestId("record-inspection").isDisabled());
await draw.getByTestId("observed-flooring").fill("100");
await draw.getByTestId("record-inspection").click();
await seen(draw.getByTestId("draw-review"));
ok(`the inspection decides the amount, not the request (${(await draw.getByTestId("draw-review").innerText()).split(" supported")[0]})`, (await draw.getByTestId("draw-review").innerText()).includes("of $20,000 requested"));
await draw.getByTestId("approve-draw").click();
await draw.getByTestId("release-draw").click();
ok("staff release an approved draw", await seen(page.getByTestId("closed-draw").first()));
const large = page.getByTestId("draw-card").filter({ hasText: "LH-DEMO-1012" });
ok("a large draw shows it needs two approvers", (await large.getByTestId("draw-review").innerText()).includes("Needs two approvers"));
await large.getByTestId("approve-draw").click();
ok("the second approver completes a large draw", (await seen(large.getByTestId("draw-approved"))) && (await large.getByTestId("draw-approved").innerText()).includes("Cam Capital"));
const behind = page.getByTestId("draw-card").filter({ hasText: "LH-DEMO-1013" });
await behind.getByTestId("send-inspector").click();
await behind.getByTestId("observed-bathrooms").fill("100");
await behind.getByTestId("record-inspection").click();
ok("nothing is released on a loan that is past due", (await seen(behind.getByTestId("draw-refusal"))) && (await behind.getByTestId("approve-draw").isDisabled()));

await page.goto(BASE + "/admin/servicing");
const lateLoan = page.getByTestId("serviced-loan").filter({ hasText: "LH-DEMO-1013" });
await seen(lateLoan);
await shot(page, "19-admin-servicing.png");
ok("servicing shows the late loan", (await lateLoan.innerText()).includes("2 past due"));
await lateLoan.getByTestId("record-payment").click();
ok("recording a payment clears the oldest late one", await seen(lateLoan.getByText("1 past due")));
const payoffRow = page.getByTestId("payoff-row").filter({ hasText: "LH-DEMO-1011" });
await payoffRow.getByTestId("send-payoff").click();
const capitalBeforePayoff = await capitalNow();
await page.goto(BASE + "/admin/servicing");
await page.getByTestId("payoff-row").filter({ hasText: "LH-DEMO-1011" }).getByTestId("mark-paid-off").click();
ok("a paid-off loan leaves servicing", await page.getByTestId("serviced-loan").filter({ hasText: "LH-DEMO-1011" }).waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false));
ok("a payoff frees capital", (await capitalNow()) > capitalBeforePayoff);

await page.goto(BASE + "/admin/deals/d18");
await seen(page.getByTestId("advance-loan"));
ok("the accepted term sheet moves the loan on", (await page.getByTestId("stage-panel").innerText()).includes("Conditions"));
await page.getByTestId("advance-loan").click();
ok("staff move a loan to its next stage", await seen(page.getByTestId("stage-blockers")));
ok("a loan with open documents can't clear to close", (await page.getByTestId("stage-blockers").innerText()).includes("still open") && (await page.getByTestId("advance-loan").isDisabled()));
await page.goto(BASE + "/admin/deals/d15");
await seen(page.getByTestId("approve-funding"));
ok("a loan can't fund on one person's say", await page.getByTestId("advance-loan").isDisabled());
await page.getByTestId("approve-funding").click();
ok("the same person can't approve funding twice", (await page.getByTestId("funding-approvers").waitFor({ timeout: 5000 }).then(() => true, () => false)) && (await page.getByTestId("approve-funding").count()) === 0 && (await page.getByTestId("advance-loan").isDisabled()));
await actAs(SEATS.underwriter);
await page.goto(BASE + "/admin/deals/d15");
await seen(page.getByTestId("approve-funding"));
await page.getByTestId("approve-funding").click();
await seen(page.getByTestId("funding-approvers").getByText("Uma Underwriter"));
await page.getByTestId("advance-loan").click();
await seen(page.getByTestId("advance-loan").getByText("Start servicing"));
ok("two different people fund a loan", (await page.getByTestId("advance-loan").innerText()) === "Start servicing");
await actAs(SEATS.staff);
await page.goto(BASE + "/admin/deals/d1");
await page.getByTestId("tab-Messages").click();
ok("the borrower's message reaches staff", await seen(page.getByTestId("loan-message").filter({ hasText: "Is the appraisal back yet?" })));
await page.getByTestId("tab-Documents").click();
ok("staff see the scope of work for review", (await page.getByTestId("scope-lines").count()) === 1 && (await page.locator("main").innerText()).includes("In review"));
await page.goto(BASE + "/admin/borrower/d2");
ok("a staff seat can't open the borrower's page", pathOf(page) === "/admin");

// The main panel's own tools, on the demo book
await page.goto(BASE + "/admin");
await seen(page.getByTestId("attention"));
ok("the pipeline lists what needs attention", (await page.getByTestId("attention-draws").innerText()).includes("Draws in progress"));
const pipelineFile = page.waitForEvent("download");
await page.getByTestId("export-pipeline").click();
ok("the pipeline exports to a spreadsheet", (await pipelineFile).suggestedFilename() === "lendhous-pipeline.csv");
await page.getByTestId("new-loan").click();
await page.waitForURL("**/admin/new-loan");
for (let i = 0; i < 4; i++) await page.getByTestId("next").click();
await page.getByTestId("client-name").fill("Staff Started (FAKE)");
await page.getByTestId("next").click();
for (const c of ["bp", "noo", "consent"]) await page.getByTestId(`cert-${c}`).check();
await page.getByTestId("submit").click();
await page.waitForURL("**/admin");
ok("staff start a loan from the pipeline", await seen(page.getByTestId("pipeline-table").getByText("Staff Started (FAKE)")));
await page.goto(BASE + "/admin/deals/d1");
await page.getByTestId("tab-Documents").click();
await page.getByTestId("request-doc-name").fill("Updated insurance binder");
await page.getByTestId("request-doc-send").click();
ok("staff can ask for another document", await seen(page.locator("main").getByText("Updated insurance binder")));
await page.getByTestId("tab-Messages").click();
await page.getByTestId("note-text").fill("Call the appraiser Monday.");
await page.getByTestId("send-note").click();
ok("staff can keep a note only the team sees", await seen(page.getByTestId("team-notes").getByText("Call the appraiser Monday.")));
await page.goto(BASE + "/admin/capital");
await seen(page.getByTestId("add-source"));
await page.getByTestId("add-source").click();
await page.getByTestId("source-name").fill("Second Fund (FAKE)");
await page.getByTestId("source-commitment").fill("1000000");
await page.getByTestId("save-source").click();
ok("staff can add a capital source", await seen(page.locator("main").getByText("Second Fund (FAKE)")));
await page.goto(BASE + "/admin/partners");
await seen(page.getByTestId("firm-row").first());
await shot(page, "22-admin-partners.png");
ok("staff see partners and buyers with what they buy", (await page.getByTestId("firm-row").count()) === 6);
await page.goto(BASE + "/admin/settings");
ok("the owner can open settings", (await page.getByTestId("settings-form").count()) === 1);
await page.getByTestId("setting-idle").fill("45");
await page.getByRole("button", { name: "Save settings" }).click();
await page.waitForURL("**notice=settings_saved");
ok("settings save", (await page.getByTestId("setting-idle").inputValue()) === "45");
await page.getByTestId("setting-idle").fill("30");
await page.getByRole("button", { name: "Save settings" }).click();
await page.waitForURL("**notice=settings_saved");
await actAs(SEATS.underwriter);
await page.goto(BASE + "/admin/settings");
ok("settings are closed to other roles", pathOf(page) === "/admin");
await actAs(SEATS.staff);

// 10. Broker seat: their own deals and fees, and a new deal for a client
await signIn(page, SEATS.broker);
ok("the broker seat lands on its deals", pathOf(page) === "/admin/broker");
await seen(page.getByTestId("broker-deal").first());
ok("the broker sees only their own deals", (await page.getByTestId("broker-deal").count()) === 3 && !(await page.locator("main").innerText()).includes("LH-DEMO-1001"));
ok("funding a loan earns the broker's fee", (await page.getByTestId("fees-earned").innerText()) !== "$0");
await shot(page, "20-broker-deals.png");
await page.goto(BASE + "/admin");
ok("the broker seat can't open the staff pipeline", pathOf(page) === "/admin/broker");
await page.goto(BASE + "/admin/broker/deals/d3");
await seen(page.getByTestId("loan-message").first());
ok("the broker sees the loan's conversation", (await page.getByTestId("loan-message").count()) === 2);
await page.goto(BASE + "/admin/broker/deals/d1");
ok("the broker can't open someone else's deal", (await page.locator("main").innerText()).includes("isn't one of yours"));
await page.goto(BASE + "/admin/broker/new");
for (let i = 0; i < 4; i++) await page.getByTestId("next").click();
await page.getByTestId("client-name").fill("Casey Client (FAKE)");
await page.getByTestId("client-points").fill("1.5");
await page.getByTestId("next").click();
for (const c of ["bp", "noo", "consent"]) await page.getByTestId(`cert-${c}`).check();
await page.getByTestId("submit").click();
await page.waitForURL("**/admin/broker");
ok("a broker submits a deal for a client", await seen(page.getByTestId("broker-deal").filter({ hasText: "Casey Client (FAKE)" })));
await actAs(SEATS.staff);
await page.goto(BASE + "/admin");
ok("the broker's deal reaches the pipeline", await seen(page.getByTestId("pipeline-table").getByText("Casey Client (FAKE)")));

// 11. Real records: the audit log, notifications, and a forgotten password
await page.goto(BASE + "/admin/audit");
ok("the owner can read the audit log", (await page.getByTestId("audit-row").count()) > 0);
await page.goto(BASE + "/admin/audit?q=member");
ok("the audit log filters by action", (await page.getByTestId("audit-row").count()) > 0 && (await page.getByTestId("audit-row").allInnerTexts()).every((row) => row.includes("member.")));
await page.goto(BASE + "/admin/account/notifications");
ok("the website brief shows in the owner's notifications", await seen(page.getByTestId("notice").filter({ hasText: "New project brief" }).first()));
const unreadBadge = page.getByRole("link", { name: /Notifications/ }).getByTestId("nav-count");
ok("the menu counts unread notifications", (await unreadBadge.count()) === 1);
await shot(page, "21-notifications.png");
await page.getByRole("button", { name: "Mark all as read" }).click();
ok("notifications can be marked read", await unreadBadge.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false));
await actAs(SEATS.underwriter);
await page.goto(BASE + "/admin/audit");
ok("the audit log is closed to other roles", pathOf(page) === "/admin");
const forgot = await browser.newContext();
const fg = await forgot.newPage();
await fg.goto(BASE + "/login");
await fg.getByTestId("forgot-password").click();
await fg.waitForURL("**/login/forgot");
await fg.getByTestId("forgot-email").fill(SEATS.broker);
await fg.getByRole("button", { name: "Send the link" }).click();
const known = await seen(fg.getByTestId("forgot-sent"));
const knownReply = await fg.getByTestId("forgot-sent").innerText();
const broker = await prisma.user.findUniqueOrThrow({ where: { email: SEATS.broker } });
ok("a forgotten password sends a link", known && (await prisma.passwordLink.count({ where: { userId: broker.id } })) === 1);
await fg.goto(BASE + "/login/forgot");
await fg.getByTestId("forgot-email").fill("nobody.here@example.org");
await fg.getByRole("button", { name: "Send the link" }).click();
await seen(fg.getByTestId("forgot-sent"));
ok("the reply doesn't reveal whether an account exists", (await fg.getByTestId("forgot-sent").innerText()) === knownReply);
await forgot.close();
await prisma.passwordLink.deleteMany({ where: { userId: broker.id } });
await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "forgot" } } });
const manifest = await fetch(BASE + "/manifest.webmanifest");
ok("the portal can be added to a phone's home screen", manifest.status === 200 && (await manifest.json()).display === "standalone");

// 12. A non-demo account in the same browser sees none of the demo data saved there
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
  ok("a non-demo account can load sample data", (await page.locator("main").innerText()).includes("LH-DEMO-1001") && (await page.getByTestId("attention").count()) === 1);
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
const routes = [["/", null], ["/calculators", null], ["/start", null], ["/resources", null], ["/admin/apply", SEATS.borrower], ["/admin/borrower", SEATS.borrower], ["/admin/borrower/d2", SEATS.borrower], ["/admin", SEATS.staff], ["/admin/deals/d1", SEATS.staff], ["/login/forgot", null], ["/admin/capital", SEATS.staff], ["/admin/loan-sales", SEATS.staff], ["/admin/draws", SEATS.staff], ["/admin/servicing", SEATS.staff], ["/admin/audit", SEATS.staff], ["/admin/account/notifications", SEATS.staff], ["/admin/borrower/d18", SEATS.borrower], ["/admin/broker", SEATS.broker], ["/admin/broker/new", SEATS.broker], ["/admin/broker/deals/d3", SEATS.broker], ["/admin/members", SEATS.staff], ["/admin/buyer", SEATS.buyer], ["/admin/buyer/loans/s-d10", SEATS.buyer], ["/admin/buyer/portfolio", SEATS.buyer], ["/admin/partner", SEATS.partner], ["/admin/partner/teasers/d3", SEATS.partner]];
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
