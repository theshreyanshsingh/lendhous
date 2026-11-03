# Lendhous

GT's private lending platform, built from Product Spec v3 (`product-spec-v3.pdf`, kept outside this repo). It runs on the same stack and infrastructure as UPB Capital (`../upb-capital-source`): Next.js 15, React 19, TypeScript, Tailwind 4 and shadcn, Prisma on MongoDB, signed-cookie sessions, R2 or Vercel Blob for files, and Resend or SMTP for mail. The look follows the LendHous brand board: cream `#FAFBF8`, dark green `#202B28` and sage `#677D67`, Georgia for headings and Verdana for text, with near-square corners from the marketing site. The tokens are in `app/globals.css`; the browser and home-screen icons (`app/icon.png`, `app/apple-icon.png`) are the brand's "L" mark.

Three layers live here today:

- **The public site.** The landing page at `/`, plus loan programs, investor guides, calculators, the quote request, about and disclosures, under `app/(site)`. No page needs an account. It was rebuilt from the LendHous marketing site's export, on the brand kit's colors and fonts. Its styles are in `app/(site)/site.css`, scoped under `.site` so they never reach the panel. The quote request saves each request, alerts the team (every owner-admin, plus `TEAM_EMAIL`), and lists it for staff at `/admin/leads`.
- **The panel.** Portal login on the site opens `/login`, and signing in opens the panel under `/admin`: the staff pipeline at `/admin`, `/admin/capital`, `/admin/deals`, `/admin/leads`, `/admin/loan-sales`, `/admin/draws`, `/admin/servicing`, `/admin/members` and `/admin/audit`, then `/admin/borrower`, `/admin/apply`, `/admin/partner`, `/admin/buyer`, `/admin/broker` and `/admin/account`. Also `/admin/new-loan`, `/admin/partners` and `/admin/settings`. Every page needs a signed-in account, and the account's role decides which section it opens. Real accounts work on the real loan book in the database: loans, documents, draws, payments, bids, sales and messages. The server checks every change against the person's role and sends each person only what they may see (`lib/book-access.ts`). Demo seats (`@lendhous.test`) get a shared book of FAKE demo records in the browser, and any account with no loans can load the same FAKE book for itself with **Load sample data**, until an owner turns that off in Settings. The rates in `lib/pricing-config.ts` are still placeholders; the owner replaces them at `/admin/pricing` (below).
- **Applying for a loan.** A borrower, a broker for a client, or staff from a phone call fills in one application at `/admin/apply`: the project and numbers with a live estimate, then the borrowing entity and its guarantors, past deals from the last 36 months, and seven credit questions. The loan is priced on the lowest guarantor's score and on the deals listed, not on numbers typed in, and its document list follows from the answers, each item saying why it's needed. Staff starting a loan without these leave them for the borrower, who is asked on their loan page. Before a term sheet can go out, someone with term sheet authority signs off the Credit review tab, where processors tick off each past deal against its settlement statement; signing off reprices the loan on the verified deals only.
- **The photo link.** `/photos/<token>` is the one page outside the public site that holds real records, and it needs no account. Staff or a borrower send a contractor or borrower a link from a draw or a loan's Documents tab. It walks them through the property and each budget line, saying what to photograph, and the photos appear on the draw by budget line. `/photos/demo` is a preview that sends nothing.
- **Servicing.** Staff record each payment received on a loan with its amount, date, method and reference, at `/admin/servicing` or on the loan's Servicing tab, and see where the money will go before saving it: the oldest payment due first, then late fees, then payments ahead of time, with anything smaller than a whole payment held as a credit. A nightly job (`servicing` in `lib/jobs.ts`) marks a payment late once its grace days pass and charges its late fee, moves a loan to delinquent at 30 days past due and to matured the day after maturity, and emails the borrower and the team: late notices, 30 and 90 days past due, maturity 60 and 30 days ahead, and matured. Payoffs add unpaid late fees and the default rate for days past maturity. Payments can be reversed and late fees waived, each with a reason, and the ledger is worked out again from what's stored, so the figures stay right either way. The grace days, late fee, delinquency and default rate are placeholders in `lib/pricing-config.ts` until the attorney sets them against the note.
- **How a loan ends, or gets more time.** Before funding, someone with term sheet authority can decline an application, and the borrower, or the team on their word, can withdraw it, each with a reason. Its capital and open bids are let go, it leaves the active pipeline, and the borrower and broker are told it was declined but not why: the reasons go in the attorney-approved notice. The team can reopen it. After funding, the owner can declare a default (payments, maturity, insurance, taxes or a covenant) with an effective date, which starts default interest and stops draws, and lift it once nothing is owed. A borrower can ask for an extension from 60 days before maturity and the team at any time; two people with extension authority approve it, and once the agreement is signed and the fee is in, the maturity moves and a matured or defaulted loan is current again. A payoff is recorded with the money received and refused if it's short of the payoff that day; it closes the loan, and the satisfaction of mortgage is tracked from sent to recorded against Florida's 60 days. The rules are in `lib/loan-exits.ts`; the extension limits and fee are placeholders in `lib/pricing-config.ts`.
- **The quote request.** The public site's `/start` page is a loan quote request a borrower or a broker can send. It covers the borrower (or the broker and their client), citizenship, credit band and experience; the property's address, with Google's suggestions when `GOOGLE_MAPS_API_KEY` is set, and its type; and the loan type, purpose, exit, numbers including the ARV, up to three comps supporting the ARV, and a funding date. The visitor sees indicative terms worked out by the same engine on the pricing the owner last published, with a clear "estimate, not an offer" note. The team gets a lead with the whole request sealed, and the leads inbox shows the address, ARV, credit band and comps (`lib/quote.ts`). `/programs` compares the four programs from the live pricing, so the advertised rates and leverage can't drift from what loans actually get (`lib/program-compare.ts`).
- **The borrower application link.** From a lead, or a loan still in review, a loan officer sends the borrower a secure link (`/apply/<token>`, no sign-in) to a five-step application. The steps are loan and contact, the property (with flood zone), the loan details, vesting and guarantors (each with date of birth, Social Security number, home address, marital status, citizenship, ownership and the declarations), and review and sign. It opens filled in with what's known, saves as they go, picks up where they left off, and works for 14 days; sending a new one turns the old one off. Signing takes four consents (placeholder wording until the attorney approves it) and the typed full legal name; the signature is kept with the time, IP address, consent version and a digest of what was signed. For a lead it starts the loan and invites the borrower to the portal; for a loan in review it updates the numbers and profile, keeping the loan's pricing. Birth dates, Social Security numbers, home addresses and the EIN stay sealed with the signed application and never enter the loan book. The loan's Credit review tab shows the application with numbers masked; revealing one takes `reveal_sensitive` and is logged (`lib/borrower-application.ts`, `lib/application-links.ts`). `/apply/demo` is a preview that sends nothing.
- **Motion.** Steps in the application link and the portal application rise and settle with Framer Motion, and forms that open under a button glide open. Slide-in panels use the same easing. Motion is short and vertical, so nothing passes a phone's edge mid-move, and it calms down for anyone who asks their device for less motion (`components/motion.tsx`).
- **Closing and funding.** From an accepted term sheet, the loan's Closing tab records the title company or closing attorney, the title company's checklist (title commitment, closing protection letter, settlement statement), and the wire instructions funding goes to. Instructions are entered in the portal only, never from an email, and the routing number's check digit is tested. Someone other than whoever entered them confirms them by calling a number found independently (the website, an earlier closing, a license lookup), and the call is logged. A loan can't be approved for funding, or funded, until that's done. New instructions replace the old ones, clear every funding approval, need a new call-back, and alert the team. Borrowers, brokers and partners never receive wire instructions (`lib/closing.ts`).
- **Sanctions screening (OFAC).** The borrowing company, the borrower and each guarantor are screened against Treasury's SDN list and its aliases when an application arrives or its guarantors change, and every night after. The nightly `sanctions` job downloads the list from Treasury and keeps the old one if a download fails. Names are compared regardless of word order, accents and company-type words, so a close spelling is caught but one shared surname isn't. A possible match holds the application until someone with `clear_ofac` reviews it, recording what they compared; a confirmed match stops all money on the loan and tells the team to report it. An application can't go to underwriting without a clean screening, and a loan can't fund or release a draw on one older than three days (`lib/ofac.ts`, `lib/sanctions-store.ts`).
- **Pricing you can change safely.** Every loan is priced on a pricing version and keeps it: its rate, points, leverage, late fee, default rate and extension terms come from the version it was quoted on, so publishing new numbers never moves a loan already priced. The owner edits rates, points, leverage, minimum scores, terms, loan sizes, fees and the note's late-payment and extension terms at `/admin/pricing`. They see what the change does to each application still in review before publishing it with a reason, and every version is kept and audited. Rates above 25% a year (criminal usury in Florida) can't be published, and anything above 18% is flagged for the attorney. New applications get the current version; staff can move an application still in review onto it with **Reprice on current pricing**. Loans saved before versions existed stay on the original numbers in `lib/pricing-config.ts` (`lib/pricing-versions.ts`, `lib/pricing-store.ts`).
- **The backend.** Sign-in, roles and permissions, encryption at rest, dual control, audit, storage, mail, jobs, health, and the release guard. The loan book is saved as JSON records (`BookRecord`), one per loan, bid, draw and so on, with the rules in `lib/book.ts`. Splitting those records into their own tables is still open, for when reporting across them needs it.

