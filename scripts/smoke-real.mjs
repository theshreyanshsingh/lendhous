// A loan's whole life with real accounts, each in its own browser, so nothing can pass by sharing browser storage:
// sign-up to funding, documents, draws, payoff, a partner bid, a loan sale and a broker deal, checking what each person
// can and can't see. It wipes the loan book when it starts and ends, so it refuses anything but a local database.
// Usage: npm run db:seed && npm run build && npm start, then npm run smoke:real
import { existsSync } from "node:fs";
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
  await prisma.lead.deleteMany({ where: { email: { endsWith: DOMAIN } } });
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
const PDF = { name: "bank-statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 real smoke test file") };

try {
  const owner = await person("owner");
  const under = await person("under");
  const borrower = await person("borrower");
  const other = await person("other");
  const broker = await person("broker");
  const partner = await person("partner");
  const buyer = await person("buyer");

  // An empty real account, then its first capital source
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
  for (let i = 0; i < 4; i++) await borrower.getByTestId("next").click();
  for (const c of ["bp", "noo", "consent"]) await borrower.getByTestId(`cert-${c}`).check();
  ok("a real application needs its details", (await borrower.getByTestId("submit-missing").innerText()).includes("borrowing entity") && (await borrower.getByTestId("submit").isDisabled()));
  await borrower.getByRole("button", { name: "Back" }).click();
  await borrower.getByLabel("Borrowing entity (LLC)").fill("Real Flips LLC");
  await borrower.getByTestId("next").click();
  await borrower.getByTestId("submit").click();
  await borrower.waitForURL("**/admin/borrower");
  ok("a real borrower can submit an application", await seen(borrower.getByTestId("borrower-loan-card")));
  await go(borrower, "/admin/borrower");
  ok("it's still there after a reload", (await borrower.getByTestId("borrower-loan-card").count()) === 1);

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
  ok("a real document uploads", await seen(bank.getByTestId("doc-file")));
  const fileUrl = await bank.getByTestId("doc-file").getAttribute("href");
  const mine = await borrower.request.get(BASE + fileUrl);
  ok("the borrower can open their file", mine.status() === 200 && (await mine.text()).startsWith("%PDF"));
  const staffCopy = await under.request.get(BASE + fileUrl);
  ok("the team can open it", staffCopy.status() === 200);
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
  for (const label of ["Start initial review", "Send to underwriting", "Issue term sheet"]) {
    await under.getByTestId("advance-loan").filter({ hasText: label }).click();
    await gone(under.getByTestId("advance-loan").filter({ hasText: label }));
  }
  ok("staff move the loan to a term sheet", await seen(under.getByTestId("stage-panel").getByText("Waiting for the borrower")));
  await go(borrower, `/admin/borrower/${dealId}`);
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
  await card.getByTestId("send-inspector").click();
  await card.getByTestId("observed-kitchen").fill("100");
  await card.getByTestId("record-inspection").click();
  await seen(card.getByTestId("draw-review"));
  await card.getByTestId("approve-draw").click();
  await card.getByTestId("release-draw").click();
  await seen(owner.getByTestId("closed-draw"));
  await go(borrower, `/admin/borrower/${dealId}`);
  ok("the borrower sees the money released", (await borrower.getByTestId("my-draw").innerText()).includes("Funds released"));

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
  await owner.getByTestId("next").click();
  for (const c of ["bp", "noo", "consent"]) await owner.getByTestId(`cert-${c}`).check();
  await owner.getByTestId("submit").click();
  await owner.waitForURL("**/admin/deals/*");
  const leadDeal = path(owner);
  const leadDealId = leadDeal.split("/").pop();
  const invited = await prisma.user.findUnique({ where: { email: `lena@${DOMAIN}` }, include: { roles: true, passwordLinks: true } });
  ok("staff create a loan from a brief", (await owner.locator("main").innerText()).includes("Lena Lead"));
  ok("the client is invited to the portal", invited?.roles[0]?.role === "BORROWER" && invited.passwordLinks.length === 1);
  const leadRow = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  ok("the brief links to its loan", leadRow.loanId === leadDealId && Boolean(leadRow.contactedAt));
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
  await broker.getByTestId("next").click();
  for (const c of ["bp", "noo", "consent"]) await broker.getByTestId(`cert-${c}`).check();
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
