# Lendhous: next features build prompt

Paste everything below the line into a new Claude Code session opened in `~/Desktop/Lendhous`. Each feature also has its own prompt under **The features**, written so it can be handed over on its own.

---

You're continuing work on **Lendhous**, a private (hard-money) lending platform for a Florida lender, LendHous, and its owner GT. It makes business-purpose fix and flip, bridge, ground-up construction and DSCR rental loans to investors and their LLCs, funded with its own money and partner lenders' money. Read `README.md` and `DEPLOY.md` first; they describe what's built and where it lives.

## How this codebase works (follow it exactly)

- **Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind 4, Prisma 6 on MongoDB (a replica set, no migrations). **Never `prisma db push`:** `npm run db:indexes` syncs indexes from the schema, and makes optional unique fields partial indexes, which `db push` gets wrong. zod, vitest, playwright-core scripts, Framer Motion 12.23.12 (pinned with `motion-dom`/`motion-utils` overrides: newer `motion-dom` breaks the build). PDFs come from pdfkit on the server.
- **The loan book:** one reducer (`lib/book.ts`) applies every `BookAction`, and its `reducer` wrapper notes each loan's stage changes in `deal.stages`. `lib/book-access.ts` `authorize` checks each action against the viewer's role and permissions; actions that only the server may take run as `trusted`. `lib/book-actions.ts` `parseAction` is the zod shape of anything a browser sends (server-only actions are left out of it). `lib/book-store.ts` saves only the changed records, encrypted, with an optimistic version lock. `lib/book-alerts.ts` decides who is emailed. `scopeBook` strips what each role mustn't see (`blind()` for partners' teasers).
- **Rules live in pure `lib/*.ts` modules**, and the reducer, `authorize`, the screens, the nightly jobs and the reports all call the same functions. Examples: `lib/loan-exits.ts`, `lib/closing.ts`, `lib/ofac.ts`, `lib/borrower-application.ts`, `lib/reports.ts`, `lib/capital.ts`, `lib/brokers.ts`, `lib/repeat-borrower.ts`. A new feature gets its own rules module the same way. Never import a pure helper from `lib/store.tsx`: it's a client module.
- **Pricing is versioned:** every loan carries `app.pricingVersion` (`lib/pricing-versions.ts`). Anything that belongs in a loan's note (rates, late fees, extension terms) must be read through the loan's own version, never `pricingConfig` directly.
- **Sensitive data:** the loan book is encrypted at rest but sent in full to staff browsers. So SSNs, dates of birth, EINs and bank account numbers stay out of it, sealed in their own records (see `lib/application-links.ts`). Showing them takes `reveal_sensitive` and writes `pii.revealed` to the audit log.
- **Permissions:** a new permission goes in `PERMISSIONS` and `DEFAULT_MATRIX` (`lib/permissions.ts`) **and** in `PERMISSION_GROUPS` (`lib/member-rules.ts`), or the Members page can't grant it. A test checks every permission is in a group.
- **Demo seats** (`@lendhous.test`) run a fake book in the browser; real accounts use the database. New features must work in both, or show a clear demo note. The demo book's dates are fixed around `DEMO_SERVICING_DAY` so screens render the same on the server and in the browser; anything that needs "today" sets it after the first render (`serviceDay`).
- **Vendors sit behind an env key.** A feature that calls an outside service (Anthropic, Twilio, FEMA, NOAA) works without the key: it shows what it would do and says the key isn't set. Tests use recorded fixtures, never the live service.
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