## Run

You need Node 22+ and a MongoDB replica set: Prisma needs one for transactions. Use either:

```bash
docker compose up -d          # mongo:7, one-node replica set (same as UPB)
npm run db:dev                # or: the same without Docker, data in .mongo-data/ (Ctrl-C to stop)
```

Then:

```bash
cp .env.example .env          # local defaults work as is; set CRON_SECRET to try /api/cron
npm install                   # postinstall runs prisma generate
npm run db:seed               # drops the local database, syncs validators and indexes, adds the demo seats
npm run dev                   # http://localhost:3000 is the public site; Portal login opens /login
```

`npm run db:indexes` syncs the MongoDB validators and indexes. It is safe to run again; the seed and release builds both run it. There are no migrations. As in UPB, never use `prisma db push`.

## Demo seats

The password for every seat is `Lendhous2026!`. They exist only in a seeded database, and the sign-in page lists them outside release builds.

| Seat | Email |
|---|---|
| Admin (owner) | olivia.owner@lendhous.test |
| Underwriter | uma.underwriter@lendhous.test |
| Processor | pat.processor@lendhous.test |
| Capital manager | cam.capital@lendhous.test |
| Draw inspector | ivan.inspector@lendhous.test |
| Borrower | alex.sample@lendhous.test |
| Partner lender | pia.partner@lendhous.test (Demo Partner Capital A) |
| Broker | bea.broker@lendhous.test |
| Loan buyer | bella.buyer@lendhous.test |

