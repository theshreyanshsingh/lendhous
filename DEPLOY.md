# Deploy Lendhous

This follows UPB Capital's DEPLOY.md: Vercel plus MongoDB Atlas, or a plain Node server under pm2. Nothing in this repo deploys itself.

## Before the first production deploy

Lendhous will hold SSNs, credit reports and bank details, so it gets stricter isolation than UPB:

1. **Database.** Use a separate Atlas project or cluster for Lendhous, not SynergyFund's shared cluster. Create a database user whose only role is `readWrite` on the `lendhous` database. Do not reuse SynergyFund's or UPB's user.
2. **Encryption keys.** Generate `FIELD_ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"` and keep a copy in the password manager. The whole loan book, every brief and every stored file are encrypted with it, so **losing it loses all of them, and a database backup won't bring them back**. Before real SSNs arrive, move to AWS KMS envelope keys (pre-launch item, Spec v3 10.2).
3. **Files.** Borrowers upload bank statements and IDs here, so use Lendhous's own private bucket, not one shared with another app. Malware scanning on upload is still open (Spec v3 10.2).

## Checklist (Vercel + Atlas)

1. In Atlas, create the user above and allow Vercel to connect (`0.0.0.0/0` with a strong password, since Vercel has no fixed IP). Put `/lendhous` after the host in the connection string.
2. In Vercel, import the repo. Framework preset: Next.js. Build command: `npm run build`.
3. Set the required variables below for **Production** and **Preview**. A build without them fails closed.
4. Deploy, then sign in at `https://<domain>/login` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Use an inbox you can read for `ADMIN_EMAIL`, since password links and team alerts go there.
5. Check `https://<domain>/api/health`: `db` is `ok`, `storage` is `s3` or `blob`, `encryption` is `keys`. After the first night, `servicingCheckedAt` shows when the servicing check last ran; point an uptime monitor at it, since late payments go unnoticed while the daily job is stopped. `sanctionsListAt` shows when Treasury's OFAC list was last downloaded; alert if it's more than two days old, because loans can't fund or release draws on a screening older than three days.

`vercel.json` schedules `GET /api/cron` daily at 06:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`.

## What the build does

`npm run build` runs `scripts/release.ts` when `VERCEL=1` or `LENDHOUS_RELEASE=1`. The script:

- refuses to start unless every required variable is present
- refuses a `DATABASE_URL` that names no database, or names `synergifund`, `upb_capital`, `admin`, `local` or `config`
- refuses the demo auth secret, the development encryption key, `@lendhous.test` addresses, the demo password, a non-https origin, and `ALLOW_HTTP_SESSIONS`
- syncs the MongoDB validators and indexes
- creates one approved owner-admin in the lender-house organization, plus the settings row, and nothing else; it refuses a database that already holds demo seats
- clears what the old two-factor sign-in left in the database: authenticator secrets, recovery codes, unused sign-in codes and their settings

Demo seats can't exist on a release database, so to see another role there, invite a second email address from the Members page with that role, sign in as it, and press **Load sample data**. Turn **Offer sample data** off in Settings before real clients sign in.

`prisma/seed.ts` drops the database first, so it refuses to run when `NODE_ENV=production`, `VERCEL=1` or `LENDHOUS_RELEASE=1` is set.

## Required

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Atlas → Connect → Drivers, with Lendhous's own user: `mongodb+srv://<user>:<password>@<host>/lendhous?retryWrites=true&w=majority` |
| `AUTH_SECRET` | `openssl rand -base64 32` (at least 32 characters) |
| `FIELD_ENCRYPTION_KEYS` | `k1:$(openssl rand -base64 32)`. To rotate, put the new key first: `k2:...,k1:...` |
| `NEXT_PUBLIC_APP_URL` | The public `https://` origin |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first owner-admin. Password at least 12 characters, applied only when the account is created |
| `CRON_SECRET` | `openssl rand -base64 32` |
| Storage | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION=auto` (R2), or a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`) |
| Mail | `RESEND_API_KEY` + `EMAIL_FROM`, or `SMTP_HOST` + `EMAIL_FROM`. Invites, forgot-password links and alerts go this way |