1. The title company's secure closing link. 2. Payoff letters under Fla. Stat. 701.04. 3. Term sheets. 4. Conditions. 5. Draw protections under Florida's lien law (ch. 713). 6. Reg B decline notices. 7. Reports at `/admin/reports` and the owners' daily email. Also property photos, self sign-up at `/login/signup`, one application for every borrower (the portal and the secure link share `components/BorrowerApplication.tsx`), and from the 2026-11-04 list: who works each loan, the pipeline and portal fixes, reliability, partners' and buyers' portfolios and statements, tax forms, pre-approval letters, the repeat-borrower fast track and the broker program (A to H, in git history before this file was rewritten), and I, the design pass (2026-11-05: photo-led loans, the loan timeline, one next step, status words, portfolio charts, the borrower tab bar, the folded staff menu, the Florida drawing and the opt-in "Recently funded" list). And J, the instant quote: terms before contact details, the cash to close itemized, the `/embed/quote` widget for brokers' and GT's own sites, and the quote funnel in the reports. And M, the work queue: each person's queue with legal deadlines and clocks against Settings' targets in Florida business hours, the pipeline board, and the speed scoreboard in the reports and the morning email. And Q, borrower statements: a monthly statement for every funded loan, emailed and kept, how to pay from Settings, and the year's interest for the 1098. And P, the maturity desk: borrowers' exit plans asked at 120, 90, 60 and 30 days, the rental-loan refinance started from the loan that pays the old one off when it funds, the desk on Servicing and the exits report.

## Where this list comes from (2026-11-05 CEO review)

Start from what a loan physically needs: a value for the property, confidence the borrower can pay and exit, a clean lien, and money moved. Everything else is friction, and the product is how little of it there is. The fastest lenders now quote from an address in seconds (Kiavi's ARV and cash-to-close estimator; Lima One says its portal cut quote waits by 90%), read documents with AI (Kiavi's AI document review and scope-of-work extraction), close fix and flips in as little as 5 business days (Kiavi), and pay draws from the borrower's phone photos with no site visit for most draws (Kiavi, Easy Street, Built Inspect). Lender software (Mortgage Automator, Baseline, Liquid Logics) adds rule-based tasks, texts, monthly borrower statements, investor portals with committed/allocated/available money, and now AI connections (Mortgage Automator ships an MCP server).

LendHous's targets, shown on the reports page so everyone sees them: **terms in 60 seconds, a term sheet the same day, closing in 5 business days, draws paid within 24 hours, no number typed twice.**

The screen review on 2026-11-05 also found these; feature I fixed them:

- The public home page's hero is the Dallas skyline (`public/images/dallas-skyline.webp`, Reunion Tower) on a Florida lender's site.
- At a laptop's height (1440×900) the staff menu's last item (Members) is cut off under the account block, with nothing to show the menu scrolls.
- Borrower screens still say "full-boat" under the rate, "Servicing Current", and "Term Sheet Issued" in title case. The funded loan card shows "due 2026-11-01" (an ISO date the `shortDay` sweep missed).
- The borrower's loan page shows two next steps at once ("Upload the documents marked Requested" and "Finish your application").
- Property photos exist, but no card or loan header shows one: every loan is a block of text.
- Needs attention is 14 equal counters, so a payoff letter with 2 days left by law looks the same as 15 documents to review. The owner seat shows 35 unread notifications.
- The partner portfolio is numbers only: no picture of money paid over time or when loans come due.

## The features, in priority order

Build them in this order, one at a time. Finish each to the definition of done before starting the next, and stop after each one to report.

### K. AI document reader