Each seat opens its own role's section of the panel. The demo records appear only for these seats, and seats share them in one browser, so a teaser sent as the owner reaches the partner seat. **Reset demo data** in the sidebar restores them. Only the title or closing agent role has no workspace yet, so it opens the security page.

Every role signs in with an email and password. Spec v3 10.1 asks for two-factor for staff, partner and broker users; it was taken out on purpose in November 2026.

## Tests

```bash
npm test                        # 344 tests: pricing engine (Spec worked examples A–I), foundations, who sees and does what in the loan book, loan stages, draws, payments and late fees, the nightly servicing check, declines, defaults, extensions and payoffs, pricing versions, wire verification, OFAC screening, quote requests, the application link and address lookup, loan buyer arithmetic, public site calculators and briefs, photo links, encryption at rest, the borrower profile and credit review, and MongoDB integration
npm run build && npm start      # then, with the server up:
npm run screenshots             # site and panel smoke test (234 checks: the public site, the quote request, each demo seat, the borrower, staff, broker, loan sale and members journeys, a default, an extension, a payoff, a decline, the pricing editor, an OFAC review, a wire call-back and the application link preview, and a temporary non-demo account) + screenshots into ./screenshots
npm run smoke:auth              # sign-in, where it returns to, rate limits, audit, cron, health (21 checks; needs db:seed)
npm run phone:check             # every page at 320, 375, 430 and 768px wide: nothing sticks out and nothing scrolls sideways (needs db:seed)
npm run smoke:real              # a website brief, then a loan's whole life with real accounts, each in its own browser, including a contractor with no account, a payment recorded and reversed, an application declined and reopened, new pricing published, wire instructions entered and verified by a second person, screening on arrival, a quote request from a phone, an application link filled in and signed on a phone with the Social Security number kept out of the loan book, what reaches each browser and what's stored encrypted (171 checks; needs db:seed; wipes the local loan book and leads)
```

