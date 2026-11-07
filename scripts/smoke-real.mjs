// A loan's whole life with real accounts, each in its own browser, so nothing can pass by sharing browser storage:
// sign-up to funding, documents, draws, payoff, a partner bid, a loan sale and a broker deal, checking what each person
// can and can't see. It wipes the loan book when it starts and ends, so it refuses anything but a local database.
// Usage: npm run db:seed && npm run build && npm start, then npm run smoke:real
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  await prisma.document.deleteMany({ where: { ownerType: { in: ["LOAN", "LEAD", "BROKER"] } } });
  await prisma.lead.deleteMany();
  await prisma.quoteCount.deleteMany();
  await prisma.platformSettings.updateMany({ data: { slaTargets: null, paymentInstructions: "" } });
  await prisma.pricingVersion.deleteMany();
  await prisma.sanctionsList.deleteMany();
  await prisma.photoLink.deleteMany();
  await prisma.payoffLink.deleteMany();
  await prisma.applicationLink.deleteMany();
  await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "lead:" } } });
  await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "payoff-form:" } } });
  await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "lead-photos:" } } });
  await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "signup-ip:" } } });
  await prisma.rateWindow.deleteMany({ where: { key: { startsWith: "quote-event:" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.rateWindow.deleteMany({ where: { key: { contains: DOMAIN } } });
  await prisma.platformSettings.update({ where: { id: "default" }, data: { offerSampleData: true, allowSignup: true } });
  await prisma.jobRun.deleteMany({ where: { runKey: { startsWith: "smoke-" } } });
  await prisma.errorEvent.deleteMany({ where: { hash: { startsWith: "smoke" } } });
  await prisma.investorStatement.deleteMany();
  await prisma.borrowerStatement.deleteMany();
};
await wipe();
// As if the nightly jobs ran this morning, so the owners' panel has no warning until the script takes one away.
await prisma.jobRun.createMany({ data: ["servicing", "sanctions"].map((job) => ({ job, runKey: `smoke-${job}`, ok: true, finishedAt: new Date() })) });
// A small stand-in for Treasury's sanctions list, so applications are screened as they arrive (the nightly job downloads the real one).
await prisma.sanctionsList.create({ data: { id: "sdn", fetchedAt: new Date(), names: 2, hash: "smoke", entries: [[90001, "DOE, Jonathan", "individual", "SDGT"], [90002, "LISTED TRADING CO", "entity", "SDNTK"]] } });

const passwordHash = await bcrypt.hash(PASSWORD, 10);
const account = (local, name, role) => prisma.user.create({ data: { email: `${local}@${DOMAIN}`, name, passwordHash, accountStatus: "APPROVED", roles: { create: [{ role }] } } });
await account("owner", "Owen Owner", "ADMIN_OWNER");
await account("under", "Ursula Under", "UNDERWRITER");
await account("borrower", "Bonnie Borrower", "BORROWER");
await account("other", "Oscar Other", "BORROWER");
await account("broker", "Brook Broker", "BROKER");
await account("partner", "Parker Partner", "PARTNER_LENDER");
await account("buyer", "Blair Buyer", "LOAN_BUYER");
await account("proc", "Percy Processor", "PROCESSOR");
const lead = await prisma.lead.create({ data: { name: "Lena Lead", email: `lena@${DOMAIN}`, strategy: "Fix & flip", city: "Miami", state: "FL", propertyValueCents: 40_000_000, renovationCents: 8_000_000, requestedLoanCents: 34_000_000, notes: "Wants to start next month." } });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];
const person = async (local) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${local} at ${new URL(page.url()).pathname}: ${error.message}`));
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
// A real picture at a phone camera's size, drawn in the browser: it has to survive being shrunk and show as a thumbnail.
const cameraJpeg = async (page) => Buffer.from(await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 3000; canvas.height = 2250;
  const context = canvas.getContext("2d");
  const image = context.createImageData(3000, 2250);
  for (let i = 0; i < image.data.length; i += 4) { const shade = Math.random() * 255; image.data[i] = shade; image.data[i + 1] = 120; image.data[i + 2] = 100; image.data[i + 3] = 255; }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
}), "base64");
// Shows whether an image on the page actually loaded.
const loaded = (locator) => locator.first().evaluate((img) => (img.complete ? img.naturalWidth > 0 : new Promise((done) => { img.onload = () => done(img.naturalWidth > 0); img.onerror = () => done(false); })));
const rawRows = async (collection) => JSON.stringify((await prisma.$runCommandRaw({ find: collection, filter: {} })).cursor.firstBatch);

try {
  const owner = await person("owner");
  const under = await person("under");
  const borrower = await person("borrower");
  const other = await person("other");
  const broker = await person("broker");
  const partner = await person("partner");
  const buyer = await person("buyer");
  const proc = await person("proc");

  // A quote request from the public site, as a visitor sends it from a phone
  const visitorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await visitorContext.newPage();
  visitor.on("pageerror", (error) => errors.push(`visitor: ${error.message}`));
  // The deal first and its terms, then who's asking: the contact details only come with saving.
  const fillDeal = async (path = "/start", page = visitor) => {
    await page.goto(`${BASE}${path}`);
    await page.getByTestId("quote-citizen").selectOption("us");
    await page.getByTestId("quote-credit").selectOption("720-759");
    await page.getByTestId("quote-experience").selectOption("1-2");
    await page.getByTestId("quote-address-street").fill("44 Visitor Lane");
    await page.getByTestId("quote-address-city").fill("Tampa");
    await page.getByTestId("quote-address-state").fill("FL");
    await page.getByTestId("quote-address-zip").fill("33602");
    await page.getByTestId("quote-address-county").fill("Hillsborough");
    await page.getByTestId("quote-purchasePrice").fill("300000");
    await page.getByTestId("quote-rehab").fill("60000");
    await page.getByTestId("quote-arv").fill("480000");
    await page.getByTestId("quote-requestedAmount").fill("270000");
    await page.getByTestId("quote-date").fill("2027-01-15");
    await page.getByTestId("quote-see-terms").click();
    await page.getByTestId("quote-first").waitFor();
  };
  const fillQuote = async (first, email, notes, path = "/start", page = visitor) => {
    await fillDeal(path, page);
    await page.getByTestId("quote-first").fill(first);
    await page.getByTestId("quote-last").fill("Visitor");
    await page.getByTestId("quote-email").fill(email);
    await page.getByTestId("quote-phone").fill("(555) 010-0300");
    await page.locator("textarea").first().fill(notes);
  };
  // Terms come before any contact details, and nothing about the visitor is kept until they save them.
  const leadsBefore = await prisma.lead.count();
  const countsBefore = await prisma.quoteCount.aggregate({ _sum: { started: true, shown: true } });
  await fillDeal();
  ok("a visitor sees indicative terms before giving a name, email or phone", (await seen(visitor.getByTestId("quote-live"))) && (await visitor.getByTestId("quote-amount").innerText()).startsWith("up to $") && (await visitor.getByTestId("quote-cash-parts").count()) === 1);
  ok("and nothing about them is kept yet", (await prisma.lead.count()) === leadsBefore);
  // The counts are sent as the page goes, so give the second one a moment to land.
  let countsAfter = countsBefore;
  for (let tries = 0; tries < 20 && (countsAfter._sum.shown ?? 0) === (countsBefore._sum.shown ?? 0); tries++) { await visitor.waitForTimeout(250); countsAfter = await prisma.quoteCount.aggregate({ _sum: { started: true, shown: true } }); }
  ok("only an anonymous count that someone started a quote and saw terms", (countsAfter._sum.started ?? 0) === (countsBefore._sum.started ?? 0) + 1 && (countsAfter._sum.shown ?? 0) === (countsBefore._sum.shown ?? 0) + 1);
  await fillQuote("Vera", `vera@${DOMAIN}`, "Refinance into a rental next spring.");
  const housePhoto = await cameraJpeg(visitor);
  await visitor.getByTestId("quote-photos-input").setInputFiles({ name: "vera-front-yard.jpg", mimeType: "image/jpeg", buffer: housePhoto });
  await seen(visitor.getByTestId("quote-photos-item"));
  await visitor.getByTestId("quote-submit").click();
  ok("a visitor can send a quote request from a phone", await seen(visitor.getByTestId("quote-sent")));
  ok("and sees indicative terms", (await visitor.getByTestId("quote-amount").innerText()).startsWith("up to $"));
  ok("with a photo of the property, shrunk on the phone first", await seen(visitor.getByTestId("quote-photos-sent").filter({ hasText: "1 photo of the property sent." }), 20_000));
  const veraLead = await prisma.lead.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  const leadPhoto = await prisma.document.findFirst({ where: { ownerType: "LEAD", ownerId: veraLead.id, documentType: "property_photo" } });
  ok("it's kept with the request, smaller than the original and encrypted", !!leadPhoto && leadPhoto.size < housePhoto.length && leadPhoto.mime === "image/jpeg" && leadPhoto.uploadedById === null && STORED(leadPhoto.storageKey).subarray(0, 6).toString() === "LHENC1" && !(await rawRows("Document")).includes("vera-front-yard"));
  const leadRows = await rawRows("Lead");
  ok("the request's contact details are encrypted in the database", !leadRows.includes("Vera Visitor") && !leadRows.includes(`vera@${DOMAIN}`) && !leadRows.includes("(555) 010-0300") && !leadRows.includes("Refinance into a rental") && !leadRows.includes("44 Visitor Lane") && leadRows.includes("enc1:"));
  ok("so is the alert saved for the team", !(await rawRows("Notification")).includes("Vera Visitor"));
  await go(owner, "/admin/account/notifications");
  ok("the owner gets the alert with the request in it", await seen(owner.getByTestId("notice").filter({ hasText: "New quote request: Fix & flip, Tampa, FL" }).filter({ hasText: "ARV $480,000" })));
  await go(owner, "/admin");
  ok("the pipeline says a request is waiting", (await owner.getByTestId("attention-leads").innerText()).includes("Quote requests"));
  await go(owner, "/admin/leads");
  const veraRow = owner.getByTestId("leads-table").locator("tr", { hasText: "Vera Visitor" });
  ok("the request reaches the leads inbox, readable", (await seen(veraRow)) && (await veraRow.innerText()).includes("Refinance into a rental") && (await veraRow.innerText()).includes("$270,000") && (await veraRow.innerText()).includes("ARV $480,000"));
  ok("staff can email the visitor from it", (await veraRow.getByRole("link", { name: `vera@${DOMAIN}` }).getAttribute("href")) === `mailto:vera@${DOMAIN}`);
  await veraRow.scrollIntoViewIfNeeded();
  ok("the team sees the visitor's photo with the request", (await veraRow.getByTestId("lead-photo").count()) === 1 && (await loaded(veraRow.getByTestId("lead-photo"))));
  const leadPhotoUrl = BASE + (await veraRow.getByTestId("lead-photo").getAttribute("src"));
  ok("a borrower can't open a lead's photo", (await borrower.request.get(leadPhotoUrl)).status() !== 200);
  ok("nor can anyone signed out", (await (await browser.newContext()).request.get(leadPhotoUrl, { maxRedirects: 0 })).status() !== 200);
  await veraRow.getByRole("button", { name: "Mark contacted" }).click();
  ok("staff can mark it contacted", await seen(veraRow.getByText("Contacted")));
  await go(borrower, "/admin/leads");
  ok("a borrower can't see the leads", !(await received(borrower)).includes("Vera Visitor"));
  await fillQuote("Rob", `rob@${DOMAIN}`, "Spam.");
  await visitor.locator(".hp input").fill("http://spam.example", { force: true });
  const before = await prisma.lead.count();
  await visitor.getByTestId("quote-submit").click();
  await seen(visitor.getByTestId("quote-sent"));
  ok("a bot filling the hidden field gets a normal reply and nothing is kept", (await prisma.lead.count()) === before);

  // A visitor saves a quote, then makes an account with the same email: their first application starts from it.
  await fillQuote("Sage", `sage@${DOMAIN}`, "Saving this one for later.");
  await visitor.getByTestId("quote-submit").click();
  await seen(visitor.getByTestId("quote-sent"));
  // A contractor creates their own account from a phone, confirms the email, and signs in.
  await visitor.goto(`${BASE}/login`);
  await visitor.getByTestId("signup-link").click();
  await visitor.getByTestId("signup-name").fill("Sage Signup");
  await visitor.getByTestId("signup-email").fill(`sage@${DOMAIN}`);
  await visitor.getByTestId("signup-phone").fill("(555) 010-0400");
  await visitor.getByRole("button", { name: "Create my account" }).click();
  ok("anyone can sign up from the login page", await seen(visitor.getByTestId("signup-sent")));
  const sage = await prisma.user.findUnique({ where: { email: `sage@${DOMAIN}` }, include: { roles: true, passwordLinks: true } });
  ok("it makes a borrower account that waits for the email to be confirmed", sage?.accountStatus === "PENDING" && !!sage.signedUpAt && sage.roles.map((row) => row.role).join() === "BORROWER" && sage.passwordLinks.length === 1);
  await visitor.goto(`${BASE}/login/signup`);
  await visitor.getByTestId("signup-name").fill("Not Bonnie");
  await visitor.getByTestId("signup-email").fill(`borrower@${DOMAIN}`);
  await visitor.getByRole("button", { name: "Create my account" }).click();
  await seen(visitor.getByTestId("signup-sent"));
  const bonnie = await prisma.user.findUniqueOrThrow({ where: { email: `borrower@${DOMAIN}` }, include: { roles: true } });
  ok("signing up with an address that has an account looks the same and changes nothing", bonnie.name === "Bonnie Borrower" && bonnie.accountStatus === "APPROVED" && !bonnie.signedUpAt && (await bcrypt.compare(PASSWORD, bonnie.passwordHash)));
  // The emailed link goes to a test address that's never delivered, so put one in its place this script knows.
  const confirmToken = randomBytes(32).toString("base64url");
  await prisma.passwordLink.updateMany({ where: { userId: sage.id }, data: { tokenHash: createHash("sha256").update(confirmToken).digest("hex") } });
  await visitor.goto(`${BASE}/login/set-password?token=${confirmToken}`);
  await visitor.getByTestId("new-password").fill(PASSWORD);
  await visitor.getByTestId("confirm-password").fill(PASSWORD);
  await visitor.getByTestId("confirm-password").press("Enter");
  ok("the emailed link confirms it", await seen(visitor.getByText("Your email is confirmed and your account is ready.")));
  await visitor.getByTestId("login-email").fill(`sage@${DOMAIN}`);
  await visitor.getByTestId("login-password").fill(PASSWORD);
  await visitor.getByRole("button", { name: "Sign in" }).click();
  ok("and they can sign in to their own portal", await visitor.waitForURL("**/admin/borrower").then(() => true, () => false));
  await go(visitor, "/admin/apply");
  ok("their first application starts from the quote they saved", (await seen(visitor.getByTestId("app-from-quote"))) && (await visitor.getByTestId("app-email").inputValue()) === `sage@${DOMAIN}`);
  await visitor.getByTestId("app-next").click();
  ok("with its property and numbers filled in", (await visitor.getByTestId("app-address-street").inputValue()) === "44 Visitor Lane");
  ok("the team hears about the new account", (await prisma.notification.count({ where: { eventCode: "auth.signup", toEmail: `owner@${DOMAIN}` } })) === 1);
  await go(owner, "/admin/settings");
  await owner.getByTestId("setting-signup").uncheck();
  await owner.getByRole("button", { name: "Save settings" }).click();
  await seen(owner.getByText("Settings saved."));
  await visitor.context().clearCookies();
  await visitor.goto(`${BASE}/login/signup`);
  ok("turning sign-ups off in Settings closes the page", (await seen(visitor.getByTestId("signup-closed"))) && (await visitor.getByTestId("signup-form").count()) === 0);
  await visitor.goto(`${BASE}/login`);
  ok("and takes the link off the login page", (await visitor.getByTestId("login-email").count()) === 1 && (await visitor.getByTestId("signup-link").count()) === 0);
  await go(owner, "/admin/settings");
  await owner.getByTestId("setting-signup").check();
  // The work queue's targets: GT sets how long a new application may wait, and it sticks.
  await owner.getByTestId("setting-sla-firstLook").fill("3");
  await owner.getByTestId("setting-pay").fill("Wire to: LendHous Servicing (SMOKE)\nReference: your loan number");
  await owner.getByRole("button", { name: "Save settings" }).click();
  await seen(owner.getByText("Settings saved."));
  ok("an owner sets how long things may wait", (await owner.getByTestId("setting-sla-firstLook").inputValue()) === "3");

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

  // A real borrower applies from the portal: the same signed application as the secure link, saved as they go.
  const CLOSE_ON = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  const fillAddress = async (page, testid, place) => { for (const [key, value] of Object.entries(place)) await page.getByTestId(`${testid}-${key}`).fill(value); };
  await go(borrower, "/admin/apply");
  ok("the portal application starts from the borrower's account", (await borrower.getByTestId("app-email").inputValue()) === `borrower@${DOMAIN}` && (await borrower.getByTestId("app-first").inputValue()) === "Bonnie");
  await borrower.getByTestId("app-phone").fill("(555) 010-0500");
  await borrower.getByTestId("app-next").click();
  await fillAddress(borrower, "app-address", { street: "100 Real Street", city: "Hollywood", state: "FL", zip: "33020", county: "Broward" });
  await borrower.getByTestId("app-flood-no").click();
  await borrower.getByTestId("app-type").selectOption("sfr");
  await borrower.getByTestId("app-occupancy").selectOption("vacant");
  await borrower.getByTestId("app-next").click();
  for (const [key, value] of Object.entries({ purchasePrice: "300000", rehab: "100000", arv: "550000", liquidity: "150000" })) await borrower.getByTestId(`app-${key}`).fill(value);
  await borrower.getByTestId("app-plan").fill("Kitchen, baths and paint, then sell.");
  await borrower.getByTestId("app-exit-sell").click();
  await borrower.getByTestId("app-close").fill(CLOSE_ON);
  ok("the borrower sees the live estimate as the numbers go in", (await borrower.getByTestId("est-loan").innerText()).startsWith("$"));
  await borrower.getByTestId("app-next").click();
  await borrower.waitForTimeout(1500);
  await seen(borrower.getByTestId("app-saved").getByText(/^Saved/));
  await go(borrower, "/admin/apply");
  ok("it saves as the borrower goes, and opens where they left off", (await borrower.getByTestId("app-step").innerText()).toLowerCase() === "step 4 of 5" && (await borrower.getByTestId("app-saved").innerText()).includes("Resumed"));
  await borrower.getByTestId("app-llc-true").click();
  await borrower.getByTestId("app-llc-name").fill("Real Flips LLC");
  await fillAddress(borrower, "app-llc-address", { street: "1 Company Court", city: "Hollywood", state: "FL", zip: "33020" });
  const g = (id) => borrower.getByTestId(`g0-${id}`);
  ok("the guarantor starts as the borrower", (await g("first").inputValue()) === "Bonnie" && (await g("email").inputValue()) === `borrower@${DOMAIN}`);
  for (const [id, value] of Object.entries({ phone: "(555) 010-0500", dob: "1979-06-02", fico: "745", ssn: "987654321", own: "100" })) await g(id).fill(value);
  await fillAddress(borrower, "g0-home", { street: "12 Home Way", city: "Hollywood", state: "FL", zip: "33021" });
  await g("citizen").selectOption("us");
  for (const id of ["two-true", "mail-true", "marital-unmarried", "decl-occupy-false", "decl-lawsuit-true"]) await g(id).click();
  for (const key of QUESTIONS.filter((item) => item !== "lawsuit")) await g(`decl-${key}-false`).click();
  await borrower.getByTestId("add-deal").click();
  await borrower.getByTestId("deal-address-0").fill("9 Past Flip Lane");
  await borrower.getByTestId("deal-completed-0").fill("2026-02");
  await borrower.getByTestId("deal-price-0").fill("210000");
  await borrower.getByTestId("deal-sale-0").fill("315000");
  await borrower.getByTestId("app-next").click();
  ok("a yes needs an explanation", (await borrower.getByTestId("app-problems").innerText()).includes("explanation"));
  await g("explanation").fill("A 2025 dispute with a contractor, settled in August.");
  await borrower.getByTestId("app-next").click();
  await seen(borrower.getByTestId("app-review"));
  ok("the review lists what will be asked for, including proof of the past deal", (await borrower.getByTestId("needs-preview").innerText()).includes("Settlement statements for your past deals"));
  await borrower.waitForTimeout(1500);
  await seen(borrower.getByTestId("app-saved").getByText(/^Saved/));
  const savedRows = await rawRows("ApplicationLink");
  ok("what's saved is encrypted", savedRows.includes("enc1:") && !savedRows.includes("987654321") && !savedRows.includes("1979-06-02") && !savedRows.includes("Real Flips"));
  ok("signing needs every consent and a name", await borrower.getByTestId("app-sign").isDisabled());
  for (const key of ["application", "credit", "release", "esign"]) await borrower.getByTestId(`agree-${key}`).check();
  await borrower.getByTestId("app-signature").fill("Someone Else");
  await borrower.getByTestId("app-sign").click();
  ok("a name that isn't on the application is refused", await seen(borrower.getByTestId("app-problems").getByText(/exactly as you entered/)));
  await borrower.getByTestId("app-signature").fill("Bonnie Borrower");
  await borrower.getByTestId("app-sign").click();
  ok("a real borrower signs and sends it, and lands on the loan", await borrower.waitForURL("**/admin/borrower/d*").then(() => true, () => false));
  await go(borrower, "/admin/borrower");
  ok("it's still there after a reload", (await borrower.getByTestId("borrower-loan-card").count()) === 1);
  await borrower.getByTestId("borrower-loan-card").click();
  ok("the needs list follows the application: proof of past deals and a letter for the yes", (await seen(borrower.getByTestId("doc-track"))) && (await seen(borrower.getByTestId("doc-explanation"))) && (await borrower.getByTestId("doc-good-standing").innerText()).includes("last 90 days"));
  await borrower.getByTestId("property-photo-input").setInputFiles([{ name: "street-view.jpg", mimeType: "image/jpeg", buffer: housePhoto }, { name: "kitchen.jpg", mimeType: "image/jpeg", buffer: housePhoto }]);
  ok("the borrower adds photos of the property to their loan", await borrower.getByTestId("property-photo").nth(1).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  await borrower.reload({ waitUntil: "networkidle" });
  ok("they're saved with the loan and show as pictures", (await borrower.getByTestId("property-photo").count()) === 2 && (await loaded(borrower.getByTestId("property-photo").locator("img"))));
  ok("there's no remove button on the borrower's side", (await borrower.getByTestId("remove-property-photo").count()) === 0);
  ok("and the loan page now leads with their photo", (await borrower.locator("[data-testid=property-picture][data-kind=photo]").count()) === 1 && (await loaded(borrower.locator("[data-testid=property-picture] img"))));

  await go(under, "/admin");
  const row = under.getByTestId("pipeline-table").locator("tr", { hasText: "Bonnie Borrower" });
  ok("it reaches the team in another browser", await seen(row));
  ok("it gets a real loan number", (await row.innerText()).includes("LH-1001"));
  ok("the pipeline flags it", (await under.getByTestId("attention-applications").innerText()).includes("New applications"));
  const newItem = under.getByTestId("queue-item").filter({ hasText: "LH-1001" }).filter({ hasText: "Look at the new application" });
  ok("and it's in the work queue, with its clock against the 3-hour target", (await seen(newItem)) && (await newItem.getByTestId("queue-clock").getAttribute("title")) === "Target: 3 business hours");
  const dealHref = await row.getByRole("link").first().getAttribute("href");
  const dealId = dealHref.split("/").pop();
  await go(under, dealHref);
  await under.getByTestId("tab-Documents").click();
  ok("the team sees the borrower's photos on the loan", (await seen(under.getByTestId("property-photo"))) && (await under.getByTestId("property-photo").count()) === 2 && (await loaded(under.getByTestId("property-photo").locator("img"))));
  ok("they're filed as the borrower's", (await prisma.document.count({ where: { ownerType: "LOAN", ownerId: dealId, documentType: "property_photo", uploadedById: (await prisma.user.findUniqueOrThrow({ where: { email: `borrower@${DOMAIN}` } })).id } })) === 2);

  // Who works the loan: a portal application waits for a loan officer, an owner gives it to the underwriter, and a
  // processor takes the open seat. The borrower then sees who to call.
  await go(owner, "/admin");
  ok("a portal application waits for a loan officer", await seen(owner.getByTestId("attention-unassigned")));
  await go(owner, dealHref);
  await owner.getByTestId("assign-officer").selectOption({ label: "Ursula Under" });
  const pickedOfficer = () => owner.getByTestId("assign-officer").evaluate((select) => select.selectedOptions[0]?.text ?? "");
  for (let wait = 0; wait < 20 && (await pickedOfficer()) !== "Ursula Under"; wait++) await owner.waitForTimeout(250);
  await owner.waitForTimeout(500);
  ok("an owner gives the loan to the underwriter, and she's told", (await pickedOfficer()) === "Ursula Under" && (await prisma.notification.count({ where: { toEmail: `under@${DOMAIN}`, eventCode: "loan.assigned" } })) === 1);
  await go(proc, dealHref);
  ok("a processor can't reassign the loan officer", (await proc.getByTestId("assign-officer").count()) === 0 && (await proc.getByTestId("team-officer-name").innerText()) === "Ursula Under");
  await proc.getByTestId("take-processor").click();
  ok("but can take the open processor seat", await seen(proc.getByTestId("team-processor-name").getByText("Percy Processor")));
  await go(under, "/admin");
  await under.getByTestId("staff-search-input").fill("bonnie");
  ok("the staff search finds the loan by the borrower's name", await seen(under.getByTestId("search-result").filter({ hasText: "LH-1001" })));
  await under.getByTestId("staff-search-input").press("Escape");
  await under.getByTestId("pipeline-team").selectOption("mine");
  ok("the underwriter finds it under My loans", (await under.getByTestId("pipeline-table").getByTestId("officer").count()) === 1 && (await under.getByTestId("pipeline-table").innerText()).includes("Bonnie Borrower"));
  await under.getByTestId("pipeline-team").selectOption("all");
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower sees who's on the loan and how to reach them", (await borrower.getByTestId("your-team").innerText()).includes("Ursula Under") && (await borrower.getByTestId("your-team").innerText()).includes("Percy Processor") && (await borrower.getByTestId("your-team").getByRole("link", { name: "Email" }).first().getAttribute("href")) === `mailto:under@${DOMAIN}`);
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
  // Once it's sent it sits under Submitted.
  await borrower.getByTestId("docs-tab-submitted").click();
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
  ok("a term sheet waits for the credit review", (await under.getByTestId("stage-blockers").innerText()).includes("Credit review isn't signed off") && (await under.getByTestId("advance-loan").count()) === 0);
  await under.getByTestId("tab-Credit review").click();
  ok("the application was screened against the OFAC list when it arrived", (await under.getByTestId("ofac-panel").innerText()).includes("No match") && !(await under.getByTestId("ofac-panel").innerText()).includes("Not checked yet"));
  const creditFlags = await under.getByTestId("credit-flags").innerText();
  ok("the credit review shows the yes and the unverified deal", creditFlags.includes("Party to a lawsuit") && creditFlags.includes("1 of 1 past deals not verified"));
  ok("with the explanation and the guarantor", (await under.getByTestId("declaration-answers").innerText()).includes("settled in August") && (await under.getByTestId("credit-review").innerText()).includes("Bonnie Borrower"));
  await under.locator("[data-testid^=verify-]").first().check();
  await seen(under.getByTestId("experience-effect").getByText("Signing off prices it on 1 verified"));
  await under.getByTestId("credit-note").fill("Settlement agreement reviewed 5521.");
  await under.getByTestId("sign-off-credit").click();
  ok("the underwriter signs off the credit review", await seen(under.getByTestId("credit-signed")));
  // The term sheet: priced below the matrix, it waits for an owner other than the underwriter. The borrower asks for
  // changes to version 1 and accepts version 2, which locks the rate.
  await under.getByTestId("build-term-sheet").click();
  await seen(under.getByTestId("term-sheet-builder"));
  const matrixLow = Number((await under.getByTestId("sheet-rate").locator("xpath=..").innerText()).match(/Matrix ([\d.]+)%/)[1]);
  const belowMatrix = (matrixLow - 0.5).toFixed(2);
  await under.getByTestId("sheet-rate").fill(belowMatrix);
  ok("pricing below the matrix can't go out on the underwriter's say", (await seen(under.getByTestId("sheet-exception"))) && (await under.getByTestId("issue-term-sheet").isDisabled()));
  await under.getByTestId("exception-reason").fill("Matching a competing offer 6620");
  await under.getByTestId("request-exception").click();
  ok("the underwriter asks an owner for an exception", await seen(under.getByTestId("pricing-exception").getByText("Waiting for an owner")));
  ok("the owner is told", (await prisma.notification.count({ where: { toEmail: `owner@${DOMAIN}`, eventCode: "pricing.exception_requested" } })) === 1);
  await go(owner, dealHref);
  await owner.getByTestId("tab-Term sheet").click();
  await owner.getByTestId("approve-exception").click();
  ok("an owner approves it, and who did is kept", await seen(owner.getByTestId("exception-decision").getByText("Approved by Owen Owner")));
  await go(under, dealHref);
  await under.getByTestId("build-term-sheet").click();
  await under.getByTestId("sheet-rate").fill(belowMatrix);
  await under.getByTestId("issue-term-sheet").click();
  ok("the underwriter sends version 1 at the approved rate", await seen(under.getByTestId("term-sheet-version").getByText(`Version 1`)));
  ok("staff move the loan to a term sheet", await seen(under.getByTestId("stage-panel").getByText("Waiting for the borrower")));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the credit officer's notes never reach the borrower", !(await received(borrower)).includes("reviewed 5521"));
  ok("nor the reason for the exception", !(await received(borrower)).includes("competing offer 6620"));
  const firstSheet = await borrower.request.get(BASE + (await borrower.getByTestId("term-sheet-download").getAttribute("href")));
  ok("the borrower downloads the term sheet as a PDF", firstSheet.headers()["content-type"] === "application/pdf" && (await firstSheet.body()).subarray(0, 5).toString() === "%PDF-");
  await borrower.getByTestId("term-sheet-mode-changes").click();
  await borrower.getByTestId("term-sheet-note").fill("Could the points come down a little?");
  await borrower.getByTestId("request-term-sheet-changes").click();
  ok("the borrower asks for changes, which sends it back to underwriting", await seen(borrower.getByTestId("term-sheet-changes")));
  await go(under, dealHref);
  await under.getByTestId("build-term-sheet").click();
  ok("the underwriter sees what they asked for", (await under.getByTestId("term-sheet-response").first().innerText()).includes("points come down"));
  await under.getByTestId("sheet-rate").fill(String(matrixLow));
  await under.getByTestId("issue-term-sheet").click();
  ok("version 2 goes out", await seen(under.getByTestId("term-sheet-version").getByText("Version 2")));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower sees version 2", await seen(borrower.getByText("Term sheet, version 2")));
  ok("and can't open version 1 any more", (await borrower.request.get(`${BASE}/api/term-sheets/${dealId}?v=1`)).status() === 404);
  await borrower.getByTestId("term-sheet-name").fill("Bonnie Borrower");
  await borrower.getByTestId("term-sheet-agree").check();
  await borrower.getByTestId("accept-term-sheet").click();
  ok("the borrower accepts it from their own browser", await seen(borrower.getByTestId("term-sheet-signed")));
  // The closing now needs their title/escrow and insurance agents: asked for straight away.
  ok("the borrower is asked for their title and insurance agents", await seen(borrower.getByTestId("agents-prompt")));
  await borrower.getByTestId("prompt-title-name").fill("Tia Title");
  await borrower.getByTestId("prompt-title-company").fill("Borrower's Title LLC");
  await borrower.getByTestId("prompt-title-email").fill(`tia@${DOMAIN}`);
  await borrower.getByTestId("prompt-insurance-company").fill("Real Insurance Co");
  await borrower.getByTestId("prompt-insurance-phone").fill("(555) 010-0700");
  await borrower.getByTestId("agents-prompt-save").click();
  ok("and they're kept on the loan", (await borrower.getByTestId("agents-prompt").waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false)) && (await seen(borrower.getByTestId("agent-insurance-saved").getByText("Real Insurance Co"))));
  ok("encrypted with the rest of the loan", !(await rawRows("BookRecord")).includes("Borrower's Title LLC"));
  await go(under, dealHref);
  await under.getByTestId("tab-Term sheet").click();
  ok("acceptance locks the rate and points", (await under.getByTestId("term-sheet-builder").innerText()).includes("locked at what the borrower accepted"));
  await go(under, dealHref);
  await under.getByTestId("advance-loan").filter({ hasText: "Start clearing conditions" }).click();
  ok("the loan can't clear to close yet", await seen(under.getByTestId("stage-blockers").getByText("still open")));

  // Conditions: the library's standard ones arrive. The borrower sends theirs, one is sent back and comes in again, and
  // the team waives one and clears the rest before the loan can clear to close.
  ok("starting conditions adds the library's standard ones", await seen(under.getByTestId("stage-blockers").getByText(/conditions to clear before closing/)));
  ok("and the borrower hears what's theirs", (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "condition.added" } })) === 1);
  await go(borrower, `/admin/borrower/${dealId}`);
  await seen(borrower.getByTestId("my-conditions"));
  const myConditions = borrower.getByTestId("my-condition");
  const borrowerItems = await myConditions.count();
  const sendCondition = async (row, name) => {
    const chooser = borrower.waitForEvent("filechooser");
    await row.getByTestId("condition-upload").click();
    await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 condition") });
    return seen(row.getByText("We're reviewing it"));
  };
  for (let i = 0; i < borrowerItems; i++) await sendCondition(myConditions.nth(i), `condition-${i}.pdf`);
  ok("the borrower sends a file for each of theirs", borrowerItems >= 3 && (await borrower.getByTestId("my-conditions").getByText("We're reviewing it").count()) === borrowerItems);
  ok("the files are stored encrypted", (await prisma.document.count({ where: { documentType: "condition" } })) === borrowerItems && !(await rawRows("Document")).includes("condition-0.pdf"));
  ok("the team is told each one came in", (await prisma.notification.count({ where: { toEmail: `owner@${DOMAIN}`, eventCode: "condition.submitted" } })) === borrowerItems);
  await go(under, dealHref);
  await under.getByTestId("tab-Conditions").click();
  const insurance = under.getByTestId("condition-row").filter({ hasText: "Insurance naming LendHous" });
  await insurance.getByTestId("return-condition").click();
  await under.getByTestId("condition-text").fill("The binder doesn't name LendHous as mortgagee.");
  await under.getByTestId("confirm-condition").click();
  ok("a file sent back reopens the condition with why", await seen(insurance.getByText("Sent back by Ursula Under")));
  await go(borrower, `/admin/borrower/${dealId}`);
  const again = borrower.getByTestId("my-condition").filter({ hasText: "Insurance naming LendHous" });
  ok("the borrower sees why", (await again.getByTestId("condition-returned").innerText()).includes("mortgagee"));
  ok("and sends it again", await sendCondition(again, "binder-corrected.pdf"));
  await go(under, dealHref);
  await under.getByTestId("tab-Conditions").click();
  const titleCondition = under.getByTestId("condition-row").filter({ hasText: "Title commitment reviewed" });
  await titleCondition.getByTestId("waive-condition").click();
  await under.getByTestId("condition-text").fill("Handled through the title company's checklist");
  await under.getByTestId("confirm-condition").click();
  await seen(titleCondition.getByText(/Waived by Ursula Under/));
  const beforeClosing = under.locator("section").filter({ has: under.getByRole("heading", { name: /^Prior to/ }) }).getByTestId("condition-row").filter({ has: under.getByTestId("clear-condition") });
  // Like the waives above: each clear is saved before the next click, and a click a redraw swallowed is tried again.
  for (let left = await beforeClosing.count(), tries = 0; left > 0 && tries < 20; left = await beforeClosing.count(), tries++) {
    await beforeClosing.first().getByTestId("clear-condition").click();
    if (!(await seen(under.getByTestId("confirm-condition"), 5000))) continue;
    if (!(await under.getByTestId("confirm-condition").click({ timeout: 5000 }).then(() => true, () => false))) continue;
    for (let wait = 0; wait < 40 && (await beforeClosing.count()) >= left; wait++) await under.waitForTimeout(250);
  }
  ok("the team clears or waives everything before closing", await seen(under.getByTestId("conditions-summary").getByText("Everything before closing is cleared or waived")));
  ok("the borrower hears theirs clear", (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "condition.cleared" } })) === borrowerItems);
  ok("conditions no longer hold up clear to close", !(await under.getByTestId("stage-blockers").innerText()).includes("conditions to clear"));

  // Documents, capital, closing
  await under.getByTestId("tab-Documents").click();
  await under.getByRole("button", { name: "Accept" }).first().click();
  for (const id of ["id", "entity", "ein", "contract", "sow", "insurance", "track"]) {
    const waive = under.getByTestId(`waive-${id}`);
    if (await waive.count()) await waive.click();
    await under.waitForTimeout(150);
  }
  // The borrower's items are done; the closing checklist is the title company's to send through its link.
  // Each waive is saved before the next click, so a reply landing mid-click can't detach the button being clicked.
  const waiveSelector = "[data-testid^='waive-']:not([data-testid^='waive-closing-'])";
  const waives = under.locator(waiveSelector);
  for (let left = await waives.count(), tries = 0; left > 0 && tries < 30; tries++) {
    await waives.first().click();
    await under.waitForFunction(([selector, before]) => document.querySelectorAll(selector).length < before, [waiveSelector, left], { timeout: 10_000 }).catch(() => {});
    left = await waives.count();
  }
  // Accepting works the same way: each one is saved before the next click.
  const acceptAll = async () => {
    const reviews = under.getByRole("button", { name: "Accept", exact: true });
    for (let left = await reviews.count(), tries = 0; left > 0 && tries < 30; tries++) {
      await reviews.first().click();
      await under.waitForFunction((before) => [...document.querySelectorAll("button")].filter((button) => button.textContent === "Accept").length < before, left, { timeout: 10_000 }).catch(() => {});
      left = await reviews.count();
    }
  };
  await acceptAll();
  await under.getByTestId("tab-Capital Routing").click();
  await under.getByTestId("route-in_house").click();
  await under.getByTestId("apply-route").click();
  await seen(under.getByTestId("commit"));
  await under.getByTestId("commit").click();
  await gone(under.getByTestId("commit"));
  ok("the loan waits on the title company's documents", await seen(under.getByTestId("stage-blockers").getByText("3 documents still open")));

  // The title company's secure link: it sends the closing documents and its own wire instructions; nobody here types them.
  await under.getByTestId("tab-Closing").click();
  await seen(under.getByTestId("borrower-title-agent"));
  await under.getByTestId("use-borrower-agent").click();
  ok("the team can start the closing agent from the borrower's title agent", (await under.getByTestId("agent-company").inputValue()) === "Borrower's Title LLC" && (await under.getByTestId("agent-email").inputValue()) === `tia@${DOMAIN}`);
  await under.getByTestId("agent-company").fill("Real Title LLC");
  await under.getByTestId("agent-contact").fill("Terry Title");
  await under.getByTestId("agent-email").fill(`title@${DOMAIN}`);
  await under.getByTestId("agent-phone").fill("(305) 555-0199");
  await under.getByTestId("save-agent").click();
  await seen(under.getByTestId("closing-agent"));
  await under.getByTestId("open-title-link").click();
  await under.getByTestId("send-title-link").click();
  await seen(under.getByTestId("title-link-url"));
  const titleLink = await under.getByTestId("title-link-url").inputValue();
  ok("staff send the title company its secure link", titleLink.includes("/closing/") && (await prisma.notification.count({ where: { toEmail: `title@${DOMAIN}`, eventCode: "closing.link" } })) === 1);
  ok("and wait for title to enter the wire, instead of typing it", await seen(under.getByTestId("wire-waiting-title")));
  const titleContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const title = await titleContext.newPage();
  title.on("pageerror", (error) => errors.push(`title: ${error.message}`));
  await title.goto(BASE + new URL(titleLink).pathname);
  const titleHtml = await title.content();
  ok("the title company sees the closing file and nothing else", (await title.getByTestId("title-summary").innerText()).includes("LH-1001") && !titleHtml.includes("reviewed 5521") && !titleHtml.includes("settled in August") && !titleHtml.includes("Team only remark"));
  const titleUpload = async (docId, name) => {
    await title.getByTestId(`title-upload-${docId}`).waitFor();
    const chooser = title.waitForEvent("filechooser");
    await title.getByTestId(`title-upload-${docId}`).click();
    await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4 ${name}`) });
    return seen(title.getByTestId(`title-item-${docId}`).getByText(/being checked/i));
  };
  ok("title uploads the commitment, the CPL and the settlement statement", (await titleUpload("closing-title", "Commitment RT-1.pdf")) && (await titleUpload("closing-cpl", "CPL RT-1.pdf")) && (await titleUpload("closing-settlement", "Settlement RT-1.pdf")));
  await title.getByTestId("title-wire-bankName").fill("Smoke Test Bank");
  await title.getByTestId("title-wire-beneficiary").fill("Real Title LLC Escrow");
  await title.getByTestId("title-wire-routing").fill("123456789");
  ok("a mistyped routing number is caught", await seen(title.getByTestId("title-wire-blocked").getByText("routing number isn't valid")));
  await title.getByTestId("title-wire-routing").fill("123456780");
  await title.getByTestId("title-wire-account").fill("5544332211");
  await title.getByTestId("title-wire-confirm").fill("5544332211");
  await title.getByTestId("title-save-wire").click();
  ok("title enters its own escrow wire instructions", await seen(title.getByTestId("title-wire").getByText(/waiting for LendHous to call/i)));
  await go(under, dealHref);
  await under.getByTestId("tab-Documents").click();
  await acceptAll();
  await under.getByTestId("advance-loan").filter({ hasText: "Mark clear to close" }).click();
  await under.getByTestId("advance-loan").filter({ hasText: "Send to closing" }).click();
  await seen(under.getByTestId("stage-blockers").getByText("Signed loan documents not accepted yet"));
  ok("at closing, funding waits on the signed loan documents and the call-back", (await under.getByTestId("stage-blockers").innerText()).includes("haven't been verified by a call-back") && (await under.getByTestId("approve-funding").count()) === 0);
  ok("title sends the signed loan documents", await titleUpload("closing-loan-docs", "Signed loan documents RT-1.pdf"));
  await go(under, dealHref);
  await under.getByTestId("tab-Documents").click();
  await acceptAll();
  await under.getByTestId("tab-Closing").click();
  await seen(under.getByTestId("active-wire"));
  ok("the wire title entered still needs LendHous's call-back", (await under.getByTestId("active-wire").innerText()).includes("Terry Title (title company)") && (await under.getByTestId("closing-panel").innerText()).includes("Not verified"));
  ok("and the team is told to verify it", (await prisma.notification.count({ where: { eventCode: "wire.entered" } })) >= 1);
  ok("the account number is stored encrypted", !(await rawRows("BookRecord")).includes("5544332211"));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower never receives the wire instructions", !(await received(borrower)).includes("5544332211") && (await borrower.getByTestId("borrower-closing").innerText()).includes("Real Title LLC"));
  await go(owner, dealHref);
  await owner.getByTestId("tab-Closing").click();
  await owner.getByTestId("verify-phone").fill("(305) 555-0100");
  await owner.getByTestId("verify-phone-source").selectOption("Title company's website");
  await owner.getByTestId("verify-spoke-with").fill("Rita Escrow");
  await owner.getByTestId("verify-read-back").check();
  await owner.getByTestId("confirm-verify-wire").click();
  ok("a second person verifies the wire by call-back", await seen(owner.getByTestId("wire-verified")));
  // The property is insured before it funds: the flood zone, then a hazard policy with wind, naming LendHous.
  ok("funding waits on the insurance", (await owner.getByTestId("stage-blockers").innerText()).includes("No hazard or builder's risk policy on file"));
  await owner.getByTestId("flood-sfha").selectOption("no");
  await owner.getByTestId("flood-zone-code").fill("X");
  await owner.getByTestId("save-flood").click();
  await seen(owner.getByTestId("flood-zone"));
  await owner.getByTestId("insurance-carrier").fill("Gulf Builders Mutual");
  await owner.getByTestId("insurance-policy").fill("GBM-77");
  await owner.getByTestId("insurance-expires").fill(new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10));
  await owner.getByTestId("insurance-coverage").fill("600000");
  await owner.getByTestId("insurance-wind").check();
  await owner.getByTestId("insurance-mortgagee").check();
  await owner.getByTestId("save-insurance").click();
  await seen(owner.getByTestId("insurance-summary"));
  ok("with the policy on file, nothing about insurance holds funding", !/policy|flood zone/.test(await owner.getByTestId("stage-blockers").innerText()));
  await go(under, dealHref);
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
  // Before the policy ends, the borrower sends the renewal from the loan page and the team accepts it.
  await go(borrower, `/admin/borrower/${dealId}`);
  await borrower.getByTestId("send-renewal").click();
  await borrower.getByTestId("renewal-kind").selectOption("hazard");
  await borrower.getByTestId("renewal-policy").fill("GBM-78");
  await borrower.getByTestId("renewal-expires").fill(new Date(Date.now() + 540 * 86_400_000).toISOString().slice(0, 10));
  await borrower.getByTestId("renewal-file").setInputFiles({ name: "renewal-declarations.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 renewal") });
  await borrower.getByTestId("submit-renewal").click();
  ok("the borrower sends their insurance renewal", await seen(borrower.getByTestId("renewal-sent")));
  ok("it's stored encrypted, and the team is told", (await prisma.document.count({ where: { documentType: "insurance_renewal" } })) === 1 && !(await rawRows("Document")).includes("renewal-declarations.pdf") && (await prisma.notification.count({ where: { eventCode: "insurance.renewal_sent" } })) >= 1);
  await go(owner, dealHref);
  await owner.getByTestId("tab-Servicing").click();
  await owner.getByTestId("insurance-renewal").getByTestId("renewal-mortgagee").check();
  await owner.getByTestId("insurance-renewal").getByTestId("accept-renewal").click();
  ok("the team accepts it, and it's the policy on file", await seen(owner.getByTestId("insurance-summary").getByText(/GBM-78/)));
  ok("and the borrower hears", (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "insurance.renewal_accepted" } })) === 1);
  // After funding, title confirms the money reached escrow and where the mortgage was recorded.
  await title.goto(BASE + new URL(titleLink).pathname);
  await title.getByTestId("title-funds-amount").fill("250000");
  await title.getByTestId("title-funds-on").fill(new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  await title.getByTestId("title-confirm-funds").click();
  ok("title confirms the funds reached escrow", await seen(title.getByTestId("title-funds-done")));
  await title.getByTestId("title-recorded-on").fill(new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  await title.getByTestId("title-recorded-reference").fill("OR Book 999 Page 1");
  await title.getByTestId("title-save-recording").click();
  ok("and records where the mortgage was recorded", await seen(title.getByTestId("title-recorded")));
  await titleContext.close();
  await go(owner, dealHref);
  await owner.getByTestId("tab-Closing").click();
  ok("staff see what title confirmed", (await owner.getByTestId("title-confirmations").innerText()).includes("OR Book 999 Page 1"));
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
  // Florida's lien law holds the money: the lien file goes in on the Closing tab, a supplier's notice to owner is logged,
  // the borrower sends both waivers, and the team checks them against the statutory form.
  ok("an approved draw is held until the lien law is met", (await seen(card.getByTestId("release-held"))) && (await card.getByTestId("draw-holds").innerText()).includes("No Notice of Commencement"));
  await go(owner, `/admin/deals/${dealId}`);
  await owner.getByTestId("tab-Closing").click();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await owner.getByTestId("lien-contractor").fill("Carl's Construction LLC");
  await owner.getByTestId("noc-recorded").fill(today);
  await owner.getByTestId("noc-reference").fill("OR 2026/11 1234");
  await owner.getByTestId("noc-commenced").fill(today);
  await owner.getByTestId("noc-lender-named").check();
  ok("a notice recorded the same day as the mortgage needs the order checked", await seen(owner.getByTestId("noc-mortgage-first")));
  await owner.getByTestId("noc-mortgage-first").check();
  await owner.getByTestId("save-noc").click();
  ok("the Notice of Commencement is on file, after the mortgage", (await seen(owner.getByTestId("noc-summary"))) && (await owner.getByTestId("noc-problems").count()) === 0);
  await owner.getByTestId("add-notice").click();
  await owner.getByTestId("notice-lienor").fill("Sunny Supply Co");
  await owner.getByTestId("notice-role").selectOption("supplier");
  await owner.getByTestId("notice-served").fill(today);
  await owner.getByTestId("save-notice").click();
  ok("a notice to owner is logged, and the borrower is told", (await seen(owner.getByTestId("notices-to-owner").getByText("Sunny Supply Co"))) && (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "lien.notice_to_owner" } })) === 1);
  await go(borrower, `/admin/borrower/${dealId}`);
  const lienParties = borrower.getByTestId("lien-party");
  ok("the borrower sees the waivers this draw needs", (await seen(borrower.getByTestId("draw-lien"))) && (await lienParties.count()) === 2);
  for (const [index, name] of [[0, "contractor-waiver.pdf"], [1, "supplier-waiver.pdf"]]) {
    const chooser = borrower.waitForEvent("filechooser");
    await lienParties.nth(index).getByTestId("lien-upload").click();
    await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 waiver") });
    await seen(lienParties.nth(index).getByText("We're checking it"));
  }
  ok("the borrower sends both", (await borrower.getByTestId("lien-party-status").getByText("We're checking it").count()) === 2);
  ok("the waivers are stored encrypted", (await prisma.document.count({ where: { documentType: "lien_waiver" } })) === 2 && !(await rawRows("Document")).includes("supplier-waiver.pdf"));
  await go(owner, "/admin/draws");
  // Each check saves and redraws the card, so wait for that before the next one.
  for (let left = await card.getByTestId("check-waiver").count(); left > 0; left = await card.getByTestId("check-waiver").count()) {
    await card.getByTestId("waiver-amount").first().fill("5000");
    await card.getByTestId("waiver-through").first().fill(today);
    await card.getByTestId("check-waiver").first().click();
    for (let tries = 0; tries < 40 && (await card.getByTestId("check-waiver").count()) === left; tries++) await owner.waitForTimeout(250);
  }
  ok("the team checks them against the statutory form, which frees the draw", await seen(card.getByTestId("draw-holds").getByText(/Nothing under the lien law/)));
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
  const dueBefore = await loanRow.getByTestId("serviced-next-due").getAttribute("data-day");
  await loanRow.getByTestId("record-payment").click();
  ok("a payment before the first due date pays ahead", (await owner.getByTestId("payment-preview").innerText()).includes(`Pays ahead the ${new Date(`${dueBefore}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} payment`));
  await owner.getByTestId("payment-reference").fill("FED-SMOKE-1");
  await owner.getByTestId("save-payment").click();
  await owner.waitForFunction((due) => document.querySelector("[data-testid=serviced-next-due]")?.getAttribute("data-day") !== due, dueBefore).catch(() => {});
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("a recorded payment shows for the borrower", (await borrower.getByTestId("next-due").getAttribute("data-day")) !== dueBefore);
  ok("the borrower gets a receipt for the payment", (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "payment.received" } })) === 1);
  ok("the payment's reference is encrypted in the database", !(await rawRows("BookRecord")).includes("FED-SMOKE-1"));
  await go(owner, `/admin/deals/${dealId}`);
  await owner.getByTestId("tab-Servicing").click();
  ok("the loan's ledger shows who recorded the payment", (await owner.getByTestId("ledger-payments").innerText()).includes("Recorded by Owen Owner"));
  await owner.getByTestId("reverse-payment").click();
  await owner.getByTestId("servicing-reason").fill("Wire recalled by the sender's bank");
  await owner.getByTestId("confirm-servicing").click();
  await seen(owner.getByText("Reversed by"));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("a reversed payment puts the due date back for the borrower", (await borrower.getByTestId("next-due").getAttribute("data-day")) === dueBefore);
  // The website's "Recently funded" list: the borrower chooses to show the loan; a visitor sees the city, the program,
  // the amount and the photo, never a name or street address; the team can take it down.
  await borrower.getByTestId("showcase-toggle").click();
  await seen(borrower.getByTestId("showcase-on"));
  const passerby = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await go(passerby, "/");
  const fundedList = passerby.getByTestId("recently-funded");
  ok("a funded loan shows on the home page once its borrower agrees", (await seen(fundedList)) && (await fundedList.innerText()).includes("Hollywood"));
  ok("without the borrower's name, company or street address", !/Bonnie|Real Flips|100 Real Street/.test(await fundedList.innerText()));
  await fundedList.scrollIntoViewIfNeeded();
  ok("with the borrower's photo, served publicly only for this", (await fundedList.locator("img").count()) === 1 && (await loaded(fundedList.locator("img"))));
  await go(owner, `/admin/deals/${dealId}`);
  await owner.getByTestId("showcase-take-down").click();
  await owner.getByTestId("showcase-team").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await go(passerby, "/");
  ok("the team can take it down, and it leaves the site", (await passerby.getByTestId("recently-funded").count()) === 0);
  ok("and its photo stops being served", (await passerby.request.get(`${BASE}/api/showcase/${dealId}`)).status() === 404);
  await passerby.context().close();
  // Payoff letters (Fla. Stat. 701.04): the borrower asks in the portal, servicing sends an itemized letter as a PDF.
  await borrower.getByTestId("request-payoff").click();
  ok("the borrower asks for a payoff letter and sees when it's due", (await seen(borrower.getByTestId("my-payoffs"))) && (await borrower.getByTestId("my-payoffs").innerText()).includes("send it by"));
  await go(owner, "/admin/servicing");
  const ownPayoff = owner.getByTestId("payoff-row").filter({ hasText: "LH-1001" });
  ok("the payoff request reaches servicing with Florida's deadline", (await seen(ownPayoff)) && (await ownPayoff.getByTestId("payoff-due").innerText()).includes("Florida gives 10 days"));
  await ownPayoff.getByTestId("open-payoff").click();
  await owner.getByTestId("payoff-card").getByTestId("issue-payoff-letter").click();
  ok("the letter is sent and how sending went is kept", await seen(owner.getByTestId("letter-delivery").getByText(/Emailed to|wasn't emailed/)));
  await owner.keyboard.press("Escape");
  await go(borrower, `/admin/borrower/${dealId}`);
  const myLetter = await borrower.getByTestId("my-letter-pdf").getAttribute("href");
  const letterFile = await borrower.request.get(BASE + myLetter);
  ok("the borrower opens their payoff letter as a PDF", letterFile.headers()["content-type"] === "application/pdf" && (await letterFile.body()).subarray(0, 5).toString() === "%PDF-");
  ok("nobody signed out can", (await (await browser.newContext()).request.get(BASE + myLetter, { maxRedirects: 0 })).status() === 401);

  // A title company asks through the public form with the borrower's signed authorization, and the borrower is told.
  const payoffTitleContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const payoffTitle = await payoffTitleContext.newPage();
  await payoffTitle.goto(BASE + "/payoff");
  await payoffTitle.getByTestId("payoff-kind-title").click();
  await payoffTitle.getByTestId("payoff-loanNumber").fill("LH-1001");
  await payoffTitle.getByTestId("payoff-zip").fill("33020");
  await payoffTitle.getByTestId("payoff-goodThrough").fill(new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10));
  await payoffTitle.getByTestId("payoff-name").fill("Sunny Closer");
  await payoffTitle.getByTestId("payoff-company").fill("Sunshine Title");
  await payoffTitle.getByTestId("payoff-email").fill(`payoffs@${DOMAIN}`);
  await payoffTitle.getByTestId("payoff-fileNumber").fill("SUN-2026-77");
  await payoffTitle.getByTestId("payoff-authorization").setInputFiles({ name: "borrower-authorization.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 signed by the borrower") });
  await payoffTitle.getByTestId("payoff-request-submit").click();
  ok("a title company asks for a payoff letter without an account", await seen(payoffTitle.getByTestId("payoff-request-sent")));
  ok("and gets a receipt with the due date", (await prisma.notification.count({ where: { toEmail: `payoffs@${DOMAIN}`, eventCode: "payoff.received" } })) === 1);
  ok("the borrower is told someone else asked", (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "payoff.third_party" } })) === 1);
  await go(owner, "/admin/servicing");
  await owner.getByTestId("payoff-row").filter({ hasText: "Sunshine Title" }).getByTestId("open-payoff").click();
  const payoffCard = owner.getByTestId("payoff-card");
  ok("its authorization has to be checked before the letter can go", (await seen(payoffCard.getByTestId("payoff-authorization-file"))) && (await payoffCard.getByTestId("issue-payoff-letter").count()) === 0);
  ok("staff can open the authorization", (await owner.request.get(BASE + (await payoffCard.getByTestId("payoff-authorization-file").getAttribute("href")))).status() === 200);
  ok("the authorization's file name is encrypted", !(await rawRows("Document")).includes("borrower-authorization.pdf"));
  await payoffCard.getByTestId("payoff-check-note").fill("Signed by the managing member");
  await payoffCard.getByTestId("payoff-check-accept").click();
  await payoffCard.getByTestId("issue-payoff-letter").click();
  ok("the title company's letter goes out once it's checked", await seen(payoffCard.getByTestId("letter-row")));
  await owner.keyboard.press("Escape");
  // A payment after the letters lowers the payoff: both letters are flagged and the team is told; one is corrected.
  await go(owner, `/admin/deals/${dealId}`);
  await owner.getByTestId("tab-Servicing").click();
  await owner.getByTestId("payment-amount").fill("500");
  await owner.getByTestId("payment-reference").fill("FED-SMOKE-2");
  await owner.getByTestId("save-payment").click();
  ok("a payment after the letters flags them as out of date", await seen(owner.getByTestId("payoff-stale")));
  ok("the team hears a letter is out of date", (await prisma.notification.count({ where: { toEmail: `owner@${DOMAIN}`, eventCode: "payoff.stale" } })) === 2);
  const staleCard = owner.getByTestId("payoff-card").filter({ hasText: "Sunshine Title" });
  await staleCard.getByTestId("issue-payoff-letter").click();
  ok("a corrected letter goes out", (await seen(staleCard.getByText("(corrected)"))) && (await staleCard.getByTestId("payoff-stale").count()) === 0);
  await payoffTitleContext.close();
  ok("the borrower is told when they can ask for more time", (await borrower.getByTestId("extension-not-yet").innerText()).includes("before maturity"));

  // New pricing: the owner publishes a version, the funded loan keeps its own, and the next application gets the new one
  await go(owner, "/admin/pricing");
  await seen(owner.getByTestId("pricing-editor"));
  await owner.getByTestId("flip-2-ltc").fill("82.5");
  ok("the pricing editor lists what changed", (await owner.getByTestId("pricing-changes").innerText()).includes("fixFlip.tiers.2.maxLTC: 0.85 → 0.825"));
  ok("pricing can't be published without saying why", await owner.getByTestId("publish-pricing").isDisabled());
  await owner.getByTestId("pricing-note").fill("Tier 2 flips to 82.5% LTC (smoke test)");
  await owner.getByTestId("publish-pricing").click();
  ok("the owner publishes new pricing", await seen(owner.getByTestId("pricing-history").getByText("Tier 2 flips to 82.5% LTC")));
  const published = await prisma.pricingVersion.findFirst();
  ok("it's saved as a new version and audited", Boolean(published) && (await prisma.auditEvent.count({ where: { action: "pricing.published", entityId: published?.version } })) === 1);
  await go(owner, `/admin/deals/${dealId}`);
  ok("the funded loan keeps the pricing it was priced on", (await owner.locator("main").innerText()).includes("pricing PLACEHOLDER-"));

  // A website brief becomes a loan, and the photo sent with it comes along. The key stands in for the one the quote
  // form hands the visitor's browser.
  const photoKey = randomBytes(24).toString("base64url");
  await prisma.lead.update({ where: { id: lead.id }, data: { photoKeyHash: createHash("sha256").update(photoKey).digest("hex"), photoKeyExpiresAt: new Date(Date.now() + 3_600_000) } });
  const sentPhoto = await owner.request.post(`${BASE}/api/lead-photos`, { multipart: { key: photoKey, file: { name: "lena-front.jpg", mimeType: "image/jpeg", buffer: housePhoto } } });
  ok("a quote's photo goes up with its key", sentPhoto.status() === 200);
  ok("and not without it", (await owner.request.post(`${BASE}/api/lead-photos`, { multipart: { key: "wrong-key", file: { name: "x.jpg", mimeType: "image/jpeg", buffer: housePhoto } } })).status() === 403);
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
  ok("and whoever starts it is its loan officer", (await owner.getByTestId("assign-officer").evaluate((select) => select.selectedOptions[0]?.text ?? "")) === "Owen Owner");
  ok("the client is invited to the portal", invited?.roles[0]?.role === "BORROWER" && invited.passwordLinks.length === 1);
  const leadRow = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  ok("the brief links to its loan", leadRow.loanId === leadDealId && Boolean(leadRow.contactedAt));
  ok("its photo moves to the loan", (await prisma.document.count({ where: { ownerType: "LOAN", ownerId: leadDealId, documentType: "property_photo" } })) === 1 && (await prisma.document.count({ where: { ownerType: "LEAD", ownerId: lead.id } })) === 0);
  await owner.getByTestId("tab-Documents").click();
  ok("and shows on the loan's documents", (await seen(owner.getByTestId("property-photo"))) && (await loaded(owner.getByTestId("property-photo").locator("img"))));
  await go(owner, leadDeal);
  await owner.getByTestId("tab-Credit review").click();
  ok("a loan started from a call waits for the borrower's profile", (await owner.getByTestId("credit-flags").innerText()).includes("No borrower profile"));
  await owner.getByTestId("tab-Numbers & Ratios").click();
  ok("a new application is priced on the new version", (await owner.locator("main").innerText()).includes(`pricing ${published?.version}`));
  await go(owner, "/admin/leads");
  ok("the leads page opens the loan", (await owner.locator("tr", { hasText: "Lena Lead" }).getByTestId("lead-loan").getAttribute("href")) === leadDeal);
  // The business reports, on loans that were all started today, so each one is an application this month.
  await go(owner, "/admin/reports");
  await seen(owner.getByTestId("reports"));
  const loansSoFar = await prisma.bookRecord.count({ where: { kind: "deals" } });
  ok(`the reports count every application started today (${loansSoFar})`, Number((await owner.getByTestId("kpi-applications").innerText()).split("\n")[1]) === loansSoFar && (await owner.getByTestId("reports-undated").count()) === 0);
  const [reportFile] = await Promise.all([owner.waitForEvent("download"), owner.getByTestId("export-loans").click()]);
  const reportCsv = readFileSync(await reportFile.path(), "utf8");
  ok("the owner downloads every loan with the day it applied", reportCsv.includes("LH-1001") && reportCsv.includes("Bonnie Borrower") && reportCsv.includes(new Date().toISOString().slice(0, 4)));
  await go(under, "/admin/reports");
  ok("an underwriter can't open the reports by default", path(under) === "/admin" && (await under.getByRole("link", { name: "Reports" }).count()) === 0);
  // Declining it: the client is told, the team's notes stay encrypted and out of the email, and it can be reopened.
  // The Reg B notice needs LendHous's address, which lives in Settings.
  await go(owner, "/admin/settings");
  await owner.getByTestId("setting-address").fill("100 Smoke Test Way, Fort Lauderdale, FL 33301");
  await owner.getByTestId("setting-phone").fill("(954) 555-0100");
  await owner.getByRole("button", { name: "Save settings" }).click();
  await owner.waitForURL("**notice=settings_saved*");
  await go(owner, leadDeal);
  await owner.getByTestId("close-application").click();
  await owner.getByTestId("close-reason").selectOption("incomplete");
  await owner.getByTestId("close-note").fill("SMOKE-DECLINE-NOTE never sent the bank statements");
  await owner.getByTestId("close-revenue").fill("650000");
  await owner.getByTestId("confirm-close").click();
  ok("staff decline an application", await seen(owner.getByTestId("application-closed")));
  const notice = owner.getByTestId("adverse-action");
  ok("the decline starts the Reg B notice, due in 30 days for a business of $1 million or less", (await seen(notice.getByTestId("notice-due"))) && (await notice.innerText()).includes("$1,000,000 or less"));
  ok("the team is told when it's due", (await prisma.notification.count({ where: { toEmail: `owner@${DOMAIN}`, eventCode: "adverse_action.due" } })) === 1);
  await notice.getByTestId("notice-reason-0").fill("Incomplete application: the two most recent bank statements weren't provided");
  await notice.getByTestId("save-reasons").click();
  await owner.waitForTimeout(400);
  const letterUrl = `${BASE}/api/adverse-action/${leadDealId}?kind=notice`;
  const preview = await owner.request.get(letterUrl);
  ok("staff preview the notice as a PDF", preview.headers()["content-type"] === "application/pdf" && (await preview.body()).subarray(0, 5).toString() === "%PDF-");
  ok("nobody signed out can open it", (await (await browser.newContext()).request.get(letterUrl, { maxRedirects: 0 })).status() === 401);
  // Emailed to a linked account; a client not linked to one gets it by mail.
  const canEmail = (await notice.getByTestId("email-notice").count()) > 0;
  await notice.getByTestId(canEmail ? "email-notice" : "mail-notice").click();
  const noticeOut = await seen(notice.getByTestId("notice-sent"));
  if (!noticeOut) console.log("the notice panel said:", await notice.getByRole("alert").allInnerTexts().catch(() => []));
  ok(`the notice goes out (${canEmail ? "emailed" : "marked mailed"}) and is recorded`, noticeOut);
  ok("its reasons are encrypted in the database", !(await rawRows("BookRecord")).includes("two most recent bank statements"));
  ok("the send is in the audit log", (await prisma.auditEvent.count({ where: { action: "adverse_action.notice_sent", entityId: leadDealId } })) === 1);
  const declinedMail = await prisma.notification.findMany({ where: { toEmail: `lena@${DOMAIN}`, eventCode: "loan.declined" } });
  ok("the client is told it was declined, without the team's notes", declinedMail.length === 1 && !JSON.stringify(declinedMail).includes("SMOKE-DECLINE-NOTE"));
  ok("the decline notes are encrypted in the database", !(await rawRows("BookRecord")).includes("SMOKE-DECLINE-NOTE"));
  await owner.getByTestId("reopen-application").click();
  ok("a declined application can be reopened", await seen(owner.getByTestId("stage-panel")));

  // A partner lender, blind until they win
  await go(partner, "/admin/partner");
  ok("a partner sees nothing until set up", await seen(partner.getByTestId("no-partner-org")));
  await go(owner, "/admin/partners");
  await owner.getByTestId("firm-row").filter({ hasText: `partner@${DOMAIN}` }).getByTestId("edit-firm").click();
  await owner.getByTestId("firm-name").fill("Parker Capital");
  await owner.getByTestId("save-firm").click();
  await seen(owner.getByTestId("firm-row").filter({ hasText: "Parker Capital" }));
  const parker = owner.getByTestId("firm-row").filter({ hasText: "Parker Capital" });
  ok("a partner is screened against the OFAC list when it's saved", await seen(parker.getByTestId("firm-ofac").getByText("Clear")));
  // An owner on the list holds the firm until someone with clear_ofac compares the listing and clears it.
  const reviewsBefore = await prisma.notification.count({ where: { eventCode: "ofac.review" } });
  await parker.getByTestId("edit-firm").click();
  await owner.getByTestId("firm-principals").fill("Paula Parker\nJonathan Doe");
  await owner.getByTestId("save-firm").click();
  ok("with its owners, and a listed name holds it for review", (await seen(parker.getByTestId("firm-ofac-review"))) && (await parker.getByTestId("firm-ofac-hit").innerText()).includes("DOE, Jonathan"));
  ok("and the team is told", (await prisma.notification.count({ where: { eventCode: "ofac.review" } })) > reviewsBefore);
  await parker.getByTestId("firm-ofac-clear").click();
  await parker.getByTestId("firm-ofac-reason").fill("Paula's partner Jonathan Doe was born 1985 in Tampa; the listed one wasn't (smoke)");
  await parker.getByTestId("firm-ofac-decide").click();
  ok("an owner clears it, for the record", await seen(parker.getByTestId("firm-ofac-decided")));
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
  // The buyer's monthly statement, made for this month the way the 1st makes last month's, then downloaded.
  execFileSync("npx", ["tsx", "scripts/make-statements.ts", new Date().toISOString().slice(0, 7)], { stdio: "ignore" });
  await go(buyer, "/admin/buyer/portfolio");
  const statementRow = buyer.getByTestId("statement-row").first();
  ok("the buyer's statement shows in their portfolio", await seen(statementRow));
  const statementHref = await statementRow.getByTestId("statement-pdf").getAttribute("href");
  const statementPdf = await buyer.request.get(BASE + statementHref);
  ok("it downloads as a PDF", statementPdf.status() === 200 && (await statementPdf.body()).subarray(0, 5).toString() === "%PDF-");
  const statementCsv = await buyer.request.get(`${BASE}${statementHref}?format=csv`);
  ok("and as a spreadsheet with the loan on it", statementCsv.status() === 200 && (await statementCsv.text()).includes("LH-1001"));
  ok("another firm can't open it", (await partner.request.get(BASE + statementHref)).status() === 404);
  ok("nor can anyone signed out", (await (await browser.newContext()).request.get(BASE + statementHref)).status() === 401);
  ok("the buyer was emailed that it's ready", (await prisma.notification.count({ where: { toEmail: `buyer@${DOMAIN}`, eventCode: "statement.ready" } })) === 1);
  // The borrower's own monthly statement for the loan, made the same night, with how to pay from Settings.
  await go(borrower, `/admin/borrower/${dealId}`);
  const loanStatement = borrower.getByTestId("loan-statement-row").first();
  ok("the borrower's monthly statement shows on their loan", await seen(loanStatement));
  ok("with how to pay, as the owner set it in Settings", (await borrower.getByTestId("pay-instructions").innerText()).includes("LendHous Servicing (SMOKE)"));
  const loanStatementHref = await loanStatement.getByTestId("loan-statement-pdf").getAttribute("href");
  const loanStatementPdf = await borrower.request.get(BASE + loanStatementHref);
  ok("it downloads as a PDF", loanStatementPdf.status() === 200 && (await loanStatementPdf.body()).subarray(0, 5).toString() === "%PDF-");
  ok("another borrower can't open it", (await other.request.get(BASE + loanStatementHref)).status() === 404);
  ok("nor can anyone signed out", (await (await browser.newContext()).request.get(BASE + loanStatementHref)).status() === 401);
  ok("the borrower was emailed that it's ready", (await prisma.notification.count({ where: { toEmail: `borrower@${DOMAIN}`, eventCode: "statement.ready" } })) === 1);
  ok("its figures are encrypted in the database", !(await rawRows("BorrowerStatement")).includes("LH-1001"));
  // How the loan will end: a sale needs its price and date; then the borrower changes their mind and refinances with LendHous.
  await borrower.getByTestId("exit-choice-sell").check();
  await borrower.getByTestId("exit-confidence-likely").check();
  await borrower.getByTestId("exit-save").click();
  ok("a sale plan needs its list price", (await seen(borrower.getByTestId("exit-error"))) && (await borrower.getByTestId("exit-error").innerText()).includes("list"));
  await borrower.getByTestId("exit-list-price").fill("540000");
  await borrower.getByTestId("exit-sale-by").fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await borrower.getByTestId("exit-save").click();
  ok("the borrower tells LendHous how the loan will end", (await seen(borrower.getByTestId("exit-summary"))) && (await borrower.getByTestId("exit-summary").innerText()).includes("$540,000"));
  await go(owner, "/admin/servicing");
  ok("the team sees it on the maturity desk", (await seen(owner.getByTestId("desk-row").filter({ hasText: "LH-1001" }).getByTestId("desk-plan"))) && (await owner.getByTestId("desk-row").filter({ hasText: "LH-1001" }).innerText()).includes("Selling it"));
  await go(borrower, `/admin/borrower/${dealId}`);
  await borrower.getByTestId("exit-change").click();
  await borrower.getByTestId("exit-choice-refi_lendhous").check();
  await borrower.getByTestId("exit-confidence-sure").check();
  await borrower.getByTestId("exit-save").click();
  await seen(borrower.getByTestId("exit-refi-start"));
  await borrower.getByTestId("exit-refi-start").click();
  ok("refinancing with LendHous starts a rental-loan application from the loan", (await seen(borrower.getByTestId("app-refinance"))) && (await borrower.getByTestId("app-loan-dscr").getAttribute("aria-checked")) === "true");
  // This account has no phone on file, so the first page asks for one, as it did on the first application.
  if (!(await borrower.getByTestId("app-phone").inputValue())) await borrower.getByTestId("app-phone").fill("(555) 010-0500");
  await borrower.getByTestId("app-next").click();
  ok("on the same property", (await borrower.getByTestId("app-address-street").inputValue()) === "100 Real Street");
  await go(borrower, `/admin/borrower/${dealId}`);

  // A broker signs the broker agreement with the firm's papers; an owner approves it before any deal goes in. One of its
  // owners is close to a name on the sanctions list, so approving takes a reason.
  await go(broker, "/admin/broker");
  ok("a new broker is asked to sign the broker agreement first", await seen(broker.getByTestId("broker-agreement")));
  await go(broker, "/admin/broker/new");
  ok("and can't open the deal form until it's approved", await seen(broker.getByTestId("broker-not-approved")));
  await go(broker, "/admin/broker");
  await broker.getByTestId("broker-legal-name").fill("Brook Capital LLC");
  await broker.getByTestId("broker-principals").fill("Brook Broker\nJonathan Doe");
  await broker.getByTestId("broker-nmls").fill("123456");
  await broker.getByTestId("broker-signature").fill("Brook Broker");
  await broker.getByTestId("broker-apply").click();
  ok("the agreement has to be agreed to", await seen(broker.getByTestId("broker-error").getByText(/agree/)));
  await broker.getByTestId("broker-agree").check();
  await broker.getByTestId("broker-apply").click();
  ok("and the firm's papers sent with it", await seen(broker.getByTestId("broker-error").getByText(/articles/)));
  await broker.getByTestId("broker-articles").setInputFiles({ ...PDF, name: "articles.pdf" });
  await broker.getByTestId("broker-good-standing").setInputFiles({ ...PDF, name: "good-standing.pdf" });
  await broker.getByTestId("broker-apply").click();
  ok("the broker signs it and waits for approval", await seen(broker.getByTestId("broker-status").getByText("Waiting for approval"), 20_000));
  ok("the owners are told", (await prisma.notification.count({ where: { toEmail: `owner@${DOMAIN}`, eventCode: "broker.applied" } })) === 1);
  const brokerDocs = await prisma.document.findMany({ where: { ownerType: "BROKER" } });
  ok("its papers are stored encrypted with the firm", brokerDocs.length === 2 && !(await rawRows("Document")).includes("good-standing.pdf"));
  ok("and a borrower can't open them", (await borrower.request.get(`${BASE}/api/documents/${brokerDocs[0].id}`)).status() === 404);
  ok("but the broker can", (await broker.request.get(`${BASE}/api/documents/${brokerDocs[0].id}`)).status() === 200);
  await go(owner, "/admin/brokers");
  const brokerRow = owner.getByTestId("broker-row").filter({ hasText: "Brook Capital LLC" });
  ok("the owners see it waiting, with the possible sanctions match", (await seen(brokerRow)) && (await brokerRow.getByTestId("broker-ofac").innerText()).includes("Possible match") && (await brokerRow.getByTestId("broker-w9").innerText()).includes("Not on file"));
  ok("approving waits on a reason for the match", await brokerRow.getByTestId("broker-approve").isDisabled());
  await brokerRow.getByTestId("broker-clear-reason").fill("Different person: Jonathan Doe is a Florida-born co-founder, date of birth checked.");
  await brokerRow.getByTestId("broker-approve").click();
  ok("an owner approves the brokerage", await seen(owner.getByTestId("broker-row").filter({ hasText: "Brook Capital LLC" }).getByText("Referral link")));
  await go(under, "/admin/brokers");
  ok("an underwriter can't approve brokers", path(under) === "/admin");
  await go(broker, "/admin/broker");
  await seen(broker.getByTestId("referral-url").getByText(/^http/));
  const referralUrl = await broker.getByTestId("referral-url").innerText();
  ok("the approved broker gets a referral link", /\/start\?ref=[a-z2-9]{8}$/.test(referralUrl));
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  client.on("pageerror", (error) => errors.push(`client: ${error.message}`));
  await fillQuote("Riya", `riya@${DOMAIN}`, "Sent by my broker.", new URL(referralUrl).pathname + new URL(referralUrl).search, client);
  ok("a client who follows it sees who referred them", (await client.getByTestId("quote-referral").innerText()).includes("Brook Capital LLC"));
  await client.getByTestId("quote-submit").click();
  await seen(client.getByTestId("quote-sent"));
  const referredLead = await prisma.lead.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  ok("the request is attributed to the brokerage", referredLead.brokerId === (await prisma.user.findUniqueOrThrow({ where: { email: `broker@${DOMAIN}` } })).id);
  await go(owner, "/admin/leads");
  ok("and the team sees who referred it", await seen(owner.getByTestId("leads-table").locator("tr", { hasText: "Riya Visitor" }).getByTestId("lead-referral").getByText(/Brook Capital LLC/)));
  // The broker's quote widget, as it sits on their own site: framed, terms first, saved with their code and the site's name.
  await go(broker, "/admin/broker");
  const referralCode = new URL(referralUrl).searchParams.get("ref");
  await broker.waitForFunction(() => (document.querySelector("[data-testid=embed-code]")?.value ?? "").length > 0, null, { timeout: 5000 }).catch(() => {});
  ok("the broker gets the widget's code with their referral code in it", (await seen(broker.getByTestId("embed-code"))) && (await broker.getByTestId("embed-code").inputValue()).includes(`/embed/quote?ref=${referralCode}`));
  await fillQuote("Wade", `wade@${DOMAIN}`, "From the widget.", `/embed/quote?ref=${referralCode}&site=brookweb`, client);
  ok("the widget is the quote without the site around it", (await seen(client.getByTestId("embed-quote"))) && (await client.locator("header").count()) === 0 && (await client.getByTestId("quote-referral").innerText()).includes("Brook Capital LLC"));
  await client.getByTestId("quote-submit").click();
  await seen(client.getByTestId("quote-sent"));
  const widgetLead = await prisma.lead.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  ok("a quote saved in the widget keeps where it came from and who referred it", widgetLead.channel === "embed:brookweb" && widgetLead.brokerId === referredLead.brokerId);
  await go(owner, "/admin/reports");
  ok("the reports count the quote funnel by channel and broker", (await seen(owner.getByTestId("quote-funnel"))) && (await owner.getByTestId("quote-funnel-row").filter({ hasText: "Quote widget on brookweb, referred by Brook Capital LLC" }).count()) === 1);
  await client.goto(`${BASE}/start?ref=notacode`);
  ok("a made-up code is ignored", (await seen(client.getByTestId("quote-form"))) && (await client.getByTestId("quote-referral").count()) === 0);

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
  const [quotePdf] = await Promise.all([broker.waitForEvent("download"), broker.getByTestId("broker-quote-pdf").click()]);
  ok("the broker downloads a quote for the client with the brokerage's name", quotePdf.suggestedFilename() === "lendhous-quote.pdf" && readFileSync(await quotePdf.path()).subarray(0, 5).toString() === "%PDF-");
  ok("a borrower can't make one", (await borrower.request.post(`${BASE}/api/broker-quote`, { data: {} })).status() === 403);
  for (const c of ["bp", "noo", "consent", "true"]) await broker.getByTestId(`cert-${c}`).check();
  await broker.getByTestId("submit").click();
  await broker.waitForURL("**/admin/broker");
  ok("a broker submits a real deal", await seen(broker.getByTestId("broker-deal").filter({ hasText: "Casey Client" })));
  html = await received(broker);
  ok("a broker receives only their own deals", !html.includes("Bonnie Borrower") && !html.includes("Lena Lead") && !html.includes("Real Fund I"));
  await go(owner, "/admin");
  ok("the broker's deal reaches the team", await seen(owner.getByTestId("pipeline-table").getByText("Casey Client")));
  ok("a borrower's browser never gets other loans", !(await (async () => { await go(borrower, "/admin/borrower"); return received(borrower); })()).includes("Casey Client"));

  // Running unattended: the health check, the owners' warning when a nightly job stops, and the errors page.
  const health = await (await browser.newContext()).request.get(`${BASE}/api/health?watch=jobs`);
  const healthBody = await health.json();
  ok("the health check answers without signing in, with modes and job times only", health.status() === 200 && healthBody.ok === true && healthBody.staleJobs.length === 0 && !JSON.stringify(healthBody).includes(DOMAIN));
  await prisma.jobRun.deleteMany({ where: { runKey: "smoke-sanctions" } });
  const unhealthy = await (await browser.newContext()).request.get(`${BASE}/api/health?watch=jobs`);
  ok("and the monitor's check says 503 when the sanctions job stops", unhealthy.status() === 503 && (await unhealthy.json()).staleJobs.includes("sanctions"));
  await go(owner, "/admin");
  ok("the owners see a warning in the panel", (await seen(owner.getByTestId("stale-jobs"))) && (await owner.getByTestId("stale-jobs").innerText()).includes("sanctions"));
  await go(under, "/admin");
  ok("the rest of the team doesn't", (await under.getByTestId("stale-jobs").count()) === 0);
  await prisma.jobRun.create({ data: { job: "sanctions", runKey: "smoke-sanctions", ok: true, finishedAt: new Date() } });
  await prisma.errorEvent.create({ data: { hash: "smoke-error", message: "Couldn't load the loan book", route: "/admin/deals/[id]", kind: "render", count: 3 } });
  await go(owner, "/admin/errors");
  const errorRow = owner.getByTestId("error-row").filter({ hasText: "Couldn't load the loan book" });
  ok("the errors page shows what failed, where and how often", (await seen(errorRow)) && (await errorRow.innerText()).includes("/admin/deals/[id]") && (await owner.getByTestId("stale-jobs").count()) === 0);
  await errorRow.getByTestId("mark-fixed").click();
  ok("an owner marks it fixed", await seen(owner.getByTestId("error-row").filter({ hasText: "Couldn't load the loan book" }).getByText("Fixed")));
  await go(under, "/admin/errors");
  ok("an underwriter can't open it", path(under) === "/admin");

  // A pre-approval letter for the borrower: issued by an owner, checked by a seller, downloaded, then withdrawn.
  await go(owner, "/admin/letters");
  await owner.getByTestId("letter-borrower").selectOption({ label: `Bonnie Borrower · borrower@${DOMAIN}` });
  await owner.getByTestId("letter-entity").fill("Real Flips LLC");
  await owner.getByTestId("letter-price").fill("400000");
  await owner.getByTestId("letter-loan").fill("340000");
  await owner.getByTestId("issue-letter").click();
  ok("an owner issues a pre-approval letter", await seen(owner.getByTestId("letter-done")));
  const letterRow = owner.getByTestId("letter-row").first();
  ok("it gets a number and an expiry", /PA-\d{4}-0001/.test(await letterRow.innerText()) && (await letterRow.innerText()).includes("good through"));
  const verifyHref = await letterRow.getByTestId("letter-verify-link").getAttribute("href");
  const seller = await (await browser.newContext()).newPage();
  await seller.goto(BASE + new URL(verifyHref).pathname);
  ok("a seller checks it without signing in: genuine, whom it's for, the limits", (await seen(seller.getByTestId("verify-valid"))) && (await seller.getByTestId("verify-letter").innerText()).includes("Real Flips LLC") && (await seller.getByTestId("verify-letter").innerText()).includes("$340,000") && !(await seller.getByTestId("verify-letter").innerText()).includes(`borrower@${DOMAIN}`));
  await go(borrower, "/admin/borrower");
  ok("the borrower has it on their dashboard", await seen(borrower.getByTestId("my-letter")));
  const letterPdfReply = await borrower.request.get(BASE + (await borrower.getByTestId("my-letter-pdf").getAttribute("href")));
  ok("and downloads it as a PDF", letterPdfReply.status() === 200 && (await letterPdfReply.body()).subarray(0, 5).toString() === "%PDF-");
  ok("another borrower can't", (await other.request.get(BASE + (await borrower.getByTestId("my-letter-pdf").getAttribute("href")))).status() === 404);
  await letterRow.getByTestId("revoke-letter").click();
  await seen(owner.getByTestId("letter-row").first().getByText("Withdrawn"));
  await seller.reload();
  ok("withdrawn, the check says so", await seen(seller.getByTestId("verify-revoked")));

  // Tax forms: the partner signs a W-9 in its portal; the owners see the year's forms and export them for IRIS.
  await go(partner, "/admin/account/tax");
  ok("a partner is told what happens without a W-9", (await partner.getByTestId("tax-missing").innerText()).includes("24%"));
  await partner.getByTestId("w9-name").fill("Parker Capital LLC");
  await partner.getByTestId("w9-classification").selectOption("llc_p");
  await partner.getByTestId("w9-tin").fill("12-3456789");
  await partner.getByTestId("w9-street").fill("9 Fund Row");
  await partner.getByTestId("w9-city").fill("Tampa");
  await partner.getByTestId("w9-state").fill("FL");
  await partner.getByTestId("w9-zip").fill("33602");
  await partner.getByTestId("tax-signature").fill("Parker Partner");
  await partner.getByTestId("tax-submit").click();
  ok("it can't sign without certifying", await seen(partner.getByTestId("tax-error").getByText(/certify/)));
  await partner.getByTestId("tax-certify").check();
  await partner.getByTestId("tax-submit").click();
  ok("the partner signs a W-9, and sees only the last digits of its EIN", (await seen(partner.getByTestId("tax-on-file"))) && (await partner.getByTestId("tax-on-file").innerText()).includes("•••-••-6789"));
  ok("the EIN is encrypted in the database", !(await rawRows("TaxForm")).includes("123456789") && !(await rawRows("TaxForm")).includes("Parker Capital LLC"));
  await go(owner, "/admin/tax");
  ok("the owners' tax page shows the year", (await seen(owner.getByTestId("tax-summary"))) && (await owner.getByTestId("tax-deadlines").innerText()).includes("2027"));
  // No loan with a partner or broker has paid this year, so there's nothing to file yet, and nothing is revealed.
  await owner.getByTestId("tax-export").click();
  ok("with nothing due, the IRIS export says so and reveals nothing", (await seen(owner.getByTestId("tax-board-error").getByText(/No forms are due/))) && (await prisma.auditEvent.count({ where: { action: "pii.revealed", entityType: "TaxYear" } })) === 0);
  await go(under, "/admin/tax");
  ok("an underwriter can't open the tax page", path(under) === "/admin");

  // A repeat borrower: from the funded loan, the next application starts from the signed one, and the loan paid as agreed
  // takes the repeat cut off the new one's price.
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the funded loan offers the next one, with what paying as agreed earns", (await borrower.getByTestId("repeat-status").innerText()).includes("1 LendHous loan paid as agreed takes 0.25% off"));
  // The refinance application the borrower opened earlier would be picked up here instead; this step is about a
  // fresh one, so drop that unfinished draft first.
  await prisma.applicationLink.deleteMany({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: `borrower@${DOMAIN}` } })).id, status: "open", dealId: null } });
  await borrower.getByTestId("new-loan-from").click();
  await borrower.waitForURL("**/admin/apply?from=*");
  ok("the next application starts from the one signed for LH-1001", (await seen(borrower.getByTestId("app-started-from").getByText(/LH-1001/))) && (await borrower.getByTestId("app-phone").inputValue()) === "(555) 010-0500");
  await borrower.getByTestId("app-next").click();
  await fillAddress(borrower, "app-address", { street: "200 Second Street", city: "Hollywood", state: "FL", zip: "33020", county: "Broward" });
  await borrower.getByTestId("app-flood-no").click();
  await borrower.getByTestId("app-type").selectOption("sfr");
  await borrower.getByTestId("app-occupancy").selectOption("vacant");
  await borrower.getByTestId("app-next").click();
  for (const [key, value] of Object.entries({ purchasePrice: "320000", rehab: "90000", arv: "560000", liquidity: "160000" })) await borrower.getByTestId(`app-${key}`).fill(value);
  await borrower.getByTestId("app-plan").fill("Paint, floors and a new roof, then sell.");
  await borrower.getByTestId("app-exit-sell").click();
  await borrower.getByTestId("app-close").fill(CLOSE_ON);
  ok("the estimate takes the repeat cut", (await borrower.getByTestId("app-estimate").innerText()).includes("Repeat borrower, 1 loan paid as agreed: −0.25%"));
  await borrower.getByTestId("app-next").click();
  ok("the entity, guarantor and past deal are filled in; the SSN, birth date and score aren't", (await borrower.getByTestId("app-llc-name").inputValue()) === "Real Flips LLC" && (await g("first").inputValue()) === "Bonnie" && (await g("ssn").inputValue()) === "" && (await g("dob").inputValue()) === "" && (await g("fico").inputValue()) === "" && (await borrower.getByTestId("deal-address-0").inputValue()) === "9 Past Flip Lane");
  for (const [id, value] of Object.entries({ dob: "1979-06-02", fico: "750", ssn: "987654321" })) await g(id).fill(value);
  for (const key of [...QUESTIONS, "occupy"]) await g(`decl-${key}-false`).click();
  await borrower.getByTestId("app-next").click();
  await seen(borrower.getByTestId("app-review"));
  for (const key of ["application", "credit", "release", "esign"]) await borrower.getByTestId(`agree-${key}`).check();
  await borrower.getByTestId("app-signature").fill("Bonnie Borrower");
  await borrower.getByTestId("app-sign").click();
  ok("the repeat borrower signs it", await borrower.waitForURL("**/admin/borrower/d*").then(() => true, () => false));
  const repeatId = borrower.url().split("/").pop();
  await borrower.getByTestId("docs-tab-submitted").click();
  ok("the past deal confirmed on LH-1001 isn't asked for again", repeatId !== dealId && (await seen(borrower.getByTestId("doc-track").getByText("Accepted"))));
  await go(under, `/admin/deals/${repeatId}`);
  ok("the team sees the repeat record it was priced on", (await under.getByTestId("deal-repeat").innerText()).includes("1 LendHous loan paid as agreed (LH-1001)"));

  // Exports, audit, settings
  await go(owner, "/admin");
  await owner.getByTestId("pipeline-ended").selectOption("all");
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
  // The secure application link: the owner sends it, the visitor fills in five steps on the phone and signs, and the loan starts
  await go(owner, "/admin/leads");
  await veraRow.getByTestId("open-application-link").click();
  await veraRow.getByTestId("send-application-link").click();
  const appLink = await veraRow.getByTestId("application-link-url").inputValue();
  ok("the owner sends the visitor the application link", appLink.includes("/apply/") && (await prisma.notification.count({ where: { toEmail: `vera@${DOMAIN}`, eventCode: "application.link" } })) === 1);
  const applicantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const applicant = await applicantContext.newPage();
  applicant.on("pageerror", (error) => errors.push(`applicant: ${error.message}`));
  await applicant.goto(BASE + new URL(appLink).pathname);
  ok("the link opens prefilled from the quote request", (await applicant.getByTestId("app-email").inputValue()) === `vera@${DOMAIN}`);
  await applicant.getByTestId("app-next").click();
  await applicant.getByTestId("app-flood-no").click();
  await applicant.getByTestId("app-occupancy").selectOption("vacant");
  await applicant.getByTestId("app-next").click();
  await seen(applicant.getByTestId("app-step").getByText(/step 3 of 5/i));
  ok("the numbers come from the quote request too", (await applicant.getByTestId("app-arv").inputValue()) === "480,000");
  await applicant.getByTestId("app-exit-refinance").click();
  await applicant.getByTestId("app-next").click();
  await applicant.getByTestId("app-llc-true").click();
  await applicant.getByTestId("app-llc-name").fill("Vera Rentals LLC");
  await applicant.getByTestId("app-llc-address-street").fill("10 Company Court");
  await applicant.getByTestId("app-llc-address-city").fill("Tampa");
  await applicant.getByTestId("app-llc-address-state").fill("FL");
  await applicant.getByTestId("app-llc-address-zip").fill("33602");
  await applicant.getByTestId("g0-dob").fill("1980-04-12");
  await applicant.getByTestId("g0-fico").fill("731");
  await applicant.getByTestId("g0-ssn").fill("123456789");
  await applicant.getByTestId("g0-home-street").fill("8 Home Street");
  await applicant.getByTestId("g0-home-city").fill("Tampa");
  await applicant.getByTestId("g0-home-state").fill("FL");
  await applicant.getByTestId("g0-home-zip").fill("33606");
  for (const id of ["g0-two-true", "g0-mail-true", "g0-marital-unmarried"]) await applicant.getByTestId(id).click();
  await applicant.getByTestId("g0-own").fill("100");
  for (const key of ["bankruptcy", "foreclosure", "delinquent", "judgments", "lawsuit", "felony", "borrowedDownPayment", "occupy"]) await applicant.getByTestId(`g0-decl-${key}-false`).click();
  await applicant.getByTestId("app-next").click();
  await seen(applicant.getByTestId("app-review"));
  ok("the form saves as the borrower goes", (await applicant.getByTestId("app-saved").innerText()).includes("Saved") || (await applicant.getByTestId("app-saved").innerText()).includes("Saving"));
  ok("what's saved is encrypted", !(await rawRows("ApplicationLink")).includes("123456789") && !(await rawRows("ApplicationLink")).includes("1980-04-12"));
  for (const key of ["application", "credit", "release", "esign"]) await applicant.getByTestId(`agree-${key}`).check();
  await applicant.getByTestId("app-signature").fill("Vera Visitor");
  await applicant.getByTestId("app-sign").click();
  ok("the applicant signs the application on the phone", await seen(applicant.getByTestId("application-signed")));
  await applicantContext.close();
  const signedLead = await prisma.lead.findFirstOrThrow({ where: { id: { not: lead.id }, loanId: { not: null } } });
  ok("signing starts the loan from the lead", Boolean(signedLead.loanId));
  ok("and invites the borrower to the portal", Boolean(await prisma.user.findUnique({ where: { email: `vera@${DOMAIN}` } })));
  ok("the Social Security number never reaches the loan book", !(await rawRows("BookRecord")).includes("123456789"));
  await go(owner, `/admin/deals/${signedLead.loanId}`);
  await owner.getByTestId("tab-Credit review").click();
  await seen(owner.getByTestId("application-on-file"));
  ok("staff see the signed application with the number masked", (await owner.getByTestId("application-on-file").innerText()).includes("Signed by Vera Visitor") && (await owner.getByTestId("application-ssn").innerText()) === "•••-••-6789");
  await owner.getByRole("button", { name: "Show (logged)" }).click();
  ok("the owner can reveal it, and the reveal is logged", (await seen(owner.getByTestId("application-ssn").getByText("123-45-6789"))) && (await prisma.auditEvent.count({ where: { action: "pii.revealed" } })) === 1);

  ok(`no browser errors${errors.length ? `: ${errors[0]}` : ""}`, errors.length === 0);
} finally {
  // Printed here so a step that times out still shows every check that ran before it.
  console.log(checks.join("\n"));
  await browser.close();
  await wipe();
// A small stand-in for Treasury's sanctions list, so applications are screened as they arrive (the nightly job downloads the real one).
await prisma.sanctionsList.create({ data: { id: "sdn", fetchedAt: new Date(), names: 2, hash: "smoke", entries: [[90001, "DOE, Jonathan", "individual", "SDGT"], [90002, "LISTED TRADING CO", "entity", "SDNTK"]] } });
  await prisma.$disconnect();
}
if (checks.some((check) => check.startsWith("FAIL"))) process.exitCode = 1;
