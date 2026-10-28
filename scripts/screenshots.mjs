// Headless smoke test + screenshots. Usage: node scripts/screenshots.mjs (server on :3000)
import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screenshots";
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
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

// 1. Borrower application wizard with live estimate
await page.goto(BASE + "/apply");
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
await page.goto(BASE + "/apply");
await page.getByTestId("next").click();
await page.getByText("I or a family member will live here").click();
ok("owner-occupied shows hard stop", await page.getByTestId("owner-occ-stop").isVisible());
ok("owner-occupied blocks Continue", await page.getByTestId("next").isDisabled());

// complete + submit an application
await page.goto(BASE + "/apply");
for (let i = 0; i < 5; i++) await page.getByTestId("next").click();
for (const c of ["bp", "noo", "consent"]) await page.getByTestId(`cert-${c}`).check();
await page.getByTestId("submit").click();
await page.waitForURL("**/borrower");
ok("submitted application appears on borrower dashboard", (await page.getByTestId("borrower-loan-card").count()) >= 3);

// 2. Borrower dashboard + doc upload
await shot(page, "02-borrower-dashboard.png");
await page.goto(BASE + "/borrower/d1");
const fileInput = page.getByTestId("file-input");
await page.getByTestId("doc-bank").getByRole("button", { name: "Upload" }).click().catch(() => {});
await fileInput.setInputFiles({ name: "FAKE-bank-statement-sep-2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") });
await page.waitForTimeout(250);
ok("document upload changes status to Uploaded", (await page.getByTestId("doc-bank").innerText()).includes("Uploaded"));
await shot(page, "03-borrower-loan-document-center.png");

// 3. Admin pipeline
await page.getByTestId("role-switcher").selectOption("admin");
await page.waitForURL("**/admin");
await shot(page, "04-admin-pipeline-scoring.png");
// 4. Deal workspace numbers & ratios
await page.goto(BASE + "/admin/deals/d1");
ok("deal d1 LTC pill shows 85.0%", (await page.getByTestId("ratio-LTC").innerText()).includes("85.0%"));
await shot(page, "05-admin-deal-ratios.png");
// 5. Capital routing: send teaser to Fund B, partner bids, admin accepts
await page.getByTestId("tab-Capital Routing").click();
const rec = await page.getByTestId("route-rec").innerText();
ok(`routing recommendation shown (${rec.split("\n")[0]})`, rec.length > 0);
await page.getByText("Sample Bridge Fund B (FAKE)").locator("xpath=ancestor::li").locator("input[type=checkbox]").check();
await page.getByTestId("send-teaser").click();
await page.getByTestId("route-split").click();
await shot(page, "06-admin-capital-routing.png");

await page.getByTestId("role-switcher").selectOption("partner");
await page.waitForURL("**/partner");
await page.locator("select").nth(1).selectOption("p-b");
await page.waitForTimeout(200);
ok("partner B sees the teaser", (await page.getByTestId("teaser-card").count()) >= 1);
const feedText = await page.locator("main").innerText();
ok("teaser hides street address and borrower name", !feedText.includes("123 Example St") && !feedText.includes("Alex Sample"));
await shot(page, "07-partner-deal-feed.png");
await page.getByTestId("teaser-card").first().click();
await page.getByTestId("place-bid").click();
ok("bid recorded", await page.getByTestId("my-bid").isVisible());

await page.getByTestId("role-switcher").selectOption("admin");
await page.goto(BASE + "/admin/deals/d1");
await page.getByTestId("tab-Capital Routing").click();
await page.getByTestId("accept-bid").first().click();
await page.waitForTimeout(200);
ok("bid accepted", (await page.locator("main").innerText()).includes("accepted"));

await page.getByTestId("role-switcher").selectOption("partner");
await page.goto(BASE + "/partner/teasers/d1");
ok("deal room unlocks for the winning partner", await page.getByTestId("deal-room-open").isVisible());
await shot(page, "08-partner-deal-room-unlocked.png");

// NDA gate
await page.locator("select").nth(1).selectOption("p-d");
await page.goto(BASE + "/partner");
ok("unsigned partner sees NDA gate, no teasers", await page.getByTestId("nda-gate").isVisible());

// mobile view
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(BASE + "/apply");
await mp.getByTestId("next").click(); await mp.getByTestId("next").click();
await mp.waitForTimeout(300);
await shot(mp, "09-mobile-application.png", false);

// a cold load must show the URL's role even when localStorage saved another one
await page.goto(BASE + "/borrower/d2"); await page.waitForTimeout(300);
ok("cold load /borrower/d2 shows the borrower view despite a saved partner role", (await page.getByTestId("role-switcher").inputValue()) === "borrower");

// cold load of every route in a fresh browser: catches hydration mismatches that client-side navigation hides
for (const r of ["/", "/apply", "/borrower", "/borrower/d2", "/admin", "/admin/deals/d1", "/admin/capital", "/partner", "/partner/teasers/d3"]) {
  const c = await browser.newContext(); const p = await c.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (msg) => { if (msg.type() === "error") errs.push(msg.text()); });
  await p.goto(BASE + r, { waitUntil: "networkidle" }); await p.waitForTimeout(300);
  ok(`cold load ${r} has no errors${errs.length ? ` (${errs[0].slice(0, 40)}…)` : ""}`, errs.length === 0);
  await c.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/smoke-test-results.txt`, checks.join("\n") + "\n\nBrowser errors: " + (errors.length ? "\n" + errors.join("\n") : "none") + "\n");
console.log(checks.join("\n")); console.log("errors:", errors.length ? errors : "none");
if (errors.length || checks.some((c) => c.startsWith("FAIL"))) process.exitCode = 1;