The integration tests start their own MongoDB 7.0 replica set (`mongodb-memory-server`), so they need no running database. The smoke scripts use Google Chrome; set `CHROME=/path/to/chrome` if it isn't in the default macOS or Linux location.

## Where things live

| Path | What |
|---|---|
| `app/(site)`, `lib/site-content.ts`, `lib/site-calculators.ts` | The public site: its pages, copy and educational calculators |
| `app/admin` | The signed-in panel; each section's `layout.tsx` checks the role |
| `lib/pricing-config.ts`, `lib/engine.ts` | The pricing and underwriting engine, and the original pricing version |
| `lib/pricing-versions.ts`, `lib/pricing-store.ts`, `lib/pricing-draft.ts`, `actions/pricing.ts`, `app/admin/(staff)/pricing` | Which pricing each loan uses, the published versions, and the owner's editor |
| `lib/store.tsx`, `lib/mockData.ts` | The workspaces' browser state, and the FAKE demo book loaded only for demo seats |
| `prisma/schema.prisma` | Data model: users, organizations, roles, permission overrides, sessions, audit, notifications, documents, approvals, settings, jobs |
| `lib/auth.ts`, `lib/session.ts`, `actions/auth.ts` | Sessions (revocable, 30-minute staff idle timeout) and sign-in |
| `lib/permissions.ts` | The 14 roles, permission keys with dollar limits, the default matrix. `RolePermission` rows override cells, and a person's `extraPermissions` and `deniedPermissions` override their roles |
| `lib/members.ts`, `lib/member-rules.ts`, `actions/members.ts`, `app/admin/(staff)/members` | The members page: invite, change access, remove, and the one-time password link |
| `lib/book.ts`, `lib/book-store.ts` | The loan book's rules, and saving each change to the database all or nothing |
| `lib/book-access.ts`, `lib/book-actions.ts` | Who sees and may do what, and the shape of a request from a browser. Everything real accounts send or receive passes through these |
| `lib/book-alerts.ts`, `lib/attention.ts`, `lib/csv.ts` | Who gets told what, the pipeline's Needs attention list, and spreadsheet exports |
| `actions/book.ts`, `app/api/documents` | Changing the book, starting a loan, storing a loan file, and opening one (every open is logged) |
| `lib/loan-stages.ts` | The steps from application to servicing and what blocks each one |
| `lib/credit.ts`, `components/SponsorForm.tsx`, `components/SponsorEditor.tsx`, `components/loan/CreditReview.tsx` | Guarantors, past deals and credit questions: the rules, the needs list each application produces, the forms, and the staff sign-off |
| `lib/draws.ts`, `lib/servicing.ts`, `lib/loan-exits.ts`, `components/loan`, `app/admin/(staff)/draws`, `app/admin/(staff)/servicing` | Scope of work, draw requests and release, the payment ledger (late fees, credits, reversals, waivers, maturity), declines, defaults, extensions, payoffs and mortgage releases, on top of the engine's draw and payoff math |
| `app/admin/broker`, `components/ApplicationWizard.tsx` | The broker's deals and fees, and the application form borrowers and brokers share |
| `lib/notifications.ts`, `app/admin/account/notifications`, `app/admin/(staff)/audit`, `app/login/forgot` | The notifications inbox, the audit log and forgotten passwords |
| `lib/loan-sale.ts`, `app/admin/buyer`, `app/admin/(staff)/loan-sales` | Selling funded loans: the blind loan tape and yield math, the buyer's workspace, and the staff side |
| `lib/crypto.ts`, `lib/encrypt-data.ts`, `lib/lead-store.ts` | AES-256-GCM encryption with key ids for rotation, bound to field, row or file, and the step that encrypts older records (see below) |
| `lib/photo-requests.ts`, `lib/photo-links.ts`, `actions/photo-links.ts`, `app/photos`, `app/api/photo-links`, `components/PhotoGuide.tsx`, `components/loan/PhotoRequests.tsx` | The photo link: the guide for each budget line, when a link still works, the page contractors see, and the staff side |
| `lib/quote.ts`, `app/(site)/start`, `lib/program-compare.ts`, `lib/places.ts`, `app/api/places`, `components/AddressField.tsx` | The quote request, the program comparison, and address lookup through the server |
| `lib/borrower-application.ts`, `lib/application-links.ts`, `actions/application-links.ts`, `app/apply`, `components/BorrowerApplication.tsx` | The secure application link: the form's rules, its sealed storage, sending and signing it |
| `lib/closing.ts`, `components/loan/ClosingPanel.tsx` | The closing agent, the title checklist, and wire instructions with their call-back |
| `lib/ofac.ts`, `lib/sanctions-store.ts`, `components/loan/OfacPanel.tsx` | Reading Treasury's sanctions list, matching names, the gates, and the review of a possible match |
| `lib/approvals.ts`, `lib/mongo-validators.ts` | Dual control: app rules, plus a MongoDB validator that rejects the same mistakes |
| `lib/audit.ts` | Append-only audit events with before/after values, IP and request id; secrets are redacted |
| `lib/storage.ts`, `lib/email.ts`, `lib/jobs.ts` | Files (R2/S3, Blob, local, always encrypted first), mail (Resend/SMTP/log), daily jobs: the sanctions check, the servicing check, housekeeping and encryption |
| `lib/deploy.ts`, `scripts/release.ts`, `lib/bootstrap.ts` | Release guard and production bootstrap (see DEPLOY.md) |
| `app/api/health`, `app/api/cron` | Health (modes only, no secrets) and the cron entry points |