> **Prompt.** Processors read every bank statement, closing statement, insurance binder, LLC document and contractor bid by hand, and type what they find. Kiavi reads them with AI. Use Claude: load the `claude-api` skill first, use `claude-opus-5-5` by default (a `LENDHOUS_AI_MODEL` env setting can change it), behind `ANTHROPIC_API_KEY`. The reader never accepts anything by itself: it proposes, a person accepts.
>
> - **When a document is uploaded** to a loan (borrower, broker, staff or the title link), a server job sends it to Claude with a schema for its kind and stores the result as `deal.readings[]`: what it found, where (page), confidence, and checks against the loan. The document card shows "Read by AI: check it" with the fields and Accept, Fix or Ignore.
> - **What it reads and checks:**
>   - Bank statements: ending balance, statement date, account holder; liquidity against the cash to close plus reserves; a statement older than 90 days flagged; large recent deposits listed. Never store account numbers (last 4 at most).
>   - Closing statements (HUDs) for the track record: address, purchase and sale dates and prices; accepted ones count toward verified deals.
>   - Insurance binders: LendHous named as mortgagee with ISAOA/ATIMA, dwelling coverage at least the loan or the rebuild cost, dates covering closing, windstorm included, flood when the property is in a flood zone (see L).
>   - Entity documents: the entity's exact name and state, its managers or members against the guarantors, and a link to the Sunbiz record to confirm it's active.
>   - Contractor bids: line items and amounts proposed as the scope of work.
>   - Appraisals: as-is value, ARV, market rent and the appraiser's license number into the loan's numbers, as a proposal.
> - **Privacy:** documents can hold SSNs and account numbers. Send only what the reading needs (the file itself, no loan book), keep the result free of SSNs, birth dates and full account numbers, record each send in the audit log (`ai.read`), and add the AI provider to the privacy disclosure. GT confirms Anthropic's commercial data terms before turning it on. Off unless the key is set; demo seats show a recorded sample.
> - **Cost guard:** a monthly page cap in Settings, and the count in the morning email.
> - **Tests:** each kind's checks against recorded fixtures (no live calls), the PII scrub on results, nothing accepted without a person, and the audit entry.
>
> Sources: kiavi.com (AI document review, scope-of-work extraction), mortgageautomator.com/all-features.

### L. Florida property facts: flood zones and storm mode

> **Prompt.** Every LendHous property sits in Florida, so flood and wind are the risks that matter most, and today the borrower types whether the house is in a flood zone ("I'm not sure" is allowed). Use free public data.
>
> - **Flood zone on every address:** geocode with the U.S. Census Geocoder, then query FEMA's National Flood Hazard Layer (`hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`, the flood hazard zones layer; read the service directory for the current layer id) for the zone and whether it's a Special Flood Hazard Area. Store `deal.flood = { zone, sfha, checkedAt, source }`. An empty answer means "not mapped", not "no risk": say so. A zone A or V property gets a flood insurance condition automatically, and DSCR pricing counts a flood premium.
> - **Storm mode:** a nightly job (and a button) reads NHC's active storms file (the tropical cyclone status JSON; get its URL from NHC's reference PDF) and each storm's 5-day cone. When any LendHous property is inside a cone, owners get an email and a banner: the loans, balances, undrawn holdbacks, insurance expiry and whether windstorm is covered. After the storm passes, each of those borrowers gets a photo request (the existing photo requests) to show the property's condition, and draws on those loans need a fresh inspection.
> - **Portfolio view:** on Reports, balances by flood zone and by county.
> - **Tests:** the zone parsing from recorded FEMA answers (including "not mapped"), the point-in-cone test against a recorded cone, the condition added for zones A and V, and the alert routing.
>
> Sources: FEMA NFHL GIS services (hazards.fema.gov), NHC GIS data (nhc.noaa.gov/gis) and its tropical cyclone status JSON reference, U.S. Census Geocoder (geocoding.geo.census.gov).

### N. Draws in 24 hours, from the borrower's phone

> **Prompt.** Kiavi pays most draws from the borrower's photos without a site visit; Easy Street sends an inspection link to a phone. LendHous already takes draw photos and records inspections; make it fast and trustworthy.
>
> - **Photo per budget line:** the draw request walks the scope of work line by line on a phone, with the camera opening for each line, last draw's photo beside the new one, and the percent complete the borrower claims.
> - **Proof it's the property:** at each capture, ask for the phone's location (`navigator.geolocation`) and record the distance from the property's geocode and the time; phones' browsers often strip photo GPS, so don't rely on EXIF. Over 200 meters (PLACEHOLDER) or older than 48 hours is flagged on the staff side, never blocked.
> - **Inspector's link:** like the title company's link, a secure link for a third-party inspector with no account: the draw's lines, the borrower's photos, and a form for observed percent complete, their own photos (same location check) and notes, which records the inspection.
> - **The clock:** the 24-hour target from M on every draw, and a borrower-facing "We'll decide by" time.
> - **Tests:** the distance and freshness flags, the inspector link's scope (one draw, expires), and the existing lien-law holds still apply.
>
> Sources: kiavi.com (mobile draws, photo verification), easystreetcap.com/draw-request-faqs, Built Inspect (App Store).

