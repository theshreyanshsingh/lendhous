# Lendhous: next features build prompt

Paste everything below the line into a new Claude Code session opened in `~/Desktop/Lendhous`.

---

You're continuing work on **Lendhous**, a private (hard-money) lending platform for a Florida lender, LendHous, and its owner GT. It makes business-purpose fix and flip, bridge, ground-up construction and DSCR rental loans to investors and their LLCs, funded with its own money and partner lenders' money. Read `README.md` and `DEPLOY.md` first; they describe what's built and where it lives.

## How this codebase works (follow it exactly)

- **Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind 4, Prisma 6 on MongoDB (a replica set, no migrations, never `prisma db push`; `npm run db:indexes` syncs indexes from the schema), zod, vitest, playwright-core scripts, Framer Motion 12.23.12 (pinned with `motion-dom`/`motion-utils` overrides: newer `motion-dom` breaks the build).
- **The loan book:** one reducer (`lib/book.ts`) applies every `BookAction`. `lib/book-access.ts` `authorize` checks each action against the viewer's role and permissions; actions that only the server may take run as `trusted`. `lib/book-actions.ts` `parseAction` is the zod shape of anything a browser sends. `lib/book-store.ts` saves only the changed records, encrypted, with an optimistic version lock. `lib/book-alerts.ts` decides who is emailed. `scopeBook` strips what each role mustn't see.
- **Rules live in pure `lib/*.ts` modules**, and the reducer, `authorize` and the screens all call the same functions. Examples: `lib/loan-exits.ts`, `lib/closing.ts`, `lib/ofac.ts`, `lib/borrower-application.ts`. A new feature gets its own rules module the same way.
- **Pricing is versioned:** every loan carries `app.pricingVersion` (`lib/pricing-versions.ts`). Anything that belongs in a loan's note (rates, late fees, extension terms) must be read through the loan's own version, never `pricingConfig` directly.
- **Sensitive data:** the loan book is encrypted at rest but sent in full to staff browsers. So SSNs, dates of birth, EINs and bank account numbers stay out of it, sealed in their own records (see `lib/application-links.ts`). Showing them takes `reveal_sensitive` and writes `pii.revealed` to the audit log.
- **Demo seats** (`@lendhous.test`) run a fake book in the browser; real accounts use the database. New features must work in both, or show a clear demo note.
- **Copy:** plain, short sentences for borrowers and staff alike. No jargon on borrower screens. Every new screen must fit a 320px phone with no sideways scrolling.
- **Placeholders:** every legal or money number the attorney or GT hasn't set is marked PLACEHOLDER in code and listed in the README.

## Constraints

- Commit or push only when the user asks. Never print `.env` values.
- Don't re-add two-factor sign-in (removed at the user's request on 2026-11-01).
- Production runs under pm2 on a shared AWS server (port 3011). The daily jobs (`lendhous-jobs`) run `lib/jobs.ts`.

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

## The features, in priority order

Build them in this order, one at a time. Finish each to the definition of done before starting the next, and stop after each one to report.

### Tier 1: needed before real money moves

1. **Title / closing agent link (Spec T1–T3).** A secure, expiring link per loan, built like `lib/photo-links.ts`, sent from the Closing tab. Through it the title company:
   - enters its own wire instructions, which still need the call-back by LendHous staff (`lib/closing.ts`);
   - uploads the title commitment, closing protection letter, settlement statement drafts and final, signed loan documents, and the recorded mortgage, each updating the closing checklist for a processor to accept;
   - confirms funds received.

   Done when no one at LendHous types title's wire numbers, and every closing document arrives through the link.

2. **Payoff statements that meet Fla. Stat. 701.04.** Add:
   - a public "Request a payoff" form for borrowers and title companies, with proof of a third party's authority;
   - logging of each request's received date and a 10-day due date (shown today on `/admin/servicing`);
   - a generated, itemized payoff letter: principal, interest, default interest, fees, credit, per diem and good-through date, without wire instructions;
   - corrected letters when figures change.

   The satisfaction-of-mortgage tracking already exists (`PaidOff.tsx`).

3. **Term sheet builder and documents (Spec A9, B16).**
   - Underwriters set rate and points within the matrix range; going outside it needs an owner's `approve_matrix_exception` approval, which is logged.
   - Each term sheet is a numbered version with a PDF; the borrower sees only the latest.
   - Term sheets expire after a set number of days (placeholder: 7).
   - The borrower can accept, ask for changes (back to underwriting) or decline (withdrawn).
   - Lock the loan's rate and points on acceptance.
   - Generate PDFs on the server; pick a maintained library and justify it.

4. **Conditions (Spec A10, B17).** Conditions are separate from documents and have:
   - a category: prior-to-docs, prior-to-funding or post-closing;
   - an owner, a due date, and a status of open, submitted, cleared or waived (waiving needs permission and a reason);
   - a conditions library in settings.

   Clear to close requires every prior-to-funding condition cleared or waived. The borrower sees theirs with upload buttons.

