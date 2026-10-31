# Lendhous

GT's private lending platform, built from Product Spec v3 (`product-spec-v3.pdf`, kept outside this repo). It runs on the same stack and infrastructure as UPB Capital (`../upb-capital-source`): Next.js 15, React 19, TypeScript, Tailwind 4 and shadcn, Prisma on MongoDB, signed-cookie sessions, R2 or Vercel Blob for files, and Resend or SMTP for mail. The look follows the LendHous brand board: cream `#FAFBF8`, dark green `#202B28` and sage `#677D67`, Georgia for headings and Verdana for text, with near-square corners from the marketing site. The tokens are in `app/globals.css`; the browser and home-screen icons (`app/icon.png`, `app/apple-icon.png`) are the brand's "L" mark.

Three layers live here today:

- **The public site.** The landing page at `/`, plus loan programs, investor guides, calculators, the deal-brief form, about and disclosures, under `app/(site)`. No page needs an account. It was rebuilt from the LendHous marketing site's export, on the brand kit's colors and fonts. Its styles are in `app/(site)/site.css`, scoped under `.site` so they never reach the panel. The Let's talk form saves each brief, alerts the team (every owner-admin, plus `TEAM_EMAIL`), and lists it for staff at `/admin/leads`.
- **The panel.** Portal login on the site opens `/login`, and signing in opens the panel under `/admin`: the staff pipeline at `/admin`, `/admin/capital`, `/admin/deals`, `/admin/leads`, `/admin/loan-sales`, `/admin/draws`, `/admin/servicing`, `/admin/members` and `/admin/audit`, then `/admin/borrower`, `/admin/apply`, `/admin/partner`, `/admin/buyer`, `/admin/broker` and `/admin/account`. Also `/admin/new-loan`, `/admin/partners` and `/admin/settings`. Every page needs a signed-in account, and the account's role decides which section it opens. Real accounts work on the real loan book in the database: loans, documents, draws, payments, bids, sales and messages. The server checks every change against the person's role and sends each person only what they may see (`lib/book-access.ts`). Demo seats (`@lendhous.test`) get a shared book of FAKE demo records in the browser, and any account with no loans can load the same FAKE book for itself with **Load sample data**, until an owner turns that off in Settings. The rates in `lib/pricing-config.ts` are still placeholders.
- **The backend.** Sign-in, two-factor, roles and permissions, field encryption, dual control, audit, storage, mail, jobs, health, and the release guard. The loan book is saved as JSON records (`BookRecord`), one per loan, bid, draw and so on, with the rules in `lib/book.ts`. Splitting those records into their own tables is still open, for when reporting across them needs it.

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

Spec v3 10.1 requires two-factor for staff, partner and broker users. They get a six-digit code by email at each sign-in. The demo seed turns that off (`PlatformSettings.requireStaffMfa = false`) so the seats sign in quickly; production keeps it on. Anyone else can turn codes on at `/admin/account/security`. Demo addresses take no mail, so their codes print in the server log.

## Tests

```bash
npm test                        # 166 tests: pricing engine (Spec worked examples A–I), foundations, who sees and does what in the loan book, loan stages, draws, payments, loan buyer arithmetic, public site calculators and briefs, and MongoDB integration
npm run build && npm start      # then, with the server up:
npm run screenshots             # site and panel smoke test (178 checks: the public site, each demo seat, the borrower, staff, broker, loan sale and members journeys, and a temporary non-demo account) + screenshots into ./screenshots
npm run smoke:auth              # sign-in, emailed codes, the role requirement, rate limits, audit, cron, health (25 checks; needs db:seed)
npm run phone:check             # every page at 320, 375, 430 and 768px wide: nothing sticks out and nothing scrolls sideways (needs db:seed)
npm run smoke:real              # a loan's whole life with real accounts, each in its own browser, including what reaches each browser (68 checks; needs db:seed; wipes the local loan book)
```

The integration tests start their own MongoDB 7.0 replica set (`mongodb-memory-server`), so they need no running database. The smoke scripts use Google Chrome; set `CHROME=/path/to/chrome` if it isn't in the default macOS or Linux location.

## Where things live

