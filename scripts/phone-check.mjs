// Phone layout check against a running server and a seeded database: on every page, at phone widths, nothing may stick
// out past the screen and nothing may scroll sideways. Usage: npm run build && npm start, then npm run phone:check
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const PASSWORD = "Lendhous2026!";
const WIDTHS = [320, 375, 430, 768];

const PUBLIC = ["/", "/programs", "/programs/fix-flip", "/programs/dscr", "/programs/bridge", "/programs/construction", "/programs/portfolio", "/about", "/resources", "/resources/first-investment", "/resources/leverage", "/resources/dscr-explained", "/resources/draws", "/resources/interest-only", "/calculators", "/start", "/disclosures", "/login"];
const SEATS = {
  "olivia.owner@lendhous.test": ["/admin", "/admin/deals/d1", "/admin/deals/d3", "/admin/deals/d4", "/admin/capital", "/admin/loan-sales", "/admin/leads", "/admin/members", "/admin/account/security"],
  "alex.sample@lendhous.test": ["/admin/borrower", "/admin/borrower/d1", "/admin/borrower/d2", "/admin/apply"],
  "pia.partner@lendhous.test": ["/admin/partner", "/admin/partner/teasers/d3"],
  "bella.buyer@lendhous.test": ["/admin/buyer", "/admin/buyer/loans/s-d9", "/admin/buyer/portfolio"],
};
// Tabs and steps that only render after a click.
const CLICKS = { "/admin/deals/d3": ["tab-Score & Flags", "tab-Capital Routing", "tab-Documents"] };

// Reads the page in the browser: anything past the right edge, and anything that scrolls sideways.
const measure = () => {
  const width = document.documentElement.clientWidth;
  const name = (el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${String(el.className.baseVal ?? el.className).split(/\s+/).slice(0, 3).join(".")} "${(el.innerText || "").trim().slice(0, 30).replace(/\n/g, " ")}"`;
  const hiddenByAncestor = (el) => el.closest("[aria-hidden='true'], .sr-only");
  const past = [];
  const scrollers = [];
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || hiddenByAncestor(el)) continue;
    if (box.right > width + 1 || box.left < -1) past.push(`${name(el)} right=${Math.round(box.right)}`);
    if (["auto", "scroll"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1) scrollers.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  return { docWidth: document.documentElement.scrollWidth, width, past: past.slice(0, 4), scrollers: scrollers.slice(0, 3) };
};

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const failures = [];
let pages = 0;

async function sweep(context, routes) {
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(150);
    const states = [[route, null], ...(CLICKS[route] ?? []).map((tab) => [`${route} ${tab}`, tab])];
    for (const [label, tab] of states) {
      if (tab) {
        await page.getByTestId(tab).click();
        await page.waitForTimeout(100);
      }
      const result = await page.evaluate(measure);
      pages += 1;
      if (result.docWidth > result.width + 1 || result.past.length || result.scrollers.length) failures.push(`${result.width}px ${label}\n    page width ${result.docWidth}\n    past the edge: ${result.past.join(" | ") || "none"}\n    scrolls sideways: ${result.scrollers.join(" | ") || "none"}`);
    }
  }
  await page.close();
}

for (const width of WIDTHS) {
  const options = { viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: true };
  const open = await browser.newContext(options);
  await sweep(open, PUBLIC);
  await open.close();
  for (const [email, routes] of Object.entries(SEATS)) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(BASE + "/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await page.close();
    await sweep(context, routes);
    await context.close();
  }
}
await browser.close();

// Each run signs in many times, which would trip the sign-in rate limit on the next run.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "login:" } } });
await prisma.$disconnect();

console.log(`Checked ${pages} page states at ${WIDTHS.join(", ")}px.`);
if (failures.length) {
  console.log(`FAIL ${failures.length} overflow:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("PASS nothing sticks out and nothing scrolls sideways");