5. **Draw protections under Florida construction lien law (Ch. 713).**
   - Before the first draw: record the Notice of Commencement date and check it's after the mortgage was recorded. Track the NOC's 1-year expiry and 90-day start rule.
   - Log notices to owner.
   - Each draw: collect conditional progress lien waivers (statutory forms, §713.20) from the contractor and every lienor who served a notice.
   - Final draw: collect the contractor's final payment affidavit (§713.06(3)(d)) and final waivers.
   - Block release without them, with an admin override that requires a reason.
   - Track builder's risk or hazard insurance expiry, alert at 30 days, and block draws on a lapsed policy.

6. **Adverse action notices (Reg B, 12 CFR 1002.9).**
   - Timestamp when an application becomes complete, and capture the business's gross revenue for the prior year.
   - On decline, generate the attorney-approved notice: within 30 days for revenue of $1M or less; on written request within 60 days above that. Track the deadline and when it was sent.
   - Keep applications and notices for 12 months, or longer under legal hold.

7. **Business dashboard and daily digest (Spec 11).** One `/admin/reports` page with date filters and CSV export:
   - **Pipeline:** applications, term sheets and fundings by source; pull-through; cycle times; stuck deals over 7 days; decline and withdraw reasons (already stored).
   - **Capital:** deployed, available, concentration, routing mix.
   - **Portfolio:** weighted average coupon, delinquency buckets (1–30, 31–60, 61–90, 90+), maturities in 30, 60 and 90 days, extension rate.

   Also a daily digest email to the owner ("Today: 3 new applications, $1.2M in term sheets, 1 draw awaiting approval") as a new job in `lib/jobs.ts`.

8. **Reliability.**
   - Error monitoring (Sentry or similar, behind an env key, with no PII in events).
   - A staging environment documented in DEPLOY.md.
   - A health-check alert when `servicingCheckedAt` or `sanctionsListAt` is more than 2 days old.
   - A database restore test script.

### Tier 2: keeping capital partners and borrowers

9. **Partner and buyer portfolio and statements (Spec P7–P9, 8.6).**
   - The winning partner sees verified funding instructions and marks funds sent; staff mark funds received.
   - "My portfolio" shows each funded loan's balance, rate, status, payments received, draws and payoffs.
   - Monthly distribution statements per partner and per loan buyer: interest, principal, fees, servicing fee withheld, balances, delinquency. PDF and CSV.

10. **Tax forms.** Collect a W-9 (sealed) from partners, buyers and brokers before paying them.
    - Year-end exports: 1099-INT for participants (with CPA review flagged) and 1099-NEC for broker fees of $2,000 or more (paid after 2025).
    - 1098 only for interest from individuals, not entities.

11. **Pre-approval and proof-of-funds letters (Spec 12.3).** For repeat borrowers and GT's wholesale and realty clients: a generated PDF letter with a QR code to a public verify page. It has a limit, an expiry, and it can be revoked.

12. **Repeat-borrower fast track.** Saved entities and guarantors reused on the next application, the `repeatBorrower` pricing adjuster applied from history, and a one-click "new loan on another property".

13. **Broker program (Spec R1–R6).**
    - Broker sign-up with licence number, W-9 and a signed broker agreement, approved by staff before deals can be submitted.
    - Broker fees tracked as expected, paid or unpaid.
    - White-label quote PDFs.
    - A referral link with attribution on the quote form.

### Tier 3: needs a vendor chosen first (build the adapter behind an env key, test with recorded fixtures)

14. **Credit, ID and background checks:** a soft pull plus ID and KYC for each guarantor, with the consent record already captured by the application link's credit authorization.
15. **ACH payments:** autopay and one-time ACH through a payment processor, with NSF returns reversing the payment and pausing autopay after two returns.
16. **Automated comps and ARV:** a property-data provider (RentCast or ATTOM) that fills an AVM and comparables on the quote form and the loan's numbers tab, labelled as an estimate.
17. **E-signature:** for term sheets, extension agreements and guaranties.

### Tier 4: as volume grows

18. **Collections and default workspace (Spec 8.3, 8.10, A26):** a call log, promise-to-pay tracking, notices with proof of delivery, a bankruptcy flag that pauses automated notices, workouts and modifications, foreclosure milestones, and REO with carrying costs and the loss split by allocation.
19. **FinCEN AML program support:** case management for suspicious activity (SARs) with restricted access, the compliance officer and training log, and record retention (5 years for SARs, 10 for OFAC).
20. **Partial releases and blanket loans (Spec 8.9):** several properties under one loan, release prices, and leverage re-tested after each release.
21. **Data rights and breach response:** a document retention schedule with legal hold, "download my data" for borrowers, and a breach incident workflow with the Florida (Fla. Stat. 501.171) and FTC 30-day clocks.
22. **Spanish** for the public site and borrower screens.

## Open decisions to ask GT about (don't guess)

- Real rates, points, leverage and fees: entered at `/admin/pricing`.
- Which vendors to use for credit and KYC, ACH, property data, e-sign and error monitoring.
- The attorney's wording for: the four application consents (`lib/borrower-application.ts` `CONSENTS`), the adverse action notice, the payoff letter, lien waiver forms, the extension agreement, and the default and late-fee numbers.
- The second approver for funding and draws on jobs GT's construction company does (Spec 7.6).

Start with feature 1. Before writing code, read the files it touches and outline the plan in a few lines.
