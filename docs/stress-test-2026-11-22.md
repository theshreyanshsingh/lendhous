# Stress Test, November 22, 2026

LendHous holds up for a small book and a small team, and breaks in two places as either grows. **Saves collide at every size:** when ten actions are saved at the same moment, four or five of the ten fail with "Someone else was saving at the same moment", even with 250 loans and even on ten different loans. **Signed-in staff pages slow down with the size of the book**, because every staff page reads, decrypts and sends the whole loan book to the browser. At 1,000 loans each staff page is 7.6 MB and takes about 5 seconds for one person, and about 26 seconds when ten people load it at once. At 2,500 loans it takes 6 seconds for one person, and with ten at once a third of pipeline loads and every loan-page load gave up after two minutes. The public site is not the problem. **Fixes 1 and 2 are now in:** ten saves at once no longer fail at any size, and staff pages are about twice as fast. Fix 3, sending staff pages only what they show, is the remaining scale limit.

## How it was run

`npm run stress` (`scripts/stress.ts`) fills the local database with copies of the demo book's loans and messages, all FAKE, at 250, 1,000 and 2,500 loans. At each size it:
- reads the whole book the way every action and signed-in page does;
- measures what a staff and a borrower browser are sent;
- times the work queue, each loan's next step and the yearly report;
- saves notes one at a time, ten at once on different loans, and ten at once on one loan.

It then signs in a throwaway owner account and loads pages over HTTP against the production build (`npm run build && npm start`). It refuses to run against anything but a database and an app on this machine, and removes its records afterwards.

Everything ran on one Mac (10 cores, 16 GB): the app, MongoDB, Chrome and the test itself. The AWS server will give different absolute numbers; how they change with size will be similar. Public-page throughput varied from run to run with what else the machine was doing.

## After fixes 1 and 2

Both are in `lib/book-store.ts`:
- **Saves take turns.** Saves in the app now take turns, and a clash with another process (the nightly jobs) waits a short, random, growing time before trying again.
- **Safer reads.** The version is read before the records, so the overwrite window is closed. A read the database drops is tried again, and if it keeps dropping, the person sees "We couldn't reach the database just now" instead of a server error.
- **The book stays in memory.** The decrypted book is kept between requests. Each read first checks the version, the number of records, the time of the latest change and the encryption keys in use, and reuses the book unless one of them moved; a save hands its own result straight to the kept book.

The same tests, rerun on the same machine:

| Loans | 10 saves at once, before | After | Reading the book, before (full read) | After (kept book) |
|---|---|---|---|---|
| 250 | 1–7 s, 4 of 10 failed | 0.5 s, none failed | 48–114 ms | 5 ms |
| 1,000 | 4–23 s, 4–5 of 10 failed | 0.9–1.7 s, none failed | 114–402 ms | 19–24 ms |
| 2,500 | 30 s, 5–6 of 10 failed, some crashed | 2.4 s, none failed | 232–244 ms | 18 ms |

Pages at 1,000 loans, before and after:

| Page | Before | After |
|---|---|---|
| Pipeline, one at a time | 3.9–4.9 s | 2.8 s |
| Pipeline, 10 at once | 26 s, 2 of 30 timed out | 14 s, none timed out |
| Loan page, 10 at once | 17–30 s, 2 server errors and 3 timeouts in one run | 8 s, all whole |
| Reports, 5 at once | 10–14 s | 4.8 s |
| Servicing, 5 at once | 14–22 s | 10.9 s |

Saves no longer fail, and the dropped reads are gone. Staff pages are about twice as fast, but still several seconds at 1,000 loans, and still 7.6 MB each, because every staff page still sends the whole book (fix 3). The app keeps one decrypted copy of the book in memory, which added about 100 MB at 1,000 loans.

Another project's work on this machine kept the load average between 34 and 41 during every run, before and after. Read the absolute times as high, and the before-and-after comparison as the useful part.

## Results before the fixes

### The book itself

