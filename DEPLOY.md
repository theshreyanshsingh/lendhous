# Deploy Lendhous

This follows UPB Capital's DEPLOY.md: Vercel plus MongoDB Atlas, or a plain Node server under pm2. Nothing in this repo deploys itself.

## Before the first production deploy

Lendhous will hold SSNs, credit reports and bank details, so it gets stricter isolation than UPB:

1. **Database.** Use a separate Atlas project or cluster for Lendhous, not SynergyFund's shared cluster. Create a database user whose only role is `readWrite` on the `lendhous` database. Do not reuse SynergyFund's or UPB's user.
2. **Field-encryption keys.** Generate `FIELD_ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"` and keep a copy in the password manager; losing it loses every encrypted field. Before real SSNs arrive, move to AWS KMS envelope keys (pre-launch item, Spec v3 10.2).
3. **Files.** Use Lendhous's own private R2 bucket. Only S3/R2 can issue the five-minute signed links. Malware scanning on upload is still open (Spec v3 10.2).

## Checklist (Vercel + Atlas)

1. In Atlas, create the user above and allow Vercel to connect (`0.0.0.0/0` with a strong password, since Vercel has no fixed IP). Put `/lendhous` after the host in the connection string.
2. In Vercel, import the repo. Framework preset: Next.js. Build command: `npm run build`.
3. Set the required variables below for **Production** and **Preview**. A build without them fails closed.
4. Deploy, then sign in at `https://<domain>/login` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. A six-digit code goes to `ADMIN_EMAIL`, so it must be an inbox you can read.
5. Check `https://<domain>/api/health`: `db` is `ok`, `storage` is `s3` or `blob`, `encryption` is `keys`.

`vercel.json` schedules `GET /api/cron` daily at 06:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`.

## What the build does

`npm run build` runs `scripts/release.ts` when `VERCEL=1` or `LENDHOUS_RELEASE=1`. The script:

- refuses to start unless every required variable is present
- refuses a `DATABASE_URL` that names no database, or names `synergifund`, `upb_capital`, `admin`, `local` or `config`
- refuses the demo auth secret, the development encryption key, `@lendhous.test` addresses, the demo password, a non-https origin, and `ALLOW_HTTP_SESSIONS`
- syncs the MongoDB validators and indexes
- creates one approved owner-admin in the lender-house organization, plus the settings row, and nothing else; it refuses a database that already holds demo seats
- clears any authenticator secrets and recovery codes left from before sign-in codes moved to email

Demo seats can't exist on a release database, so to see another role there, invite a second email address from the Members page with that role, sign in as it, and press **Load sample data**.

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
| Mail | `RESEND_API_KEY` + `EMAIL_FROM`, or `SMTP_HOST` + `EMAIL_FROM`. Staff, partners and brokers sign in with a code sent this way |

Optional: `ADMIN_NAME`, `LENDER_NAME`, `TEAM_EMAIL`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `S3_PREFIX`, `RATE_LIMIT_STORE`.

## If mail stops working

Nobody who needs a code can sign in. To let them in on their password alone until mail is back, set `requireStaffMfa` to `false` on the `PlatformSettings` document in Atlas. It takes effect within twenty seconds. Set it back to `true` afterwards, which also ends every session opened without a code.

## A plain server under pm2

SynergyFund holds port 3007 and UPB holds 3009 on the shared server, so pick another free port.

```bash
npm ci && npm run db:indexes && LENDHOUS_RELEASE=1 npm run build
pm2 start node_modules/.bin/next --name lendhous -- start -p <port> -H 0.0.0.0
pm2 start node_modules/.bin/tsx --name lendhous-jobs --cron-restart "0 6 * * *" --no-autorestart -- --env-file=.env scripts/jobs.ts
pm2 save
```

To update it later. The build regenerates the database client and syncs the indexes, so schema changes need no extra step. Use `npm ci` first if `package.json` changed.

```bash
git pull && LENDHOUS_RELEASE=1 npm run build && pm2 restart lendhous
```

Session cookies are https-only in production. Only on an internal server reached over plain http, set `ALLOW_HTTP_SESSIONS="1"` (release builds refuse it).

## Still outside this repo

The Atlas project, user and network rule; the Vercel project and its variables; the domain; Resend or SMTP; and the move to KMS keys, a write-once audit export (S3 Object Lock) and the ledger's insert-only Atlas role, which are pre-launch items.