### O. Text messages and notification settings

> **Prompt.** Investors live on their phones; email nudges for a missing bank statement get lost. And the owner seat has 35 unread notifications. Use Twilio behind `TWILIO_*` env keys.
>
> - **Consent first:** a separate, unchecked opt-in for texts on the application and in Account, with the wording, time and number stored (TCPA). STOP, HELP and START handled. Note in DEPLOY.md that US business texting needs A2P 10DLC brand and campaign registration before launch.
> - **Two-way:** texts to and from the borrower land in the loan's Messages thread, marked as texts; staff reply from the thread.
> - **What gets texted** (each can be turned off by the person): a document requested, a condition sent back, the term sheet ready, a draw decided, a payment due in 3 days or late, the closing date set. No loan amounts, account details or links that sign someone in.
> - **Notification settings:** per person and per event, choose email, text, in-app or a daily summary. The notification list groups by loan and marks a group read at once.
> - **Tests:** no text without consent, STOP stops everything, inbound texts match the right loan by number and are rejected when two loans' borrowers share it, and per-event settings.

### R. Investor buy-box and the money forecast

> **Prompt.** Partners bid loan by loan today. Groundfloor's Auto Investor and Baseline's investor portal show the next step: investors say what they want and are offered it first. GT also needs to see whether there's enough money for what's coming.
>
> - **Buy-box:** each partner sets products, counties, maximum LTV/LTARV, minimum rate, size per loan and a total cap. A loan that fits is offered to matching partners first, for a set number of hours (PLACEHOLDER), before the open deal feed; they still confirm each one. A partner sees committed, allocated and available money.
> - **Money forecast** for owners: the next 90 days of fundings (pipeline loans weighted by stage), undrawn holdbacks by expected draw date, and expected payoffs, against cash and partners' available money; a shortfall shows a warning and goes in the morning email.
> - **Attorney:** if participations are ever offered to people who aren't existing relationships, securities rules apply (Reg D); keep the buy-box for invited partners only until the attorney says otherwise.
> - **Tests:** matching rules, the first-look window, the forecast's weights against a fixture book, and a partner who can't see another's buy-box.
>
> Sources: groundfloor.com Auto Investor, mortgageautomator.com investor portal, Baseline (privatelenderlink.com interview).

### S. Fraud and concentration checks

> **Prompt.** Cheap checks catch most fraud in this business: the same person under different names, the same property twice, and a quick flip at a much higher price.
>
> - **Duplicates:** on every application and lead, look for the same phone, email, property, entity or guarantor on other loans and leads, and show matches on the loan with links.
> - **Price jumps:** when a property data vendor is chosen, compare the purchase price with the last recorded sale; until then, the processor enters the last sale and the check runs on it.
> - **Statement tampering:** the AI reader (K) flags statements whose totals don't add up or whose fonts and dates are inconsistent.
> - **Concentration:** on Reports, balances by borrower, county, product and flood zone, with limits in Settings (PLACEHOLDER) that warn before a term sheet goes out.
> - **Tests:** duplicate matching (normalized phones and addresses), the price-jump rule and the concentration warning.

### T. Ask LendHous (later)

> **Prompt.** A staff assistant that answers questions about the book in plain words ("which loans mature in 60 days with no exit chosen?", "what's left before LH-1003 can close?") and drafts replies to borrowers, using Claude (load the `claude-api` skill). It only sees what `scopeBook` gives the person asking, links every loan it mentions, never takes an action itself, and each question is in the audit log. Mortgage Automator now offers an MCP server for the same idea; an MCP server for LendHous can follow once this works.

### Needs a vendor chosen first

These gate the biggest speed wins (terms from a real value, closing in days, money in without chasing), so choose them now. Build the adapter behind an env key, and test with recorded fixtures.