Optional: `ADMIN_NAME`, `LENDER_NAME`, `TEAM_EMAIL`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `S3_PREFIX`, `RATE_LIMIT_STORE`, `GOOGLE_MAPS_API_KEY` (a Places API (New) key for address suggestions; without it people type the address. Enable the Street View Static API on the same key and loans without a photo show Street View of the property; without it they show a drawing), `SENTRY_DSN` (also send server errors to Sentry; they're always kept on the Errors page).

## If mail stops working

Sign-in keeps working, but invites, forgot-password links, photo links and alerts don't arrive. An admin can still copy a password link from Members, a photo link from the draw and a title company's link from the Closing tab when it's sent, and download a payoff letter's PDF from the loan's Servicing tab (the letter says it wasn't emailed; Florida's 10 days still run), and website briefs still reach the leads inbox.

## A plain server under pm2

SynergyFund holds port 3007 and UPB holds 3009 on the shared server, so pick another free port.

```bash
npm ci && npm run db:indexes && LENDHOUS_RELEASE=1 npm run build
pm2 start node_modules/.bin/next --name lendhous -- start -p <port> -H 0.0.0.0
pm2 start node_modules/.bin/tsx --name lendhous-jobs --cron-restart "0 6 * * *" --no-autorestart -- --env-file=.env scripts/jobs.ts
pm2 save
```

To update it later. The build regenerates the database client and syncs the indexes, so schema changes need no extra step. Use `npm ci` first if `package.json` added a package: the payoff letters release added `pdfkit`, which makes the letters' PDFs on the server and needs nothing else installed. Payoff letters carry `LENDER_NAME` as the letterhead, so set it to the lender's legal name. **After the Reg B release, an owner adds LendHous's mailing address (and phone) in Settings**: decline notices can't be sent without it. **Before the first draw after the lien-law release, fill in each funded rehab or construction loan's lien file on its Closing tab** (contractor, Notice of Commencement, insurance, any notices to owner): until then its draws are held, by design. That release also adds an `override_draw_holds` permission (owners by default). The conditions release adds a `waive_conditions` permission (owners and underwriters by default); give it to anyone else who should waive conditions on the Members page. **The property photos and sign-up release opens `/login/signup` to anyone by default**: an owner turns **Let borrowers create their own accounts** off in Settings to keep borrowers invitation-only. Sign-up emails go through the same mail setup as password links, so mail has to work for anyone to finish signing up. It adds a partial unique index on `Lead.photoKeyHash`, which the build's index sync creates; never use `prisma db push`, which builds a plain unique index that fails once two leads have no key. **The letters release** adds the `qrcode` package (run `npm ci`); the verify page a letter's QR code opens is public at `/verify/<code>` and shows LendHous's phone from Settings. **The investor statements release** adds a nightly `statements` job: from the 1st, it makes each partner's and buyer's statement for the month before (it catches up if a night is missed; `npm run statements -- 2026-10` makes a month by hand) and emails their people. Loans whose partner bid was accepted before this release have no partner share recorded, so they don't wait for the partner's money at funding. **The loan team release** adds an `assign_loans` permission (owners and underwriters by default). Loans from before it have no loan officer: assign them from each loan's page, or filter the pipeline to "No loan officer". **The reports release** adds a `view_reports` permission (owners, capital managers and auditors by default) and starts keeping the day each loan enters a stage; loans started before it count in the reports' fundings and term sheets but not as applications or in the timings. **The tax forms release** asks partners, buyers and brokers for a W-9 on their Tax form page; tell them, since anyone without one is listed for 24% backup withholding. **The repeat-borrower release** prices new applications on the borrower's LendHous loans paid as agreed (PLACEHOLDER tiers, editable at `/admin/pricing`); loans already submitted keep their price. **The broker program release** adds a `manage_brokers` permission (owners by default) and stops any brokerage that hasn't signed the broker agreement and been approved on the Brokers page from sending new deals: ask existing brokers to sign it from their portal. Their deals already in are unaffected. **The design pass** needs nothing to deploy. Staff find Members, Settings and the other owners' tools under the Admin heading in the menu, and Security and sign-out in the account menu at its foot. Borrowers can now show a funded loan on the home page's "Recently funded" list; nothing shows until one does. **The instant quote release** adds a `QuoteCount` collection and a `channel` on leads (the build's index sync makes the new unique index; never `prisma db push`). It also stops other sites framing any page but the quote widget at `/embed/quote`: if anything of LendHous's was ever shown inside another site's frame, only the widget can be now. **The work queue release** adds `slaTargets` to the settings (unset uses the PLACEHOLDER targets); an owner sets them under Settings. Documents sent before it have no arrival time, so their review clock starts with the next one sent. **The borrower statements release** adds a `BorrowerStatement` collection and makes the nightly `statements` job email every funded loan's borrower a monthly statement from the next 1st; run `npm run statements` once after deploying to make last month's. Put LendHous's receiving instructions under **How borrowers pay** in Settings first, since the statements and loan pages show them (blank tells borrowers to call). **The maturity desk release** starts asking borrowers on short-term loans for their exit plan from 120 days before maturity, on the next nightly servicing check: loans already inside 120 days get the question that night. **The borrower documents and agents release** needs nothing to deploy. Staff now send a document back with a note saying what's still needed instead of rejecting it bare; documents sent back before it show the borrower a general "a clearer, complete copy" line. Borrowers on loans from the accepted term sheet to closing are asked for their title and insurance agents the next time they sign in. **The insurance and investor screening release** makes every loan keep an insurance file on its Closing tab, and **a loan can't fund until it has the flood zone recorded and a hazard (or builder's risk) policy, windstorm cover and, in a special flood hazard area, flood cover, each naming LendHous as mortgagee**: fill these in for loans now at clear to close or closing. A funded loan's one policy from the lien file moves into its insurance file on the next nightly check, with nothing to do; add the wind and flood policies and tick "names LendHous" for funded loans over the next weeks, and the borrower can send renewals from their loan page. The nightly `sanctions` job now also screens every partner lender, loan buyer and approved brokerage. **A partner's bid can't be accepted, a buyer's offer accepted or a partner's money marked received until the firm is screened**, so after deploying run `npm run jobs` (or press Screen now on Partners & buyers), and add each firm's owners and officers there.

```bash
git pull && LENDHOUS_RELEASE=1 npm run build && pm2 restart lendhous && npm run db:encrypt
```

Check `pm2 ls` shows `lendhous-jobs`. It runs the daily jobs at 06:00 UTC, including the servicing check that marks missed payments late, charges late fees and sends late and maturity notices, the term sheet check that reminds borrowers two days before a term sheet expires and expires it after its last day, the insurance check that warns 30 days before any policy on a funded loan ends (hazard, windstorm, flood or builder's risk) and again when it lapses, and, last, the owners' daily email with yesterday's numbers (sent to every owner-admin and `TEAM_EMAIL`, and linking to `NEXT_PUBLIC_APP_URL/admin/reports`). Without it nothing goes late, and the servicing page warns that the check has stopped. `npm run jobs` runs any job that hasn't run today, straight away.

**After the deploy that adds OFAC screening, run `npm run jobs` once.** The sanctions job downloads Treasury's list from `treasury.gov` (the server needs outbound HTTPS to it) and screens every open application and loan, and every partner lender, loan buyer and brokerage. Until it has run, nothing can be screened, applications can't go to underwriting, and loans can't fund or release draws.

`db:encrypt` encrypts anything saved before encryption was switched on. It has to come after the restart, because the build it replaces can't read encrypted records. It's safe to run on every update, and it changes nothing once everything is encrypted. The daily job does the same as a backstop.

If nginx is in front, it has to let uploads through: its default limit of 1 MB refuses most loan files and many photos, and a contractor sees "This photo is too large". Set this in the site's `server` block, then reload nginx:

```nginx
client_max_body_size 16m;
```

Session cookies are https-only in production. Only on an internal server reached over plain http, set `ALLOW_HTTP_SESSIONS="1"` (release builds refuse it).

## Watching it run

- **Errors.** Every server error is recorded on the owners' **Errors** page (`/admin/errors`), grouped by what failed and where, with how often and when. Emails, long numbers, tokens and quoted values are taken out of the message first, and no request is kept. The morning email says how many happened in the last day. Mark one fixed once it's dealt with; it comes back if it happens again. Set `SENTRY_DSN` to send them to Sentry too.
- **Health check.** `GET /api/health` needs no sign-in and returns modes and times only (step 5 above), with `staleJobs` listing the servicing or sanctions job when it hasn't finished in 48 hours. It's 503 only when the database is down; `GET /api/health?watch=jobs` is also 503 while a job is stale (and before they've ever run). Point an uptime monitor (UptimeRobot, Better Stack or similar) at `https://<your domain>/api/health?watch=jobs` every 5 minutes, alerting GT on anything but 200. Owners also see a red warning across the panel when one of those jobs is over two days old.

## Staging

Run a second copy for trying a release before it goes live: its own Atlas database (`lendhous_staging`, its own user), its own `NEXT_PUBLIC_APP_URL` (for example `https://staging.<domain>`), its own `AUTH_SECRET` and `CRON_SECRET`, and `FIELD_ENCRYPTION_KEYS` of its own (never production's). Leave `RESEND_API_KEY` and `SMTP_HOST` unset so mail goes to the server log instead of real people, and build without `LENDHOUS_RELEASE=1` so the demo seats can be seeded with `npm run db:seed`. Under pm2 that's a second checkout on another port (`pm2 start node_modules/.bin/next --name lendhous-staging -- start -p <port>`), with no jobs process unless you're testing the jobs. Deploy to staging, click through the change, then deploy the same commit to production.

## Backups and the restore test

Atlas takes the backups (turn on continuous backup for the cluster). A backup nobody has restored is only a hope, so once a month, and after changing `FIELD_ENCRYPTION_KEYS`:

1. Restore the latest snapshot into a scratch place: in Atlas, **Restore → to another cluster**, or `mongorestore` a `mongodump` archive into another database.
2. On the server (it has the keys): `RESTORE_DATABASE_URL="<the restored copy>" npm run restore:test`. With a `mongodump` archive and `mongorestore` installed, `npm run restore:test -- --archive lendhous.archive.gz` restores into a scratch database on `DATABASE_URL`'s server, checks it and drops it (`--keep` keeps it).
3. It lists what's in the copy and opens a sample of the loan book, document names, leads and notifications with this server's keys. **PASS** means the backup restores and opens; **FAIL** says what wouldn't open (usually keys that don't match the backup). Delete the scratch cluster or database afterwards.

Uploaded files live in S3, not the database: turn on versioning for the bucket so a deleted file can be brought back.

## Still outside this repo

The Atlas project, user and network rule; the Vercel project and its variables; the domain; Resend or SMTP; and the move to KMS keys, a write-once audit export (S3 Object Lock) and the ledger's insert-only Atlas role, which are pre-launch items.
