// A loan's whole life with real accounts, each in its own browser, so nothing can pass by sharing browser storage:
// sign-up to funding, documents, draws, payoff, a partner bid, a loan sale and a broker deal, checking what each person
// can and can't see. It wipes the loan book when it starts and ends, so it refuses anything but a local database.
// Usage: npm run db:seed && npm run build && npm start, then npm run smoke:real
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { chromium } from "playwright-core";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.BASE_URL || "http://localhost:3000";
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "")) throw new Error("This script wipes the loan book. It only runs against a local database.");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const PASSWORD = "a-long-real-smoke-password";
const DOMAIN = "real-smoke.example.org";
const checks = [];
const ok = (name, cond) => checks.push(`${cond ? "PASS" : "FAIL"} ${name}`);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const wipe = async () => {
  await prisma.bookRecord.deleteMany();
  await prisma.bookVersion.deleteMany();
  await prisma.document.deleteMany({ where: { ownerType: "LOAN" } });
  await prisma.lead.deleteMany();
  await prisma.photoLink.deleteMany();
  await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "lead:" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.rateWindow.deleteMany({ where: { key: { contains: DOMAIN } } });
  await prisma.platformSettings.update({ where: { id: "default" }, data: { offerSampleData: true } });
};
await wipe();

const passwordHash = await bcrypt.hash(PASSWORD, 10);
const account = (local, name, role) => prisma.user.create({ data: { email: `${local}@${DOMAIN}`, name, passwordHash, accountStatus: "APPROVED", roles: { create: [{ role }] } } });
await account("owner", "Owen Owner", "ADMIN_OWNER");
await account("under", "Ursula Under", "UNDERWRITER");
await account("borrower", "Bonnie Borrower", "BORROWER");
await account("other", "Oscar Other", "BORROWER");
await account("broker", "Brook Broker", "BROKER");
await account("partner", "Parker Partner", "PARTNER_LENDER");
await account("buyer", "Blair Buyer", "LOAN_BUYER");
const lead = await prisma.lead.create({ data: { name: "Lena Lead", email: `lena@${DOMAIN}`, strategy: "Fix & flip", city: "Miami", state: "FL", propertyValueCents: 40_000_000, renovationCents: 8_000_000, requestedLoanCents: 34_000_000, notes: "Wants to start next month." } });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];
const person = async (local) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${local}: ${error.message}`));
  await page.goto(`${BASE}/login`);
  await page.getByTestId("login-email").fill(`${local}@${DOMAIN}`);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
};
const seen = (locator, timeout = 8000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
const gone = (locator) => locator.first().waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
const path = (page) => new URL(page.url()).pathname;
// What actually reached this person's browser, including data the screen doesn't show.
const received = (page) => page.content();
const go = (page, route) => page.goto(BASE + route, { waitUntil: "networkidle" });
// Every credit question has to be answered on its own.
const QUESTIONS = ["bankruptcy", "foreclosure", "delinquent", "judgments", "lawsuit", "felony", "borrowedDownPayment"];
const answerAll = async (page, yes = []) => { for (const key of QUESTIONS) await page.getByTestId(`decl-${key}-${yes.includes(key) ? "yes" : "no"}`).click(); };
// Three megabytes, like a real scan: well past the 1 MB a server action takes unless it's told otherwise.
const PDF = { name: "bank-statement.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4 real smoke test file\n"), Buffer.alloc(3 * 1024 * 1024, 32)]) };
// What's on disk under a stored file's key.
const STORED = (key) => readFileSync(join(process.cwd(), "storage", "uploads", key));
const rawRows = async (collection) => JSON.stringify((await prisma.$runCommandRaw({ find: collection, filter: {} })).cursor.firstBatch);

try {
  const owner = await person("owner");
  const under = await person("under");
  const borrower = await person("borrower");
  const other = await person("other");
  const broker = await person("broker");
  const partner = await person("partner");
  const buyer = await person("buyer");

  // A brief from the public site, as a visitor sends it
  const visitorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await visitorContext.newPage();
  visitor.on("pageerror", (error) => errors.push(`visitor: ${error.message}`));
  await visitor.goto(`${BASE}/start`);
  await visitor.getByLabel("Your name").fill("Vera Visitor");
  await visitor.getByLabel("Email").fill(`vera@${DOMAIN}`);
  await visitor.getByLabel("Phone (optional)").fill("(555) 010-0300");
  await visitor.getByLabel("Property city").fill("Tampa");
  await visitor.getByLabel("Property state").fill("FL");
  await visitor.getByLabel("Purchase price or current value ($)").fill("300000");
  await visitor.getByLabel("Estimated renovation budget ($)").fill("60000");
  await visitor.getByLabel("Requested loan amount ($)").fill("270000");
  await visitor.getByLabel("Exit strategy & project notes").fill("Refinance into a rental next spring.");
  await visitor.getByRole("button", { name: "Send to LendHous" }).click();
  ok("a visitor can send a brief from a phone", await seen(visitor.getByTestId("deal-brief")));
  const leadRows = await rawRows("Lead");
  ok("the brief's contact details are encrypted in the database", !leadRows.includes("Vera Visitor") && !leadRows.includes(`vera@${DOMAIN}`) && !leadRows.includes("(555) 010-0300") && !leadRows.includes("Refinance into a rental") && leadRows.includes("enc1:"));
  ok("so is the alert saved for the team", !(await rawRows("Notification")).includes("Vera Visitor"));
  await go(owner, "/admin/account/notifications");
  ok("the owner gets the alert with the brief in it", await seen(owner.getByTestId("notice").filter({ hasText: "New project brief: Tampa, FL" }).filter({ hasText: "Vera Visitor" })));
  await go(owner, "/admin");
  ok("the pipeline says a brief is waiting", (await owner.getByTestId("attention-leads").innerText()).includes("Website briefs"));
  await go(owner, "/admin/leads");
  const veraRow = owner.getByTestId("leads-table").locator("tr", { hasText: "Vera Visitor" });
  ok("the brief reaches the leads inbox, readable", (await seen(veraRow)) && (await veraRow.innerText()).includes("Refinance into a rental") && (await veraRow.innerText()).includes("$270,000"));
  ok("staff can email the visitor from it", (await veraRow.getByRole("link", { name: `vera@${DOMAIN}` }).getAttribute("href")) === `mailto:vera@${DOMAIN}`);
  await veraRow.getByRole("button", { name: "Mark contacted" }).click();
  ok("staff can mark it contacted", await seen(veraRow.getByText("Contacted")));
  await go(borrower, "/admin/leads");
  ok("a borrower can't see the leads", !(await received(borrower)).includes("Vera Visitor"));
  await visitor.goto(`${BASE}/start`);
  await visitor.getByLabel("Your name").fill("Rob Robot");
  await visitor.getByLabel("Email").fill(`rob@${DOMAIN}`);
  await visitor.getByLabel("Property city").fill("Tampa");
  await visitor.getByLabel("Property state").fill("FL");
  await visitor.getByLabel("Purchase price or current value ($)").fill("300000");
  await visitor.getByLabel("Requested loan amount ($)").fill("270000");
  await visitor.getByLabel("Exit strategy & project notes").fill("Spam.");
  await visitor.locator("input[name=leave_blank]").evaluate((input) => { input.value = "http://spam.example"; });
  const before = await prisma.lead.count();
  await visitor.getByRole("button", { name: "Send to LendHous" }).click();
  await seen(visitor.getByTestId("deal-brief"));
  ok("a bot filling the hidden field gets a normal reply and nothing is kept", (await prisma.lead.count()) === before);
  await visitorContext.close();

  // An empty real account, then its first capital source
  await go(owner, "/admin");
  ok("a real owner starts with an empty pipeline", (await owner.locator("main").innerText()).includes("No loans in the pipeline yet."));
  await go(owner, "/admin/capital");
  await owner.getByTestId("add-source").click();
  await owner.getByTestId("source-name").fill("Real Fund I");
  await owner.getByTestId("source-commitment").fill("5000000");
  await owner.getByTestId("save-source").click();
  await seen(owner.locator("main").getByText("Real Fund I"));
  await go(owner, "/admin/capital");
  ok("a capital source is saved to the database", (await owner.locator("main").innerText()).includes("Real Fund I"));
  await go(under, "/admin/capital");
  ok("everyone on the team sees it", (await under.getByTestId("capital-available").innerText()) === "$5.00M");

  // A real borrower applies
  await go(borrower, "/admin/apply");
  await borrower.getByTestId("next").click();
  await borrower.getByLabel("Property address").fill("100 Real Street");
  await borrower.getByLabel("City").fill("Hollywood");
  await borrower.getByLabel("ZIP").fill("33020");
  for (let i = 0; i < 3; i++) await borrower.getByTestId("next").click();
  await borrower.getByTestId("guarantor-name-0").fill("Bonnie Borrower");
  await borrower.getByTestId("guarantor-fico-0").fill("745");
  await borrower.getByTestId("next").click();
  await borrower.getByTestId("add-deal").click();
  await borrower.getByTestId("deal-address-0").fill("9 Past Flip Lane");
  await borrower.getByTestId("deal-completed-0").fill("2026-02");
  await borrower.getByTestId("deal-price-0").fill("210000");
  await borrower.getByTestId("deal-sale-0").fill("315000");
  await borrower.getByTestId("next").click();
  await borrower.getByTestId("next").click();
  for (const c of ["bp", "noo", "consent", "true"]) await borrower.getByTestId(`cert-${c}`).check();
  const stillNeeded = await borrower.getByTestId("submit-missing").innerText();
  ok("a real application needs its details and every credit answer", stillNeeded.includes("borrowing entity") && stillNeeded.includes("every credit question") && (await borrower.getByTestId("submit").isDisabled()));
  ok("the review lists what will be asked for, including proof of the past deal", (await borrower.getByTestId("needs-preview").innerText()).includes("Settlement statements for your past deals"));
  await borrower.getByRole("button", { name: "Back" }).click();
  await answerAll(borrower, ["lawsuit"]);
  await borrower.getByTestId("next").click();
  ok("a yes needs an explanation", (await borrower.getByTestId("submit-missing").innerText()).includes("explanation"));
  await borrower.getByRole("button", { name: "Back" }).click();
  await borrower.getByTestId("decl-explanation").fill("A 2025 dispute with a contractor, settled in August.");
  for (let i = 0; i < 2; i++) await borrower.getByRole("button", { name: "Back" }).click();
  await borrower.getByLabel("Borrowing entity (LLC)").fill("Real Flips LLC");
  for (let i = 0; i < 3; i++) await borrower.getByTestId("next").click();
  await borrower.getByTestId("submit").click();
  await borrower.waitForURL("**/admin/borrower");
  ok("a real borrower can submit an application", await seen(borrower.getByTestId("borrower-loan-card")));
  await go(borrower, "/admin/borrower");
  ok("it's still there after a reload", (await borrower.getByTestId("borrower-loan-card").count()) === 1);
  await borrower.getByTestId("borrower-loan-card").click();
  ok("the needs list follows the application: proof of past deals and a letter for the yes", (await seen(borrower.getByTestId("doc-track"))) && (await seen(borrower.getByTestId("doc-explanation"))) && (await borrower.getByTestId("doc-good-standing").innerText()).includes("last 90 days"));

  await go(under, "/admin");
  const row = under.getByTestId("pipeline-table").locator("tr", { hasText: "Bonnie Borrower" });
  ok("it reaches the team in another browser", await seen(row));
  ok("it gets a real loan number", (await row.innerText()).includes("LH-1001"));
  ok("the pipeline flags it", (await under.getByTestId("attention-applications").innerText()).includes("New applications"));
  const dealHref = await row.getByRole("link").first().getAttribute("href");
  const dealId = dealHref.split("/").pop();
  await go(owner, "/admin/account/notifications");
  ok("the owner is told about it", await seen(owner.getByTestId("notice").filter({ hasText: "New application" })));
  await go(other, "/admin/borrower");
  ok("another borrower can't see it", (await other.getByTestId("borrower-loan-card").count()) === 0 && !(await received(other)).includes("Bonnie Borrower") && !(await received(other)).includes("100 Real Street"));
  await go(other, `/admin/borrower/${dealId}`);
  ok("another borrower can't open it by address", (await other.locator("main").innerText()).includes("Loan not found"));

  // A real document, stored and protected
  await go(borrower, `/admin/borrower/${dealId}`);
  const bank = borrower.getByTestId("doc-bank");
  await bank.getByRole("button", { name: "Upload" }).click();
  await borrower.getByTestId("file-input").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf") });
  ok("a file that isn't what it claims is refused", await seen(borrower.getByTestId("book-error").filter({ hasText: "do not match" })));
  await bank.getByRole("button", { name: "Upload" }).click();
  await borrower.getByTestId("file-input").setInputFiles(PDF);
  ok("a real document of 3 MB uploads", await seen(bank.getByTestId("doc-file")));
  const fileUrl = await bank.getByTestId("doc-file").getAttribute("href");
  const mine = await borrower.request.get(BASE + fileUrl);
  ok("the borrower can open their file", mine.status() === 200 && (await mine.text()).startsWith("%PDF"));
  const staffCopy = await under.request.get(BASE + fileUrl);
  ok("the team can open it", staffCopy.status() === 200);
  const bankFile = await prisma.document.findFirstOrThrow({ where: { ownerId: dealId, documentType: "bank" } });
  const bankBytes = STORED(bankFile.storageKey);
  ok("the file is encrypted on disk, and opens as the original", !bankBytes.includes(Buffer.from("%PDF")) && bankBytes.subarray(0, 6).toString() === "LHENC1" && (await staffCopy.body()).equals(PDF.buffer));
  ok("its name is encrypted too", !(await rawRows("Document")).includes("bank-statement"));
  const bookRows = await rawRows("BookRecord");
  ok("the loan book is encrypted in the database", !bookRows.includes("Bonnie Borrower") && !bookRows.includes("100 Real Street") && !bookRows.includes("Real Flips") && !bookRows.includes("bank-statement") && bookRows.includes("enc1:"));
  ok("another borrower can't", (await other.request.get(BASE + fileUrl)).status() === 404);
  ok("a partner can't", (await partner.request.get(BASE + fileUrl)).status() === 404);
  ok("nobody signed out can", (await (await browser.newContext()).request.get(BASE + fileUrl, { maxRedirects: 0 })).status() === 401);

  // Staff work the file
  await go(under, dealHref);
  await under.getByTestId("tab-Documents").click();
  await under.getByTestId("request-doc-name").fill("Flood certificate");
  await under.getByTestId("request-doc-send").click();
  await seen(under.locator("main").getByText("Flood certificate"));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("a requested document reaches the borrower", (await borrower.locator("main").innerText()).includes("Flood certificate"));
  await under.getByTestId("tab-Messages").click();
  await under.getByTestId("note-text").fill("Team only remark 7741");
  await under.getByTestId("send-note").click();
  await seen(under.getByTestId("team-notes").getByText("Team only remark 7741"));
  await under.getByTestId("message-text").fill("Welcome aboard");
  await under.getByTestId("send-message").click();
  await seen(under.getByTestId("loan-messages").getByText("Welcome aboard"));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower gets the team's message", (await borrower.getByTestId("loan-messages").innerText()).includes("Welcome aboard"));
  ok("a team note never reaches the borrower", !(await received(borrower)).includes("Team only remark 7741"));
  await go(borrower, "/admin/account/notifications");
  ok("the borrower is notified of the message", await seen(borrower.getByTestId("notice").filter({ hasText: "New message" })));

  await go(under, dealHref);
  for (const label of ["Start initial review", "Send to underwriting"]) {
    await under.getByTestId("advance-loan").filter({ hasText: label }).click();
    await gone(under.getByTestId("advance-loan").filter({ hasText: label }));
  }
  ok("a term sheet waits for the credit review", (await under.getByTestId("stage-blockers").innerText()).includes("Credit review isn't signed off") && (await under.getByTestId("advance-loan").isDisabled()));
  await under.getByTestId("tab-Credit review").click();
  const creditFlags = await under.getByTestId("credit-flags").innerText();
  ok("the credit review shows the yes and the unverified deal", creditFlags.includes("Party to a lawsuit") && creditFlags.includes("1 of 1 past deals not verified"));
  ok("with the explanation and the guarantor", (await under.getByTestId("declaration-answers").innerText()).includes("settled in August") && (await under.getByTestId("credit-review").innerText()).includes("Bonnie Borrower"));
  await under.locator("[data-testid^=verify-]").first().check();
  await seen(under.getByTestId("experience-effect").getByText("Signing off prices it on 1 verified"));
  await under.getByTestId("credit-note").fill("Settlement agreement reviewed 5521.");
  await under.getByTestId("sign-off-credit").click();
  ok("the underwriter signs off the credit review", await seen(under.getByTestId("credit-signed")));
  await under.getByTestId("advance-loan").filter({ hasText: "Issue term sheet" }).click();
  await gone(under.getByTestId("advance-loan").filter({ hasText: "Issue term sheet" }));
  ok("staff move the loan to a term sheet", await seen(under.getByTestId("stage-panel").getByText("Waiting for the borrower")));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the credit officer's notes never reach the borrower", !(await received(borrower)).includes("reviewed 5521"));
  await borrower.getByTestId("term-sheet-name").fill("Bonnie Borrower");
  await borrower.getByTestId("term-sheet-agree").check();
  await borrower.getByTestId("accept-term-sheet").click();
  ok("the borrower accepts it from their own browser", await seen(borrower.getByTestId("term-sheet-signed")));
  await go(under, dealHref);
  await under.getByTestId("advance-loan").filter({ hasText: "Start clearing conditions" }).click();
  ok("the loan can't clear to close yet", await seen(under.getByTestId("stage-blockers").getByText("still open")));

  // Documents, capital, closing
  await under.getByTestId("tab-Documents").click();
  await under.getByRole("button", { name: "Accept" }).first().click();
  for (const id of ["id", "entity", "ein", "contract", "sow", "insurance", "track"]) {
    const waive = under.getByTestId(`waive-${id}`);
    if (await waive.count()) await waive.click();
    await under.waitForTimeout(150);
  }
  const waives = under.locator("[data-testid^='waive-']");
  for (let left = await waives.count(); left > 0; left = await waives.count()) { await waives.first().click(); await under.waitForTimeout(150); }
  const reviews = under.getByRole("button", { name: "Accept" });
  for (let left = await reviews.count(); left > 0; left = await reviews.count()) { await reviews.first().click(); await under.waitForTimeout(150); }
  await under.getByTestId("tab-Capital Routing").click();
  await under.getByTestId("route-in_house").click();
  await under.getByTestId("apply-route").click();
  await seen(under.getByTestId("commit"));
  await under.getByTestId("commit").click();
  await gone(under.getByTestId("commit"));
  await under.getByTestId("advance-loan").filter({ hasText: "Mark clear to close" }).click();
  await under.getByTestId("advance-loan").filter({ hasText: "Send to closing" }).click();
  await seen(under.getByTestId("approve-funding"));
  ok("funding waits for approval", await under.getByTestId("advance-loan").isDisabled());
  await under.getByTestId("approve-funding").click();
  await seen(under.getByTestId("funding-approvers"));
  ok("one approver isn't enough", await under.getByTestId("advance-loan").isDisabled());
  await go(owner, dealHref);
  await owner.getByTestId("approve-funding").click();
  await owner.getByTestId("advance-loan").filter({ hasText: "Mark funded" }).click();
  await owner.getByTestId("advance-loan").filter({ hasText: "Start servicing" }).click();
  await gone(owner.getByTestId("stage-panel"));
  ok("a second person funds it and it moves to servicing", (await owner.getByTestId("stage-panel").count()) === 0);
  await go(owner, "/admin/capital");
  ok("funding uses the real capital", (await owner.getByTestId("capital-available").innerText()) !== "$5.00M");

  // Draws with a real photo
  await go(borrower, `/admin/borrower/${dealId}`);
  await borrower.getByTestId("request-draw").click();
  await borrower.getByTestId("draw-kitchen").fill("6000");
  await borrower.getByTestId("draw-note").fill("Cabinets are in.");
  await borrower.getByTestId("draw-contact").fill("Bonnie, (555) 010-0200");
  await borrower.getByTestId("draw-photos").setInputFiles({ name: "cabinets.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
  await borrower.getByTestId("draw-certify").check();
  await borrower.getByTestId("submit-draw").click();
  ok("the borrower requests a draw with a photo", await seen(borrower.getByTestId("my-draw")));
  await go(owner, "/admin/draws");
  const card = owner.getByTestId("draw-card").filter({ hasText: "Cabinets are in." });
  ok("the draw reaches the team", await seen(card));
  const photo = await card.getByTestId("draw-photos").getByRole("link").first().getAttribute("href");
  ok("the team can open the photo", (await owner.request.get(BASE + photo)).status() === 200);
  ok("another borrower can't open the photo", (await other.request.get(BASE + photo)).status() === 404);

  // A contractor sends photos through a link, with no account
  await card.getByTestId("ask-photos").click();
  await card.getByTestId("photo-to").fill("Carl Contractor");
  await card.getByTestId("photo-email").fill(`carl@${DOMAIN}`);
  await card.getByTestId("photo-send-link").click();
  ok("staff get a link to send", await seen(card.getByTestId("photo-issued")));
  const photoHref = await card.getByTestId("photo-link").inputValue();
  const photoPath = new URL(photoHref).pathname;
  const photoToken = photoPath.split("/").pop();
  ok("only the link's hash is stored", photoToken.length > 40 && !(await rawRows("PhotoLink")).includes(photoToken) && !(await rawRows("BookRecord")).includes(photoToken));
  ok("the link never lands in the saved notices", !(await rawRows("Notification")).includes(photoToken));
  ok("it shows on the draw", (await card.getByTestId("photo-request").innerText()).includes("Carl Contractor"));

  const carlContext = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 26.01, longitude: -80.15 }, permissions: ["geolocation"] });
  const carl = await carlContext.newPage();
  carl.on("pageerror", (error) => errors.push(`contractor: ${error.message}`));
  const carlResponse = await carl.goto(BASE + photoPath);
  ok("the link opens with no account", await seen(carl.getByTestId("photo-guide")));
  ok("it greets them and names the property", (await carl.locator("main").innerText()).includes("Hi Carl") && (await carl.locator("main").innerText()).includes("100 Real Street"));
  ok("the link can't leak or be indexed", carlResponse.headers()["referrer-policy"] === "no-referrer" && carlResponse.headers()["x-robots-tag"].includes("noindex") && carlResponse.headers()["cache-control"].includes("no-store"));
  const carlHtml = await received(carl);
  ok("no loan number, amount or borrower details reach them", !carlHtml.includes("LH-1001") && !carlHtml.includes("Real Flips") && !carlHtml.includes("Bonnie Borrower") && !carlHtml.includes("6,000") && !carlHtml.includes("6000"));
  ok("the guide covers the property and the draw's budget lines", (await carl.getByTestId("photo-outline").innerText()).includes("The property") && (await carl.getByTestId("photo-outline").innerText()).includes("Kitchen"));
  await carl.getByRole("button", { name: "Share location" }).click();
  ok("they can share their location", await seen(carl.getByTestId("photo-location-on")));
  // A camera-sized photo, made in the browser, because a real one has to survive being made smaller.
  const cameraPhoto = Buffer.from(await carl.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000; canvas.height = 3000;
    const context = canvas.getContext("2d");
    const image = context.createImageData(4000, 3000);
    for (let i = 0; i < image.data.length; i += 4) { const shade = Math.random() * 255; image.data[i] = shade; image.data[i + 1] = shade; image.data[i + 2] = shade; image.data[i + 3] = 255; }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  }), "base64");
  await carl.getByTestId("photo-start").click();
  await carl.getByTestId("shot-input-property-front").setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: cameraPhoto });
  ok(`a ${(cameraPhoto.length / 1048576).toFixed(1)} MB camera photo uploads`, await seen(carl.locator("[data-testid=photo-tile][data-state=sent]"), 30_000));
  await carl.getByTestId("photo-next").click();
  ok("the next step says what to photograph", (await carl.getByTestId("photo-step-kitchen").innerText()).includes("Cabinets and counters"));
  await carl.getByTestId("shot-input-kitchen-room").setInputFiles({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a picture at all") });
  ok("a file that isn't a photo is refused, with a way out", await seen(carl.locator("[data-testid=photo-tile][data-state=failed]")));
  await carl.locator("[data-testid=photo-tile][data-state=failed]").getByTestId("photo-remove").click();
  await gone(carl.locator("[data-testid=photo-tile]"));
  await carl.getByTestId("shot-input-kitchen-room").setInputFiles({ name: "IMG_0002.jpg", mimeType: "image/jpeg", buffer: cameraPhoto });
  await seen(carl.locator("[data-testid=photo-tile][data-state=sent]"), 30_000);
  await carl.getByTestId("shot-input-kitchen-cabinets").setInputFiles({ name: "IMG_0003.jpg", mimeType: "image/jpeg", buffer: cameraPhoto });
  await carl.waitForFunction(() => document.querySelectorAll("[data-testid=photo-tile][data-state=sent]").length === 2, null, { timeout: 30_000 });
  await carl.locator("[data-testid=shot-kitchen-cabinets]").getByTestId("photo-remove").click();
  await carl.waitForFunction(() => document.querySelectorAll("[data-testid=photo-tile]").length === 1);
  ok("a wrong photo can be taken back", (await carl.locator("[data-testid=shot-kitchen-cabinets] [data-testid=photo-tile]").count()) === 0);
  await carl.reload();
  await carl.getByTestId("photo-start").click();
  ok("coming back to the link shows what was already sent", (await carl.locator("[data-testid=photo-tile][data-state=sent]").count()) === 1 && (await carl.locator("[data-testid=photo-tile] img").evaluate((img) => img.decode().then(() => img.naturalWidth > 0))));
  await carl.getByTestId("photo-next").click();
  await carl.getByTestId("photo-next").click();
  ok("the last step lists what's missing", (await carl.getByTestId("photo-review").innerText()).includes("No photo yet: Cabinets and counters"));
  ok("sending waits for the confirmation", await carl.getByTestId("photo-send").isDisabled());
  await carl.getByTestId("photo-note").fill("Appliances arrive next week.");
  await carl.getByTestId("photo-confirm").check();
  await carl.getByTestId("photo-send").click();
  ok("the contractor is thanked", await seen(carl.getByTestId("photo-done")));

  const sentPhotos = await prisma.document.findMany({ where: { ownerId: dealId, documentType: "draw_photo", uploadedById: { isSet: false } }, orderBy: { createdAt: "asc" } });
  const live = sentPhotos.filter((row) => !row.deletedAt);
  ok("a camera photo is made smaller before it leaves the phone", live.length === 2 && live.every((row) => row.size < cameraPhoto.length && row.mime === "image/jpeg"));
  ok("the photos are encrypted on disk", live.every((row) => STORED(row.storageKey).subarray(0, 6).toString() === "LHENC1"));
  await go(owner, "/admin/account/notifications");
  ok("the team hears that photos came in", await seen(owner.getByTestId("notice").filter({ hasText: "Photos received" })));
  await go(borrower, "/admin/account/notifications");
  ok("so does the borrower", await seen(borrower.getByTestId("notice").filter({ hasText: "Photos received" })));
  await go(owner, "/admin/draws");
  const receivedRow = card.getByTestId("photo-request");
  ok("the photos appear on the draw, by budget line", (await receivedRow.innerText()).includes("2 photos received") && (await receivedRow.getByTestId("photo-group").count()) === 2);
  ok("with the contractor's note", (await receivedRow.getByTestId("photo-request-note").innerText()).includes("Appliances arrive next week."));
  ok("and what they didn't send", (await receivedRow.getByTestId("photo-missing").innerText()).includes("Kitchen, cabinets and counters"));
  ok("and where they were sent from", (await receivedRow.getByTestId("photo-place").first().getAttribute("href")).includes("26.01,-80.15"));
  const thumb = receivedRow.locator("img").first();
  ok("the thumbnails show the real photo", await thumb.evaluate((img) => img.decode().then(() => img.naturalWidth > 0)));
  mkdirSync("screenshots", { recursive: true });
  await card.screenshot({ path: "screenshots/19-real-draw-photos.png" });
  const thumbUrl = await thumb.getAttribute("src");
  const shownPhoto = await owner.request.get(BASE + thumbUrl);
  ok("it comes back as a picture, decrypted", shownPhoto.status() === 200 && shownPhoto.headers()["content-type"] === "image/jpeg" && (await shownPhoto.body()).subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));
  ok("another borrower can't open it", (await other.request.get(BASE + thumbUrl)).status() === 404);
  const photoId = thumbUrl.split("/").pop().split("?")[0];
  const opens = () => prisma.auditEvent.count({ where: { entityId: photoId, action: "document.opened" } });
  const opensBefore = await opens();
  await owner.request.get(`${BASE}/api/documents/${photoId}?view=inline`);
  ok("opening a photo is logged, but a thumbnail isn't", (await opens()) === opensBefore + 1);
  ok("the upload is in the audit log, with no account on it", (await prisma.auditEvent.findFirstOrThrow({ where: { entityId: photoId, action: "document.uploaded" } })).actorId === null);
  ok("the link holder can't open the borrower's other files", (await carl.request.get(`${BASE}/api/photo-links/${photoToken}/${bankFile.id}`)).status() === 404);
  ok("nor reach the staff route", (await carl.request.get(`${BASE}/api/documents/${bankFile.id}`)).status() === 401);
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower sees the photos on their loan", (await borrower.getByTestId("photo-request").innerText()).includes("2 photos received"));

  await carl.goto(BASE + photoPath);
  ok("the link still opens to add more", await seen(carl.getByTestId("photo-add-more")));
  await go(owner, "/admin/draws");
  await receivedRow.getByTestId("photo-off").click();
  await gone(receivedRow.getByTestId("photo-off"));
  await carl.goto(BASE + photoPath);
  ok("turning the link off closes it at once", await seen(carl.getByTestId("photo-link-closed")));
  ok("and it won't take uploads", (await carl.request.post(`${BASE}/api/photo-links/${photoToken}`, { multipart: { scopeId: "kitchen", shot: "room", file: { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) } } })).status() === 404);
  await receivedRow.getByTestId("photo-renew").click();
  ok("staff can make a new link", await seen(card.getByTestId("photo-issued")));
  const renewedPath = new URL(await card.getByTestId("photo-link").inputValue()).pathname;
  await carl.goto(BASE + renewedPath);
  ok("the new link opens, with the old one still dead", (await seen(carl.getByTestId("photo-guide"))) && renewedPath !== photoPath);

  await go(borrower, `/admin/borrower/${dealId}`);
  ok("a borrower can't change a link the team sent", (await borrower.getByTestId("photo-request").count()) === 1 && (await borrower.getByTestId("photo-renew").count()) === 0 && (await borrower.getByTestId("photo-off").count()) === 0);
  await borrower.getByTestId("ask-photos").click();
  ok("a borrower can send their contractor a link, but not pick who it's for", (await borrower.getByTestId("photo-who-borrower").count()) === 0 && (await borrower.getByTestId("photo-to").inputValue()) === "Carl Contractor");
  await borrower.getByTestId("photo-send-link").click();
  ok("and gets one", await seen(borrower.getByTestId("photo-issued")));
  await go(other, `/admin/borrower/${dealId}`);
  ok("nobody else's browser receives any of it", !(await received(other)).includes("Carl Contractor"));
  await go(broker, "/admin/broker");
  ok("nor a broker's", !(await received(broker)).includes("Carl Contractor"));

  await card.getByTestId("send-inspector").click();
  await card.getByTestId("observed-kitchen").fill("100");
  await card.getByTestId("record-inspection").click();
  await seen(card.getByTestId("draw-review"));
  await card.getByTestId("approve-draw").click();
  await card.getByTestId("release-draw").click();
  await seen(owner.getByTestId("closed-draw"));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower sees the money released", (await borrower.getByTestId("my-draw").innerText()).includes("Funds released"));
  await carl.goto(BASE + renewedPath);
  ok("a link closes once its draw is paid", await seen(carl.getByTestId("photo-link-closed")));
  ok("and stops showing its photos", (await carl.request.get(`${BASE}/api/photo-links/${renewedPath.split("/").pop()}/${photoId}`)).status() === 404);
  await carlContext.close();

  // Payments and payoff
  await go(owner, "/admin/servicing");
  const loanRow = owner.getByTestId("serviced-loan").filter({ hasText: "LH-1001" });
  const dueBefore = await loanRow.getByTestId("serviced-next-due").innerText();
  await loanRow.getByTestId("record-payment").click();
  await owner.waitForFunction((due) => !document.body.innerText.includes(due), dueBefore).catch(() => {});
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("a recorded payment shows for the borrower", (await borrower.getByTestId("next-due").innerText()) !== dueBefore);
  await borrower.getByTestId("request-payoff").click();
  ok("the borrower requests a payoff", await seen(borrower.getByTestId("my-payoffs")));
  await go(owner, "/admin/servicing");
  ok("the payoff reaches servicing", await seen(owner.getByTestId("payoff-row").filter({ hasText: "LH-1001" })));
  await owner.getByTestId("send-payoff").click();
  await seen(owner.getByTestId("mark-paid-off"));

  // A website brief becomes a loan
  await go(owner, "/admin/leads");
  await owner.locator("tr", { hasText: "Lena Lead" }).getByTestId("start-loan").click();
  await owner.waitForURL("**/admin/new-loan?lead=*");
  await owner.getByTestId("next").click();
  await owner.getByLabel("Property address").fill("200 Lead Avenue");
  await owner.getByLabel("ZIP").fill("33130");
  ok("a brief fills in the application", (await owner.getByLabel("City").inputValue()) === "Miami" && (await owner.getByTestId("purchase").or(owner.getByLabel("Property address")).first().count()) === 1);
  for (let i = 0; i < 3; i++) await owner.getByTestId("next").click();
  ok("it carries the client's details", (await owner.getByTestId("client-name").inputValue()) === "Lena Lead" && (await owner.getByTestId("client-email").inputValue()) === `lena@${DOMAIN}`);
  await owner.getByLabel("Borrowing entity (LLC)").fill("Lena Holdings LLC");
  for (let i = 0; i < 3; i++) await owner.getByTestId("next").click();
  for (const c of ["bp", "noo", "consent", "true"]) await owner.getByTestId(`cert-${c}`).check();
  await owner.getByTestId("submit").click();
  await owner.waitForURL("**/admin/deals/*");
  const leadDeal = path(owner);
  const leadDealId = leadDeal.split("/").pop();
  const invited = await prisma.user.findUnique({ where: { email: `lena@${DOMAIN}` }, include: { roles: true, passwordLinks: true } });
  ok("staff create a loan from a brief", (await owner.locator("main").innerText()).includes("Lena Lead"));
  ok("the client is invited to the portal", invited?.roles[0]?.role === "BORROWER" && invited.passwordLinks.length === 1);
  const leadRow = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  ok("the brief links to its loan", leadRow.loanId === leadDealId && Boolean(leadRow.contactedAt));
  await go(owner, leadDeal);
  await owner.getByTestId("tab-Credit review").click();
  ok("a loan started from a call waits for the borrower's profile", (await owner.getByTestId("credit-flags").innerText()).includes("No borrower profile"));
  await go(owner, "/admin/leads");
  ok("the leads page opens the loan", (await owner.locator("tr", { hasText: "Lena Lead" }).getByTestId("lead-loan").getAttribute("href")) === leadDeal);

  // A partner lender, blind until they win
  await go(partner, "/admin/partner");
  ok("a partner sees nothing until set up", await seen(partner.getByTestId("no-partner-org")));
  await go(owner, "/admin/partners");
  await owner.getByTestId("firm-row").filter({ hasText: `partner@${DOMAIN}` }).getByTestId("edit-firm").click();
  await owner.getByTestId("firm-name").fill("Parker Capital");
  await owner.getByTestId("save-firm").click();
  await seen(owner.getByTestId("firm-row").filter({ hasText: "Parker Capital" }));
  await owner.getByTestId("firm-row").filter({ hasText: `buyer@${DOMAIN}` }).getByTestId("edit-firm").click();
  await owner.getByTestId("firm-name").fill("Blair Notes");
  await owner.getByTestId("save-firm").click();
  await seen(owner.getByTestId("firm-row").filter({ hasText: "Blair Notes" }));
  await go(partner, "/admin/partner");
  ok("a partner signs before seeing deals", await seen(partner.getByTestId("nda-gate")));
  await partner.getByRole("button", { name: "E-sign agreement" }).click();
  await seen(partner.locator("main").getByText("Deal feed"));
  await go(owner, leadDeal);
  await owner.getByTestId("tab-Capital Routing").click();
  await owner.locator("li", { hasText: "Parker Capital" }).locator("input[type=checkbox]").check();
  await owner.getByTestId("send-teaser").click();
  await seen(owner.locator("li", { hasText: "Parker Capital" }).getByText("teaser sent"));
  await go(partner, "/admin/partner");
  ok("the teaser reaches the partner", await seen(partner.getByTestId("teaser-card")));
  let html = await received(partner);
  ok("no borrower name or address reaches the partner's browser", !html.includes("Lena Lead") && !html.includes("Lena Holdings") && !html.includes("200 Lead Avenue") && !html.includes("Bonnie Borrower"));
  await go(partner, `/admin/partner/teasers/${leadDealId}`);
  html = await received(partner);
  ok("nor on the teaser page", !html.includes("Lena Lead") && !html.includes("200 Lead Avenue"));
  await partner.getByTestId("place-bid").click();
  ok("the partner bids", await seen(partner.getByTestId("my-bid")));
  await go(owner, leadDeal);
  await owner.getByTestId("tab-Capital Routing").click();
  await owner.getByTestId("accept-bid").click();
  await seen(owner.getByTestId("bid-row").getByText("accepted"));
  await go(partner, `/admin/partner/teasers/${leadDealId}`);
  ok("winning opens the file", (await seen(partner.getByTestId("deal-room-open"))) && (await partner.locator("h1").innerText()).includes("200 Lead Avenue"));

  // A loan buyer, blind until they buy
  await go(buyer, "/admin/buyer");
  await buyer.getByRole("button", { name: "E-sign agreement" }).click();
  await seen(buyer.locator("main").getByText("Loans for sale"));
  await go(owner, "/admin/loan-sales");
  const ready = owner.getByTestId("eligible-row").filter({ hasText: "LH-1001" });
  await ready.getByTestId("ask-input").fill("99");
  await ready.getByTestId("list-loan").click();
  await seen(owner.getByTestId("sale-row").filter({ hasText: "LH-1001" }));
  await go(buyer, "/admin/buyer");
  ok("the listed loan reaches the buyer", await seen(buyer.getByTestId("loan-for-sale")));
  html = await received(buyer);
  ok("no borrower name or address reaches the buyer's browser", !html.includes("Bonnie Borrower") && !html.includes("100 Real Street") && !html.includes("Real Flips LLC") && !html.includes("Lena Lead"));
  await buyer.getByTestId("loan-for-sale").click();
  await buyer.waitForURL("**/admin/buyer/loans/*");
  const saleRoute = path(buyer);
  await buyer.getByTestId("send-offer").click();
  ok("the buyer makes an offer", await seen(buyer.getByTestId("my-offer")));
  const capitalBefore = await (async () => { await go(owner, "/admin/capital"); return parseFloat((await owner.getByTestId("capital-available").innerText()).replace(/[^0-9.]/g, "")); })();
  await go(owner, "/admin/loan-sales");
  await owner.getByTestId("accept-offer").click();
  await seen(owner.getByTestId("sold-row").filter({ hasText: "LH-1001" }));
  await go(buyer, saleRoute);
  ok("buying opens the loan's address and file", (await seen(buyer.getByTestId("file-open"))) && (await buyer.getByTestId("loan-heading").innerText()).includes("100 Real Street"));
  const bought = await buyer.getByTestId("file-open").getByRole("link").first().getAttribute("href");
  ok("the buyer can open the loan's documents", (await buyer.request.get(BASE + bought)).status() === 200);
  await go(owner, "/admin/capital");
  ok("selling frees the capital", parseFloat((await owner.getByTestId("capital-available").innerText()).replace(/[^0-9.]/g, "")) > capitalBefore);

  // A broker
  await go(broker, "/admin/broker/new");
  await broker.getByTestId("next").click();
  await broker.getByLabel("Property address").fill("300 Broker Blvd");
  await broker.getByLabel("City").fill("Davie");
  await broker.getByLabel("ZIP").fill("33314");
  for (let i = 0; i < 3; i++) await broker.getByTestId("next").click();
  await broker.getByTestId("client-name").fill("Casey Client");
  await broker.getByLabel("Borrowing entity (LLC)").fill("Casey LLC");
  await broker.getByTestId("guarantor-name-0").fill("Casey Client");
  for (let i = 0; i < 2; i++) await broker.getByTestId("next").click();
  await answerAll(broker);
  await broker.getByTestId("next").click();
  for (const c of ["bp", "noo", "consent", "true"]) await broker.getByTestId(`cert-${c}`).check();
  await broker.getByTestId("submit").click();
  await broker.waitForURL("**/admin/broker");
  ok("a broker submits a real deal", await seen(broker.getByTestId("broker-deal").filter({ hasText: "Casey Client" })));
  html = await received(broker);
  ok("a broker receives only their own deals", !html.includes("Bonnie Borrower") && !html.includes("Lena Lead") && !html.includes("Real Fund I"));
  await go(owner, "/admin");
  ok("the broker's deal reaches the team", await seen(owner.getByTestId("pipeline-table").getByText("Casey Client")));
  ok("a borrower's browser never gets other loans", !(await (async () => { await go(borrower, "/admin/borrower"); return received(borrower); })()).includes("Casey Client"));

  // Exports, audit, settings
  const file = owner.waitForEvent("download");
  await owner.getByTestId("export-pipeline").click();
  const csv = await (await file).createReadStream();
  const chunks = [];
  for await (const chunk of csv) chunks.push(chunk);
  ok("the pipeline export holds the real loans", Buffer.concat(chunks).toString().includes("LH-1001"));
  await go(owner, "/admin/audit?q=book.");
  ok("every change is in the audit log", (await owner.getByTestId("audit-row").count()) > 10);
  await go(owner, "/admin/audit?q=document.opened");
  ok("every file opened is in the audit log", (await owner.getByTestId("audit-row").count()) >= 3);
  await go(under, "/admin/settings");
  ok("an underwriter can't open settings", path(under) === "/admin");
  await go(other, "/admin/borrower");
  ok("an empty account is offered sample data", await seen(other.getByTestId("load-sample")));
  await go(owner, "/admin/settings");
  await owner.getByTestId("setting-sample").uncheck();
  await owner.getByRole("button", { name: "Save settings" }).click();
  await owner.waitForURL("**notice=settings_saved");
  await go(other, "/admin/borrower");
  ok("turning sample data off removes the offer", (await other.getByTestId("load-sample").count()) === 0);
  ok(`no browser errors${errors.length ? `: ${errors[0]}` : ""}`, errors.length === 0);
} finally {
  await browser.close();
  await wipe();
  await prisma.$disconnect();
}
console.log(checks.join("\n"));
if (checks.some((check) => check.startsWith("FAIL"))) process.exitCode = 1;
