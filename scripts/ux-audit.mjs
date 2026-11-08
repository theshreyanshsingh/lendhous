// UI audit against a running server and a seeded database (npm run db:seed): every main page per role, at phone and
// desktop widths. Fails on text contrast under WCAG AA (1.4.3), controls, links or images with no name (4.1.2, 1.1.1),
// focusable elements inside aria-hidden, skipped heading levels or not exactly one h1 (1.3.1), duplicate ids and a missing
// lang. Targets under 24px (2.5.8) are listed as warnings: the spacing exception can't be judged from size alone.
// Usage: npm run build && npm start, then npm run ux:audit (server on :3000)
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const PASSWORD = "Lendhous2026!";
const PUBLIC = ["/", "/start", "/programs", "/rates", "/rewards", "/book", "/florida", "/florida/broward", "/programs/fix-flip", "/about", "/resources", "/resources/first-investment", "/calculators", "/payoff", "/disclosures", "/login", "/login/signup", "/login/forgot", "/apply/demo", "/verify/demo", "/embed/quote"];
const SEATS = {
  borrower: ["alex.sample@lendhous.test", ["/admin/borrower", "/admin/borrower/d1", "/admin/borrower/d2", "/admin/borrower/d18", "/admin/apply", "/admin/account/security"]],
  staff: ["olivia.owner@lendhous.test", ["/admin", "/admin/deals/d1", "/admin/deals/d2?tab=Documents", "/admin/deals/d13?tab=Servicing", "/admin/deals/d10?tab=Servicing", "/admin/leads", "/admin/servicing", "/admin/collections", "/admin/draws", "/admin/storms", "/admin/reports", "/admin/members", "/admin/settings", "/admin/pricing", "/admin/letters", "/admin/capital", "/admin/loan-sales", "/admin/new-loan"]],
  partner: ["pia.partner@lendhous.test", ["/admin/partner", "/admin/partner/portfolio", "/admin/partner/teasers/d3"]],
  buyer: ["bella.buyer@lendhous.test", ["/admin/buyer", "/admin/buyer/portfolio"]],
  broker: ["bea.broker@lendhous.test", ["/admin/broker", "/admin/broker/new", "/admin/broker/deals/d3"]],
};
const WIDTHS = [{ name: "phone", width: 390, height: 844, mobile: true }, { name: "desktop", width: 1440, height: 900, mobile: false }];