| Path | What |
|---|---|
| `app/(site)`, `lib/site-content.ts`, `lib/site-calculators.ts` | The public site: its pages, copy and educational calculators |
| `app/admin` | The signed-in panel; each section's `layout.tsx` checks the role |
| `lib/pricing-config.ts`, `lib/engine.ts` | The pricing and underwriting engine and its one editable config file |
| `lib/store.tsx`, `lib/mockData.ts` | The workspaces' browser state, and the FAKE demo book loaded only for demo seats |
| `prisma/schema.prisma` | Data model: users, organizations, roles, permission overrides, sessions, audit, notifications, documents, approvals, settings, jobs |
| `lib/auth.ts`, `lib/session.ts`, `lib/login-code.ts`, `actions/auth.ts`, `actions/security.ts` | Sessions (revocable, 30-minute staff idle timeout), sign-in, emailed sign-in codes |
| `lib/permissions.ts` | The 14 roles, permission keys with dollar limits, the default matrix. `RolePermission` rows override cells, and a person's `extraPermissions` and `deniedPermissions` override their roles |
| `lib/members.ts`, `lib/member-rules.ts`, `actions/members.ts`, `app/admin/(staff)/members` | The members page: invite, change access, remove, and the one-time password link |
| `lib/book.ts`, `lib/book-store.ts` | The loan book's rules, and saving each change to the database all or nothing |
| `lib/book-access.ts`, `lib/book-actions.ts` | Who sees and may do what, and the shape of a request from a browser. Everything real accounts send or receive passes through these |
| `lib/book-alerts.ts`, `lib/attention.ts`, `lib/csv.ts` | Who gets told what, the pipeline's Needs attention list, and spreadsheet exports |
| `actions/book.ts`, `app/api/documents` | Changing the book, starting a loan, storing a loan file, and opening one (every open is logged) |
| `lib/loan-stages.ts` | The steps from application to servicing and what blocks each one |
| `lib/draws.ts`, `lib/servicing.ts`, `components/loan`, `app/admin/(staff)/draws`, `app/admin/(staff)/servicing` | Scope of work, draw requests and release, payment history and payoff statements, on top of the engine's draw and payoff math |
| `app/admin/broker`, `components/ApplicationWizard.tsx` | The broker's deals and fees, and the application form borrowers and brokers share |
| `lib/notifications.ts`, `app/admin/account/notifications`, `app/admin/(staff)/audit`, `app/login/forgot` | The notifications inbox, the audit log and forgotten passwords |
| `lib/loan-sale.ts`, `app/admin/buyer`, `app/admin/(staff)/loan-sales` | Selling funded loans: the blind loan tape and yield math, the buyer's workspace, and the staff side |
| `lib/crypto.ts` | AES-256-GCM field encryption with key ids for rotation, bound to field and row |
| `lib/approvals.ts`, `lib/mongo-validators.ts` | Dual control: app rules, plus a MongoDB validator that rejects the same mistakes |
| `lib/audit.ts` | Append-only audit events with before/after values, IP and request id; secrets are redacted |
| `lib/storage.ts`, `lib/email.ts`, `lib/jobs.ts` | Files (R2/S3, Blob, local, five-minute signed links), mail (Resend/SMTP/log), daily jobs (UPB patterns) |
| `lib/deploy.ts`, `scripts/release.ts`, `lib/bootstrap.ts` | Release guard and production bootstrap (see DEPLOY.md) |
| `app/api/health`, `app/api/cron` | Health (modes only, no secrets) and the cron entry points |

## MongoDB instead of PostgreSQL

Spec v3 assumes PostgreSQL. Lendhous uses MongoDB to match UPB, and covers the gaps this way:

- **No row-level security.** Every server action checks `can()` from `lib/permissions.ts`, and from B1 every loan query goes through one data layer scoped to the viewer.
- **No CHECK constraints.** Collection validators in `lib/mongo-validators.ts`, applied by `db:indexes`, reject rule-breaking writes at the database. Dual approval is the first one.
- **No migrations.** Schema changes need a backfill script under `scripts/` when existing documents must change.
- **32-bit `Int`.** Money is integer cents. Loan-level amounts fit (cap $21.4M). Capital totals will use `BigInt` when they arrive (B3).
- **Append-only ledgers (B4).** An Atlas custom role without update or delete rights on the ledger collections, used through a second connection.

## Still to build

Milestones B1 to B4 move the workspaces' records onto this backend: borrower applications and documents, then underwriting and term sheets, then capital routing and the partner portal, then closing, funding, the loan ledger and draws. See the backend plan and Spec v3 Section 13.