- **Automated comps and ARV:** a property-data provider (RentCast or ATTOM) that fills an AVM and comparables on the quote (J) and the loan's numbers tab, labelled as an estimate, and gives S its last-sale check.
- **E-signature:** for term sheets, extension agreements and guaranties.
- **ACH payments:** autopay and one-time ACH through a payment processor, with NSF returns reversing the payment and pausing autopay after two returns.
- **Credit, ID and background checks:** a soft pull plus ID and KYC for each guarantor, with the consent record the application already captures.

### As volume grows

- **Collections and default workspace (Spec 8.3, 8.10, A26):** a call log, promise-to-pay tracking, notices with proof of delivery, a bankruptcy flag that pauses automated notices, workouts and modifications, foreclosure milestones, and REO with carrying costs and the loss split by allocation.
- **FinCEN AML program support:** case management for suspicious activity (SARs) with restricted access, the compliance officer and training log, and record retention (5 years for SARs, 10 for OFAC).
- **Partial releases and blanket loans (Spec 8.9):** several properties under one loan, release prices, and leverage re-tested after each release.
- **Data rights and breach response:** a document retention schedule with legal hold, "download my data" for borrowers, and a breach incident workflow with the Florida (Fla. Stat. 501.171) and FTC 30-day clocks.
- **Spanish** for the public site and borrower screens.

## Launch checklist (not code: for GT and whoever runs the server)

- **Email from LendHous's own domain.** Add and verify the domain in Resend (a few DNS records), then set `EMAIL_FROM`. Until then every sign-up, password and payoff email comes from another company's address.
- **Real numbers and wording.** Publish real pricing at `/admin/pricing`; the attorney supplies the application consents, the decline notice, the payoff letter, lien waiver forms, the extension agreement, the broker agreement, and the default and late-fee numbers.
- **Its own database login.** A dedicated Atlas user with read and write on the `lendhous` database only, instead of the shared admin login.
- **Settings.** LendHous's mailing address and phone (decline letters need them); whether borrowers can sign up on their own; turn off sample data before real clients sign in.
- **Deploy and HTTPS.** Sign-in needs https behind the proxy, and nginx has to let uploads over 1 MB through.
- **Brokers.** After deploying the broker program, existing brokers sign the agreement from their portal and an owner approves them on `/admin/brokers` before they can send new deals.

## Open decisions to ask GT about (don't guess)

- A licensed Florida photograph for the home page, to replace the drawing (I). Borrowers already choose whether to show their funded loan in "Recently funded".
- Whether to send borrower documents to Anthropic for reading, after reading its commercial data terms, and the monthly page cap (K).
- Texting: a Twilio account, the A2P 10DLC registration, and which events text by default (O).
- The speed targets (M) and the first-look window and caps for partners' buy-boxes (R).
- Which vendors to use for property data, e-sign, ACH, and credit and KYC.
- The second approver for funding and draws on jobs GT's construction company does (Spec 7.6).
- Who should have `assign_loans` and `view_reports` beyond the defaults.
- The repeat-borrower tiers (`adjusters.repeatTiers`, editable at `/admin/pricing`), and how long each carried-over document stays good (`CARRY_OVER` in `lib/repeat-borrower.ts`).
- The broker agreement's wording, its borrower-protection window (`PROTECTION_MONTHS`, 12 months), and whether an independent broker's fee counts toward Florida's usury cap (the attorney).
- Whether the CPA wants 1099-NECs for broker fees the title company pays out of the settlement, or only for fees LendHous pays itself.

N, S and L are built (2026-11-07 and 2026-11-08): draws line by line from the phone with the inspector's link and the "We'll decide by" clock, fraud and concentration checks, FEMA flood zones and storm mode. Next among the features that need no vendor or outside decision: the rest of 1.9 in docs/competitor-gaps.md (rollovers at payoff, swapping a partner mid-loan, pro-rata draw funding), then 1.4 (portfolio loans). K, O and R wait on GT (sending documents to Anthropic, a Twilio account, and the attorney on partner first looks). Before writing code, read the files it touches and outline the plan in a few lines.