## What is encrypted

With `FIELD_ENCRYPTION_KEYS`, before anything is stored:

- every loan book record: names, addresses, credit scores, liquidity, messages, draw contacts and photo requests
- a website brief's name, email, phone, city, state and notes
- saved alerts in the notifications inbox
- every stored file and its name, so the bucket only ever holds ciphertext

Sign-in email addresses, account names and phone numbers are not, because sign-in and alerts look people up by them. The audit log holds who did what and from where, not the details. Passwords are hashed, and password and photo links are stored only as hashes. Files always come through the signed-in route rather than a signed link to the bucket, since the bucket can't decrypt them.

Records saved before this still read. `npm run db:encrypt` and the daily job encrypt them, and move records to the newest key after a rotation. To rotate, put the new key first (`k2:...,k1:...`), run `db:encrypt`, and only then remove the old key.

## MongoDB instead of PostgreSQL

Spec v3 assumes PostgreSQL. Lendhous uses MongoDB to match UPB, and covers the gaps this way:

- **No row-level security.** Every server action checks `can()` from `lib/permissions.ts`, and from B1 every loan query goes through one data layer scoped to the viewer.
- **No CHECK constraints.** Collection validators in `lib/mongo-validators.ts`, applied by `db:indexes`, reject rule-breaking writes at the database. Dual approval is the first one.
- **No migrations.** Schema changes need a backfill script under `scripts/` when existing documents must change.
- **32-bit `Int`.** Money is integer cents. Loan-level amounts fit (cap $21.4M). Capital totals will use `BigInt` when they arrive (B3).
- **Append-only ledgers (B4).** An Atlas custom role without update or delete rights on the ledger collections, used through a second connection.

## Still to build

Milestones B1 to B4 move the workspaces' records onto this backend: borrower applications and documents, then underwriting and term sheets, then capital routing and the partner portal, then closing, funding, the loan ledger and draws. See the backend plan and Spec v3 Section 13.