| Loans | Read the whole book | Staff page data (gzipped) | Borrower page data | Work queue | Year's report | Save one | 10 saves at once | Failed |
|---|---|---|---|---|---|---|---|---|
| 250 | 48–114 ms | 1.3 MB (0.1 MB) | 9 KB | 0.1–0.5 s | 0.1–0.3 s | 50–220 ms | 1–7 s | 4 of 10 |
| 1,000 | 114–402 ms | 5.1 MB (0.6 MB) | 16 KB | 0.3–1.4 s | 0.5–1.4 s | 116–627 ms | 4–23 s | 4–5 of 10 |
| 2,500 | 232–244 ms | 12.7 MB (1.4 MB) | 33 KB | 0.8 s | 0.7 s | 334 ms | 30 s | 5–6 of 10, some crashed |

Ranges are across separate runs. At 2,500 loans some saves didn't just clash: the database cut off their full-book read ("early eof"), and the save threw an error instead of retrying. The app's own log showed the same error on page loads.

### Pages under load

| Loans | Pipeline, one at a time | Pipeline, 10 at once | Loan page, 10 at once | Reports, 5 at once | Servicing, 5 at once | Staff page size |
|---|---|---|---|---|---|---|
| 250 | 1.0 s | 6.6 s | 4.0 s | 3.2 s | 5.7 s | 1.9 MB |
| 1,000 | 3.9–4.9 s | 26 s (2 of 30 timed out) | 17–30 s (2 server errors in one run) | 10–14 s | 14–22 s | 7.6 MB |
| 2,500 | 6.0 s (worst 41 s) | 49 s (10 of 30 timed out) | all 30 timed out at 2 minutes | 68 s | 51 s | 18.8 MB |

The home page and the quote page answered every request, 50 at a time, at 13 to 110 requests a second.

## Why

1. **One version number for the whole book.** `lib/book-store.ts` saves only the records an action changed, but checks a single version for the whole book. Nearly every action also rewrites the shared activity feed. So any two saves at the same moment clash, whatever loans they touch, and the loser retries straight away up to six times.
2. **A possible lost update.** The version and the records are read at the same time, not one after the other. A save landing between the two reads could pass the check on stale records and overwrite another person's change. It's rare, but it's the kind of bug that loses a payment.
3. **Every signed-in page reads and decrypts every record.** The book is cached only for one request. Ten people loading pages means ten full reads of every loan at once, which is what made the database cut reads off.
4. **Every staff page sends the whole book to the browser** (`app/admin/layout.tsx` passes it to the store on every page, even Notifications). The browser then works out the pipeline, the queue and every screen from it. That's why page size grows with the book: 7.6 MB of HTML per page at 1,000 loans.

## What to fix, in order

| # | Fix | Effort | What it changes |
|---|-----|--------|-----------------|
| 1 | **Queue saves inside the app, and wait a moment between retries** (done 2026-11-22). Run one save at a time per server process, wait a short random time before retrying a clash with the nightly jobs, read the version before the records, retry a dropped read, and tell the person to try again instead of showing a server error. | S, `lib/book-store.ts` | No failed saves when ten happen together; closes the lost-update window. |
| 2 | **Keep the decrypted book in memory, by version** (done 2026-11-22). A page or save checks one small version row and reuses the book unless it changed; a save hands its own result to the cache. | S–M, `lib/book-store.ts` | Most signed-in pages stop reading and decrypting every record, which also ends the cut-off reads. |
| 3 | **Send staff pages only what they show.** The pipeline gets one summary line per loan; a loan's page gets that loan; reports and the queue are worked out on the server and cached by version. | L, the store and every staff screen | Page size stops growing with the book. Needed before a few hundred loans with several staff at once. |
| 4 | **Work out the queue and reports once per version.** | S, after 2 | Takes a second or more off each pipeline and reports load at 1,000 loans. |

Borrowers, brokers, partners and buyers are sent only their own loans (9 to 33 KB), so their pages are fine at every size; they still wait on the whole-book read that fix 2 removes.

## Found in passing

On two of five full demo runs while the machine was overloaded, the browser reported one stray error: a hydration mismatch on the settings page once, and a missing resource whose address wasn't recorded once. The demo script now records the address. The settings one reproduced once in about sixteen loads and saves, and not at all with the machine idle. A likely cause predates this work: the rules from Settings (the NFIP date, draw fees) are global to the server process, and the page shell sets them as it renders, the demo rules for demo seats and the saved rules for real accounts. Two requests rendering at once can see each other's rules, so the server and the browser can draw slightly different text. Passing the rules down with each request, instead of setting them for the whole process, would end it. Settings are also cached for 20 seconds in each server module, and saving clears only one copy.
