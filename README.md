# Lendhous

GT's private lending platform, built from Product Spec v3 (`product-spec-v3.pdf`, kept outside this repo). It runs on the same stack and infrastructure as UPB Capital (`../upb-capital-source`): Next.js 15, React 19, TypeScript, Tailwind 4 and shadcn, Prisma on MongoDB, signed-cookie sessions, R2 or Vercel Blob for files, and Resend or SMTP for mail. The look follows the LendHous brand board: cream `#FAFBF8`, dark green `#202B28` and sage `#677D67`, Georgia for headings and Verdana for text, with near-square corners from the marketing site. The tokens are in `app/globals.css`; the browser and home-screen icons (`app/icon.png`, `app/apple-icon.png`) are the brand's "L" mark.

Three layers live here today:

- **The public site.** The landing page at `/`, plus loan programs, investor guides, calculators, the deal-brief form, about and disclosures, under `app/(site)`. No page needs an account. It was rebuilt from the LendHous marketing site's export, on the brand kit's colors and fonts. Its styles are in `app/(site)/site.css`, scoped under `.site` so they never reach the panel. The Let's talk form saves each brief, alerts the team (every owner-admin, plus `TEAM_EMAIL`), and lists it for staff at `/admin/leads`.
- **The panel.** Portal login on the site opens `/login`, and signing in opens the panel under `/admin`: the staff pipeline at `/admin`, `/admin/capital` and `/admin/deals`, `/admin/leads`, then `/admin/borrower`, `/admin/apply`, `/admin/partner` and `/admin/account/security`. Every page needs a signed-in account, and the account's role decides which section it opens. Their records still live in the browser. Demo seats (`@lendhous.test`) get a shared book of FAKE demo records. Every other account starts empty until B1 to B4 move the records into the database. The rates in `lib/pricing-config.ts` are still placeholders.
- **Milestone B0, the backend foundations.** Sign-in, two-factor, roles and permissions, field encryption, dual control, audit, storage, mail, jobs, health, and the release guard. Later milestones (B1 to B4) move the workspaces' records onto this backend one at a time.

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

Each seat opens its own role's section of the panel. The demo records appear only for these seats, and seats share them in one browser, so a teaser sent as the owner reaches the partner seat. **Reset demo data** in the sidebar restores them. The broker seat has no workspace yet, so it opens the security page.

Spec v3 10.1 requires two-factor for staff, partner and broker users. The demo seed turns that off (`PlatformSettings.requireStaffMfa = false`) so the seats sign in quickly; production keeps it on. Set up an authenticator at `/admin/account/security`.

## Tests

```bash
npm test                        # 88 tests: pricing engine (Spec worked examples A–I), foundations, public site calculators and briefs, and MongoDB integration
npm run build && npm start      # then, with the server up:
npm run screenshots             # site and panel smoke test (62 checks: the public site, each demo seat and a temporary non-demo account) + screenshots into ./screenshots
npm run smoke:auth              # sign-in, two-factor, recovery codes, rate limit, audit, cron, health (18 checks; needs db:seed)
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
| `lib/auth.ts`, `lib/session.ts`, `actions/auth.ts`, `actions/security.ts` | Sessions (revocable, 30-minute staff idle timeout), sign-in, two-factor (ported from UPB) |
| `lib/permissions.ts` | The 13 roles, permission keys with dollar limits, the default matrix. `RolePermission` rows override cells |
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
