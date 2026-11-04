# Lendhous: next features build prompt

Paste everything below the line into a new Claude Code session opened in `~/Desktop/Lendhous`. Each feature also has its own prompt under **The features**, written so it can be handed over on its own.

---

You're continuing work on **Lendhous**, a private (hard-money) lending platform for a Florida lender, LendHous, and its owner GT. It makes business-purpose fix and flip, bridge, ground-up construction and DSCR rental loans to investors and their LLCs, funded with its own money and partner lenders' money. Read `README.md` and `DEPLOY.md` first; they describe what's built and where it lives.

## How this codebase works (follow it exactly)

- **Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind 4, Prisma 6 on MongoDB (a replica set, no migrations). **Never `prisma db push`:** `npm run db:indexes` syncs indexes from the schema, and makes optional unique fields partial indexes, which `db push` gets wrong. zod, vitest, playwright-core scripts, Framer Motion 12.23.12 (pinned with `motion-dom`/`motion-utils` overrides: newer `motion-dom` breaks the build). PDFs come from pdfkit on the server.
- **The loan book:** one reducer (`lib/book.ts`) applies every `BookAction`, and its `reducer` wrapper notes each loan's stage changes in `deal.stages`. `lib/book-access.ts` `authorize` checks each action against the viewer's role and permissions; actions that only the server may take run as `trusted`. `lib/book-actions.ts` `parseAction` is the zod shape of anything a browser sends (server-only actions are left out of it). `lib/book-store.ts` saves only the changed records, encrypted, with an optimistic version lock. `lib/book-alerts.ts` decides who is emailed. `scopeBook` strips what each role mustn't see (`blind()` for partners' teasers).
- **Rules live in pure `lib/*.ts` modules**, and the reducer, `authorize`, the screens, the nightly jobs and the reports all call the same functions. Examples: `lib/loan-exits.ts`, `lib/closing.ts`, `lib/ofac.ts`, `lib/borrower-application.ts`, `lib/reports.ts`, `lib/capital.ts`. A new feature gets its own rules module the same way. Never import a pure helper from `lib/store.tsx`: it's a client module.
- **Pricing is versioned:** every loan carries `app.pricingVersion` (`lib/pricing-versions.ts`). Anything that belongs in a loan's note (rates, late fees, extension terms) must be read through the loan's own version, never `pricingConfig` directly.
- **Sensitive data:** the loan book is encrypted at rest but sent in full to staff browsers. So SSNs, dates of birth, EINs and bank account numbers stay out of it, sealed in their own records (see `lib/application-links.ts`). Showing them takes `reveal_sensitive` and writes `pii.revealed` to the audit log.
- **Permissions:** a new permission goes in `PERMISSIONS` and `DEFAULT_MATRIX` (`lib/permissions.ts`) **and** in `PERMISSION_GROUPS` (`lib/member-rules.ts`), or the Members page can't grant it. A test checks every permission is in a group.
- **Demo seats** (`@lendhous.test`) run a fake book in the browser; real accounts use the database. New features must work in both, or show a clear demo note. The demo book's dates are fixed around `DEMO_SERVICING_DAY` so screens render the same on the server and in the browser; anything that needs "today" sets it after the first render (`serviceDay`).
- **Copy:** plain, short sentences for borrowers and staff alike. No jargon on borrower screens. Every new screen must fit a 320px phone with no sideways scrolling.
- **Placeholders:** every legal or money number the attorney or GT hasn't set is marked PLACEHOLDER in code and listed in the README.
- **Browser scripts:** a click that a server reply can interrupt (lists that redraw after each save) waits for the save before the next click. Copy the waive and clear loops in `scripts/smoke-real.mjs`.

## Constraints

- Commit or push only when the user asks. Never print `.env` values.
- Don't re-add two-factor sign-in (removed at the user's request on 2026-11-01).
- Production runs under pm2 on a shared AWS server (port 3011). The daily jobs (`lendhous-jobs`) run `lib/jobs.ts` at 06:00 UTC, the owners' digest last.

## Definition of done (every feature)

Rules in a pure module with unit tests (`tests/*.test.ts`). A database test in `tests/db.integration.test.ts` when it stores something new. `authorize` rules and `parseAction` shapes for every new action. Alerts where someone needs to know. Steps added to `scripts/screenshots.mjs` (demo seats), `scripts/smoke-real.mjs` (real accounts) and `scripts/phone-check.mjs` (new pages or forms). README and DEPLOY updated. Then all of these pass:

```bash
npx tsc --noEmit -p . && npx vitest run
npm run build && npm start   # then, with the server up:
npm run db:seed && npm run screenshots
npm run db:seed && npm run smoke:auth
npm run db:seed && npm run phone:check
npm run db:seed && npm run smoke:real
```

## Built so far

1. The title company's secure closing link. 2. Payoff letters under Fla. Stat. 701.04. 3. Term sheets. 4. Conditions. 5. Draw protections under Florida's lien law (ch. 713). 6. Reg B decline notices. 7. Reports at `/admin/reports` and the owners' daily email. Also property photos, self sign-up at `/login/signup`, one application for every borrower (the portal and the secure link share `components/BorrowerApplication.tsx`), and A to H below: who works each loan, the pipeline and portal fixes, reliability, partners' and buyers' portfolios and statements, tax forms, pre-approval letters, the repeat-borrower fast track and the broker program. What's left is the vendor work and the "as volume grows" list.

## The features, in priority order

Build them in this order, one at a time. Finish each to the definition of done before starting the next, and stop after each one to report.

### A. Who owns each loan

> **Prompt.** Every loan gets a loan officer and a processor. Today nothing says who's working a loan: the pipeline can't be filtered to "my loans", alerts go to every owner, and a borrower's "Your team" box is empty on a real account.
>
> - **Data:** `deal.team?: { officer?: TeamMember; processor?: TeamMember }`, where a `TeamMember` is a snapshot of `{ id, name, email, phone, title }` taken when they're assigned (so the borrower's browser can show how to reach them). A pure `lib/loan-team.ts` holds who can be assigned (staff with `view_pipeline`), who a loan belongs to, and the "mine" test (by id, or by email for the demo book).
> - **Assigning:** a new `assign_loans` permission (owners and underwriters by default; add it to a permission group). On the loan page, under the header, "Loan officer" and "Processor" each show the person and, for someone with `assign_loans`, a picker of the team. The server action looks the person up and runs a trusted `assignLoanTeam` action with the snapshot; the browser never sends names or emails. Anyone can take an unassigned loan as its processor with "I'll take it".
> - **Defaults:** staff starting a loan become its loan officer, and so does the loan officer who sent an application link. Loans from the portal or a website lead start unassigned.
> - **Pipeline:** a "My loans / No loan officer / Everyone's" filter (Everyone's by default, remembered per browser), the officer's initials on each row, and a "Loans with no loan officer" item in Needs attention.
> - **Alerts:** team alerts about a loan go to its officer and processor as well as the owners. Being assigned emails the person.
> - **Borrower and broker:** the loan page's "Your team" box shows the officer and processor with call, text and email links, above the wire-fraud warning.
> - **Reports:** a "By loan officer" table: applications, term sheets, fundings and amount funded in the period.
> - **Demo:** demo loans are spread across the demo seats' names and emails.
> - **Tests:** the rules, `authorize` (only `assign_loans` assigns; trusted only), alert routing, the filter, and a real-account run where an owner assigns an underwriter who then sees the loan under "Mine" and gets the email.

### B. Pipeline and portal fixes

> **Prompt.** A set of small fixes from the screen review. Each is quick; together they make the app read as finished.
>
> - **Needs attention:** order it by urgency (legal deadlines first: payoff letters and decline notices with days left, then wires to verify, sanctions matches, funding approvals, then reviews), and show the deadline on the items that have one.
> - **Pipeline table:** the default view is loans not yet funded ("In the pipeline"; funded loans live on Servicing). One status label per row; the capital status shows only when it adds something (not "Not started", not "Funded" twice). Drop the LTV column (total loan ÷ as-is reads 106–269% on rehab loans, which is normal and alarming). Plain-language subtitle.
> - **Loan page:** "Next: build and send the term sheet" instead of "Next step: Term Sheet Issued"; what's blocking it as a short checklist. A facts bar under the header: target closing date, days to close, loan officer and processor. Empty optional numbers show blank, not 0.
> - **Dates:** one `shortDay()` format ("Nov 13, 2026") for every date a person reads, in borrower and staff screens, emails and letters. ISO dates stay in CSVs.
> - **Borrower loan page:** one "What we need from you" checklist at the top (requested documents, their open conditions, a nudge to add property photos) with a count and progress; the scope of work collapses once submitted; a "Messages" link jumps to the thread.
> - **Borrower menu:** one way to start a loan ("Apply for a loan"), not a nav item and a button with different names.
> - **Staff search:** a search box in the staff sidebar (and ⌘K) that finds loans by number, borrower, entity or address from the book, and website leads from the server, each a link.
> - **Tests:** the urgency order and `shortDay` as unit tests; screenshot checks for each change; phone check for the search and the checklist.

### C. Reliability

> **Prompt.** Make it safe to run unattended before real money moves.
>
> - **Errors:** a server error handler that records each error (message, route, time, a hash of the stack; no request bodies, no PII) in an `ErrorEvent` collection, an owners-only `/admin/errors` page, and the count in the morning email. If `SENTRY_DSN` is set, forward them too, with PII scrubbed.
> - **Health:** `/api/health` (no sign-in) returns 200 with the database reachable and the last run of each nightly job; 503 if the database is down or the servicing or sanctions job is over 2 days old. Owners see a banner in the panel when a job is stale. Document pointing an uptime monitor (UptimeRobot or similar) at it.
> - **Staging:** document a staging deployment in DEPLOY.md: its own database and `NEXT_PUBLIC_APP_URL`, mail to the log, demo seats allowed.
> - **Restore test:** `npm run restore:test` restores the latest backup (an Atlas snapshot or a `mongodump` archive) into a scratch database, opens a sample of encrypted records with the keys, and reports what it checked. Document how often to run it.
> - **Tests:** the error recorder strips PII; the health route's 200 and 503 cases.

### D. Partner and buyer portfolio and statements (Spec P7–P9, 8.6)

> **Prompt.** Capital partners and loan buyers need to see their money.
>
> - The winning partner sees verified funding instructions on the loan and marks funds sent; staff mark funds received (both into the closing checklist).
> - "My portfolio" for a partner and a buyer: each funded loan's balance, rate, status, payments received, draws and payoffs, from the servicing ledger.
> - Monthly distribution statements per partner and per loan buyer: interest, principal, fees, servicing fee withheld, balances and delinquency, as a PDF (pdfkit, like the payoff letters) and CSV, generated on the 1st by a nightly job and kept, each emailed with a link.
> - **Tests:** the split of each payment by allocation, the statement totals against the ledger, and a partner who can't see another partner's statement.

### E. Tax forms

> **Prompt.** LendHous services loans for partners and buyers and pays brokers, so it files their information returns. Research (Nov 2026, sources below) gives the rules; anything marked CPA is for LendHous's CPA to confirm, and the thresholds live in one config so they can change without code.
>
> - **W-9 first.** Collect a W-9 from every US partner, buyer and broker before the first payment: legal name, tax classification, TIN and any exempt-payee code, as an e-signed substitute form (the IRS allows a substantially similar electronic W-9). Seal the TIN like an SSN. A foreign investor gives a W-8BEN (person) or W-8BEN-E (entity) instead, valid to Dec 31 of the third year after signing; flag it for the CPA (30% withholding, Form 1042-S due March 15). Keep each form for the relationship plus 4 years.
> - **Backup withholding.** Without a certified TIN, or after an IRS B-notice, payments to that payee are subject to 24% backup withholding (interest has a 60-day grace for an applied-for TIN; broker fees don't). The statements and broker fee screens show the hold and the amount; reported in box 4 and on Form 945.
> - **1099-INT** for partners' and buyers' interest: LendHous files as the middleman that collects and passes it on (Treas. Reg. 1.6049-4). Box 1 interest (the investor's net interest from the monthly statements), box 4 backup withholding. Exempt: corporations (presumed from "Inc."/"Corp." in the name, not "Co."), tax-exempt organizations and IRAs, so a self-directed IRA participant gets none. Threshold $10, configurable (CPA: whether $600 applies to non-section-6049 interest, and how participations are characterized).
> - **1099-NEC** for broker fees: $2,000 or more paid in 2026 (P.L. 119-21; indexed from 2027), box 1a; exempt if the broker is a corporation (C or S). CPA: a fee the borrower pays the broker on the settlement statement may be the borrower's payment, not LendHous's.
> - **1098** for borrowers: $600 or more of interest in the year from an individual payer of record, on any loan secured by real property, business-purpose included; none when the borrower is an LLC, partnership, trust or estate (CPA: single-member LLCs). For a loan sold mid-year the seller reports what it received; the buyer reports principal at acquisition (box 2) and the acquisition date (box 11) when LendHous services it.
> - **Year-end screen** (`/admin/tax`, owners): for a tax year, every form that's due, each with the payee, amounts, exemption, W-9 status and what's missing; recipients' PDFs; and an IRIS CSV export (the IRS's only e-file system from Jan 1, 2027; e-filing is required at 10 or more returns in total). Deadlines: recipients' copies Feb 1, 2027 (1099-INT, 1099-NEC, 1098); the IRS Feb 1 for 1099-NEC, March 31 e-filed for the rest. Electronic recipient copies need the recipient's consent; otherwise mail.
> - **Florida:** no state income-tax returns (no personal income tax; Florida only collects 1099-K). An investor's home state may want a copy; IRIS's combined federal/state program covers 1099-INT and 1099-NEC, not 1098.
> - **Tests:** who gets which form at the thresholds, exemptions, backup withholding, the CSV's columns, and a payee without a W-9 flagged.
>
> Sources: IRS W-9 instructions (irs.gov/instructions/iw9), 1099-INT (irs.gov/instructions/i1099int), 1099-MISC/NEC (irs.gov/instructions/i1099mec), 1098 (irs.gov/instructions/i1098), General Instructions (irs.gov/instructions/i1099gi), IRIS (irs.gov/filing/e-file-information-returns-with-iris), 26 CFR 1.6049-4 and 1.6049-5, 26 USC 6041, Rev. Proc. 2025-32 (penalties: $60/$130/$340 per return for 2027 filings).

### F. Pre-approval and proof-of-funds letters (Spec 12.3)

> **Prompt.** For repeat borrowers and GT's wholesale and realty clients making offers. Research found lenders (Kiavi, RCN, Lima One, New Silver) give a letter number, the borrower or LLC, a maximum loan and price, the program, an expiry (30 to 60 days; sellers want one under 30 days old), conditions and "not a commitment, subject to underwriting" language; sellers verify by calling, and QR verification isn't standard, so a verify page sets LendHous apart.
>
> - A staff page to issue one (it takes term sheet authority for the amount), a PDF with a QR code to a public verify page that shows only whether it's genuine and valid, whom it's for, the limits and the expiry, withdrawal, and the borrower's copy in the portal.
> - Business-purpose and non-owner-occupied wording on every letter (Florida makes calling a consumer loan business-purpose a felony).
> - **Reg B:** a written pre-approval request for a set amount and period is a credit application, so declining one needs a decline notice. Say so on the issue screen.
>
> Sources: albeca.com and rcncapital.com articles on letters, kiavi.com/how-it-works, help.newsilver.com POF article, 12 CFR 1002 commentary 2(f) (consumerfinance.gov), Fla. Stat. 494.0025.

### G. Repeat-borrower fast track

> **Prompt.** Research: lenders tier by deals closed (Kiavi 0–2 / 3+ in 24 months; RCN 5+ in 36 months for more leverage), and give repeat borrowers rate and fee cuts (New Silver: 3 loans 0.50% rate / 0.25% origination, 6 loans 0.75% / 0.50%, 10 loans 1.00% / 0.75%; Backflip up to 0.50% origination over 24 months, paused by a late payment), faster closings and less paperwork, while re-pulling anything stale (credit and bank statements over 90 days, appraisals over 120).
>
> - The portal application starts from the borrower's last signed one: entity, guarantors and track record, with Social Security numbers and birth dates entered again.
> - Loans funded with LendHous count toward pricing automatically: the `repeatBorrower` adjuster becomes a tier table in the pricing config (PLACEHOLDER numbers until GT sets them), by loans paid as agreed in the last 24 months, and a late payment in that window pauses it.
> - Documents still fresh on the last loan (entity documents, good standing under 90 days, IDs) carry over as received; the ones that go stale are asked for again.
> - "New loan on another property" from a funded loan.
>
> Sources: kiavi.com/solutions/high-volume-real-estate-investors, rcncapital.com repeat-investor article, limaone.com/lower-flip-interest-rates, backflip.com rewards, anchorloans.com portal announcement.

### H. Broker program (Spec R1–R6)

> **Prompt.** Research (Florida attorney to confirm): business-purpose loans on investment property aren't Chapter 494 "mortgage loans", so brokering them needs no Florida license or NMLS ID (OFR declaratory statement, 2016; s. 494.001(4), (25)); Reg Z's loan-originator compensation rules and RESPA don't apply to business-purpose credit. But calling a consumer loan business-purpose is a felony, and a broker's home state (Nevada, Utah) may license commercial brokering.
>
> - **Sign-up and approval:** entity documents and good standing, a W-9 (see E), an NMLS ID or state license if they have one, OFAC screening of the firm and its principals, and an e-signed broker agreement: business-purpose loans only, accuracy of what they submit (occupancy, use of funds), the compensation schedule, every borrower-paid fee disclosed on the term sheet and settlement statement, non-circumvention with a borrower-protection window, indemnity, and no authority to bind LendHous. Staff approve before deals can be submitted.
> - **Fees:** tracked per loan as expected, paid or unpaid (typical 1 to 2 points; RCN reports 1.2% on average), shown on the term sheet, and counted toward 1099-NEC (E).
> - **Usury check:** Florida counts commissions and discounts as interest spread over the term (18% simple up to $500,000; 25% criminal). Short loans with points can cross it (5 points on a 6-month loan adds about 10%). Warn before a term sheet goes out when rate plus points annualized passes the limit (attorney: whether an independent broker's fee counts).
> - **White-label quote PDFs** with the broker's name, still naming LendHous as the lender and saying it isn't a commitment.
> - **Referral links** with attribution on the quote form (a borrower stays the broker's for the window in the agreement), counted in the reports. Pay a real estate agent's referral through their broker (Fla. Stat. 475.42).
>
> Sources: Fla. Stat. 494.001, 494.0025, 494.00115, 687.03, 687.071, 475.42; 12 CFR 1026.3, 1026.36, 1024.5; thewbkfirm.com and legal500.com summaries of the 2016 OFR ruling and 2018 law; rcncapital.com and kiavi.com broker pages; easystreetcap.com broker program.

### Needs a vendor chosen first

Build the adapter behind an env key, and test with recorded fixtures.

- **Credit, ID and background checks:** a soft pull plus ID and KYC for each guarantor, with the consent record the application already captures.
- **ACH payments:** autopay and one-time ACH through a payment processor, with NSF returns reversing the payment and pausing autopay after two returns.
- **Automated comps and ARV:** a property-data provider (RentCast or ATTOM) that fills an AVM and comparables on the quote form and the loan's numbers tab, labelled as an estimate.
- **E-signature:** for term sheets, extension agreements and guaranties.

### As volume grows

- **Collections and default workspace (Spec 8.3, 8.10, A26):** a call log, promise-to-pay tracking, notices with proof of delivery, a bankruptcy flag that pauses automated notices, workouts and modifications, foreclosure milestones, and REO with carrying costs and the loss split by allocation.
- **FinCEN AML program support:** case management for suspicious activity (SARs) with restricted access, the compliance officer and training log, and record retention (5 years for SARs, 10 for OFAC).
- **Partial releases and blanket loans (Spec 8.9):** several properties under one loan, release prices, and leverage re-tested after each release.
- **Data rights and breach response:** a document retention schedule with legal hold, "download my data" for borrowers, and a breach incident workflow with the Florida (Fla. Stat. 501.171) and FTC 30-day clocks.
- **Spanish** for the public site and borrower screens.

## Launch checklist (not code: for GT and whoever runs the server)

- **Email from LendHous's own domain.** Add and verify the domain in Resend (a few DNS records), then set `EMAIL_FROM`. Until then every sign-up, password and payoff email comes from another company's address.
- **Real numbers and wording.** Publish real pricing at `/admin/pricing`; the attorney supplies the application consents, the decline notice, the payoff letter, lien waiver forms, the extension agreement, and the default and late-fee numbers.
- **Its own database login.** A dedicated Atlas user with read and write on the `lendhous` database only, instead of the shared admin login.
- **Settings.** LendHous's mailing address and phone (decline letters need them); whether borrowers can sign up on their own; turn off sample data before real clients sign in.
- **Deploy and HTTPS.** Sign-in needs https behind the proxy, and nginx has to let uploads over 1 MB through.

## Open decisions to ask GT about (don't guess)

- Which vendors to use for credit and KYC, ACH, property data, e-sign and error monitoring.
- The second approver for funding and draws on jobs GT's construction company does (Spec 7.6).
- Who should have `assign_loans` and `view_reports` beyond the defaults.
- The repeat-borrower tiers (`adjusters.repeatTiers`, editable at `/admin/pricing`), and how long each carried-over document stays good (`CARRY_OVER` in `lib/repeat-borrower.ts`).
- The broker agreement's wording, its borrower-protection window (`PROTECTION_MONTHS`, 12 months), and whether an independent broker's fee counts toward Florida's usury cap (the attorney).
- Whether the CPA wants 1099-NECs for broker fees the title company pays out of the settlement, or only for fees LendHous pays itself.

Start with feature A. Before writing code, read the files it touches and outline the plan in a few lines.