function audit() {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  // The colour behind an element: its ancestors' backgrounds stacked, or unknown under an image or gradient.
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none" && !style.backgroundImage.startsWith("url(\"data:image/svg")) return null;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) { layers.push(color); if (color.a >= 1) break; }
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) result = blend(layer, result);
    return result;
  };
  const visible = (el) => { const style = getComputedStyle(el); if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false; const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const hiddenAncestor = (el) => el.closest("[aria-hidden='true'], .sr-only, [hidden], .hp");
  const label = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""} "${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.value || "").trim().slice(0, 40).replace(/\s+/g, " ")}"`;
  const name = (el) => {
    const aria = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") && el.getAttribute("aria-labelledby").split(" ").map((id) => document.getElementById(id)?.innerText ?? "").join(" "));
    if (aria && aria.trim()) return aria.trim();
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      if (el.labels && [...el.labels].some((l) => l.innerText.trim())) return "label";
      if (el.getAttribute("title")) return el.getAttribute("title");
      if (el.type === "submit" || el.type === "button") return el.value;
      return "";
    }
    const text = (el.innerText || "").trim() || [...el.querySelectorAll("img[alt], svg[aria-label]")].map((i) => i.getAttribute("alt") || i.getAttribute("aria-label")).join(" ").trim();
    return text || el.getAttribute("title") || "";
  };
  const findings = { contrast: [], target: [], unnamed: [], noAlt: [], headings: [], dupIds: [], focusHidden: [], lang: [] };
  if (!document.documentElement.lang) findings.lang.push("html has no lang");
  // Contrast for elements with their own text.
  const seenText = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || hiddenAncestor(el) || ["SCRIPT", "STYLE", "SVG", "OPTION"].includes(el.tagName)) continue;
    // The wordmark is a logo, which WCAG exempts from contrast.
    if (el.closest("[aria-label='LendHous home'], .brand, .embed-brand")) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!own) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    const fg = parse(style.color);
    const bg = backdrop(el);
    if (!fg || !bg) continue;
    const fgBlended = blend(fg, bg);
    const ratio = (Math.max(lum(fgBlended), lum(bg)) + 0.05) / (Math.min(lum(fgBlended), lum(bg)) + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    // Disabled controls are exempt from contrast.
    if (ratio < need && !el.closest(":disabled, [aria-disabled='true']")) {
      const key = `${style.color}|${bg.r},${bg.g},${bg.b}|${Math.round(size)}`;
      if (!seenText.has(key)) { seenText.add(key); findings.contrast.push(`${ratio.toFixed(2)}:1 need ${need} · ${size}px ${style.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) · ${label(el)}`); }
    }
  }
  // Targets and names.
  const interactive = document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [tabindex]:not([tabindex='-1'])");
  for (const el of interactive) {
    if (!visible(el) || hiddenAncestor(el)) {
      if (el.closest("[aria-hidden='true']") && visible(el) && el.tabIndex >= 0 && !el.closest(".hp")) findings.focusHidden.push(label(el));
      continue;
    }
    if (el.type === "file" && getComputedStyle(el).display === "none") continue;
    if (!name(el)) findings.unnamed.push(label(el) + ` <${el.outerHTML.slice(0, 90)}>`);
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // Links inside running text are exempt from target size (WCAG 2.5.8 inline exception).
    const inline = el.tagName === "A" && style.display === "inline" && el.parentElement && (el.parentElement.innerText || "").trim().length > (el.innerText || "").trim().length + 3;
    if (inline || ["checkbox", "radio"].includes(el.type) && el.closest("label")) continue;
    if (box.width < 24 || box.height < 24) findings.target.push(`${Math.round(box.width)}x${Math.round(box.height)} ${label(el)}`);
  }
  for (const img of document.querySelectorAll("img")) if (visible(img) && !img.hasAttribute("alt")) findings.noAlt.push(img.src.slice(-60));
  for (const svg of document.querySelectorAll("main svg[role='img']")) if (!svg.getAttribute("aria-label") && !svg.querySelector("title")) findings.noAlt.push("svg role=img without a name");
  // Screen readers read visually hidden (sr-only) headings, so they count; aria-hidden or undisplayed ones don't.
  const heads = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => visible(h) && !h.closest("[aria-hidden='true'], [hidden]"));
  const h1s = heads.filter((h) => h.tagName === "H1");
  if (h1s.length !== 1) findings.headings.push(`${h1s.length} h1 (${h1s.map((h) => h.innerText.slice(0, 30)).join(" | ")})`);
  let last = 0;
  for (const h of heads) { const level = Number(h.tagName[1]); if (last && level > last + 1) findings.headings.push(`h${last} → h${level} "${h.innerText.slice(0, 40)}"`); last = level; }
  const ids = {};
  for (const el of document.querySelectorAll("[id]")) ids[el.id] = (ids[el.id] ?? 0) + 1;
  for (const [id, count] of Object.entries(ids)) if (count > 1) findings.dupIds.push(`${id} ×${count}`);
  for (const key of Object.keys(findings)) findings[key] = [...new Set(findings[key])];
  return findings;
}

const browser = await chromium.launch({ executablePath: CHROME });
const cookies = {};
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const [seat, [email]] of Object.entries(SEATS)) {
    await ctx.clearCookies();
    await page.goto(BASE + "/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    cookies[seat] = await ctx.cookies();
  }
  await ctx.close();
}
const report = {};
for (const size of WIDTHS) {
  const runs = [["public", PUBLIC], ...Object.entries(SEATS).map(([seat, [, pages]]) => [seat, pages])];
  for (const [seat, pages] of runs) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile });
    if (cookies[seat]) await ctx.addCookies(cookies[seat]);
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(500);
      if (await page.getByTestId("agents-prompt-later").isVisible().catch(() => false)) await page.getByTestId("agents-prompt-later").click();
      report[`${size.name} ${seat} ${path}`] = await page.evaluate(audit);
    }
    await ctx.close();
  }
}
await browser.close();
const FAIL = ["contrast", "unnamed", "noAlt", "focusHidden", "headings", "dupIds", "lang"];
const failures = [];
const warnings = new Map();
for (const [page, findings] of Object.entries(report)) {
  for (const key of FAIL) for (const item of findings[key]) failures.push(`${page} · ${key}: ${item}`);
  for (const item of findings.target) { const control = item.replace(/^\d+x\d+ /, ""); warnings.set(control, (warnings.get(control) ?? 0) + 1); }
}
console.log(`Audited ${Object.keys(report).length} page views (phone 390px and desktop 1440px).`);
if (warnings.size) console.log(`WARN ${warnings.size} controls under 24px somewhere (fine if spaced apart, WCAG 2.5.8):\n  ${[...warnings].slice(0, 15).map(([control, count]) => `${control} (${count})`).join("\n  ")}`);
if (failures.length) { console.log(`FAIL ${failures.length}:\n  ${failures.slice(0, 40).join("\n  ")}`); process.exitCode = 1; }
else console.log("PASS contrast, names, focus, headings, ids and language");
