# What competitors have that LendHous doesn't (2026-11-07)

A CEO-style scan of about 60 companies in four groups:

- national investor lenders: Kiavi, Lima One, RCN, CoreVest, LendingOne, Easy Street, New Silver, Dominion, RFG, Builders Capital, SLA Capital and others
- private-lending software: LendingWise, Baseline, Mortgage Automator/Lendr, The Mortgage Office, Liquid Logics, Nortridge, Built, Land Gorilla, Rabbet, Lightning Docs and others
- capital platforms: Groundfloor, EquityMultiple, Juniper Square, Cash Flow Portal, MAXEX and others
- Florida lenders: Ridge Street, Capital Funding, BridgeWell, Alta and others

Four researchers read the competitors' own pages. Each item below says what we have today, checked against this repo's code. **C** means confirmed on the company's own page or app listing. **R** means it came from trade press, a third party or a search snippet. A few sites refused to load (see the end). Items already on `docs/next-features-prompt.md` (K to T, the vendor list, "As volume grows") are listed only where the research changes their priority.

## The short version

LendHous is ahead where the law and money controls are:

- wire call-backs
- Florida payoff letters and lien-law holds
- Reg B decline notices
- usury checks
- nightly OFAC screening on borrowers

The market is ahead on four things:

1. **Products we advertise or get asked for but can't originate.** Portfolio and blanket rental loans, short-term rental DSCR and lines of credit for repeat flippers.
2. **Growth loops.** A cash referral program, published loyalty perks and broker comp options (YSP, white label).
3. **Insurance and construction-budget controls**, which matter more in Florida than anywhere.
4. **The capital side.** Screening investors, rollovers, swapping a partner mid-loan.

## 1. Build now: no vendor and no outside decision needed

Ranked by money and risk to LendHous, against the effort.

### 1.1 Insurance on every loan, not just rehab loans

**Built 2026-11-07** (`lib/insurance.ts`): every loan's flood zone and policies, a funding gate, nightly warnings on every funded loan, borrower renewals checked by the team, and lapses in the work queue. Force-placed insurance is still to come.

- **Today:** the policy, its expiry warning and the lapse hold live in the lien file. That file only exists for fix and flip and ground-up loans (`lib/lien-law.ts`; the Closing tab only shows it for those, `app/admin/(staff)/deals/[id]/page.tsx:280`). A funded DSCR rental or bridge loan in Miami can let its windstorm cover lapse with nobody told.
- **Competitors:**
  - Kiavi gives borrowers an insurance portal (VerifyMyIns) to upload renewals. C, kiavi.com/servicing.
  - Nortridge tracks collateral insurance and taxes. C, nortridge.com.
- **Build:**
  - a policy record on every funded loan: hazard, windstorm and flood; carrier, dates and coverage; LendHous named as mortgagee
  - the same 30-day and lapse notices
  - a renewal upload on the borrower's loan page
  - a "lapsed" item in the work queue
  - force-placed insurance can follow later

### 1.2 Sanctions screening for the money we take in

**Built 2026-11-07** (`lib/firm-screening.ts`): partners and buyers are screened with their owners, the people who sign in for them and their tax-form names, when saved and nightly; brokerages are screened again nightly; a possible match holds teasers, bids, offers, sales and money until it's reviewed. The bank-change call-back waits for investor payouts to move onto the platform: LendHous holds no investor bank details today.

- **Today:**
  - OFAC covers the borrowing company, the borrower and the guarantors (`screeningSubjects` in `lib/ofac.ts`).
  - Brokers are screened too (`lib/brokers.ts`).
  - Partner lenders and loan buyers, and their owners, are never screened, though their wires fund our loans.
- **Competitors:**
  - InvestNext checks ID with liveness and screens investors against 10,000+ databases. C-ex (site 403).
  - Juniper Square collects AML/KYC inside the subscription and lets investors change their bank details with fraud screening. C, junipersquare.com/platform/investor-portal.
- **Build:**
  - screen partner and buyer firms and their owners, on onboarding and nightly, using the borrowers' list and matching
  - a possible match holds bids and funding until `clear_ofac` reviews it
  - changing where we pay an investor needs a call-back by a second person, like the closing wire

### 1.3 A borrower referral program, and loyalty perks people can see

**Built 2026-11-07** (`lib/referrals.ts`): a borrower with a funded loan gets a link once an owner sets the bonus in Settings (off until then); a new borrower's first loan through it is credited when the team or the friend starts it, the bonus goes from expected to earned to paid with emails to the referrer, and the Tax page flags $600+ a year. `/rewards` shows the tiers from the live pricing, the bonus and the perks; repeat borrowers' items rank first in the queue. Still to come: a credit for the friend at closing, an appraisal credit, and paying the bonus through a payments vendor.

- **Today:**
  - Repeat-borrower tiers exist: placeholders of 0.25% to 1.00% off the rate, editable at `/admin/pricing`.
  - A borrower sees their own tier on a funded loan (`components/loan/NextLoan.tsx`).
  - The tiers aren't on the public site, and nothing pays a borrower for a referral (only brokers have referral links).
- **Competitors, referral bonuses:**
  - Kiavi pays the referrer $500 and the friend $350, through PartnerStack and Stripe within 10 business days. C, kiavi.com/refer-a-friend.
  - Easy Street pays $1,000 per closed loan, with no cap. C, easystreetcap.com/refer.
  - New Silver pays $750 on the first loan, $250 on each later one, and gives the client $500 off. C, newsilver.com/referral-program-ns.
  - OfferMarket pays $250 to each side, within 2 business days. C.
- **Competitors, loyalty:**
  - New Silver "Advantage": at 3, 6 and 10 loans in 24 months, 50, 75 and 100 bps off the rate and 25, 50 and 75 bps off origination. Also a free appraisal, priority underwriting and a **guaranteed extension**. C (indexed copy; the page now redirects).
  - Backflip gives up to 0.50% off origination, paused by a 30-day delinquency. C, backflip.com/rewards.
  - Kiavi gives BiggerPockets Pro members $1,250 off each of their first three loans. C.
- **Build:**
  - every borrower gets a personal referral link (the broker referral code and lead tracking already exist)
  - a referral that funds earns the bonus Settings names, tracked from earned to paid
  - a "Rewards" page on the site, drawn from the published tiers so it can't drift (like `/programs`)
  - perks beyond pricing (priority queue, appraisal credit), as flags in the work queue and the term sheet
- **Ask the CPA:** referral payments of $600+ likely need a 1099-MISC.

### 1.4 Several properties on one loan (portfolio and blanket rental loans)

- **Today:**
  - `/programs/portfolio` advertises "Rental portfolio" (`lib/site-content.ts:62`), but every loan holds one property.
  - The quote sends 5+ unit multifamily, second-position and transactional requests to the team unpriced (`PRICED` in `lib/quote.ts`).
  - Partial releases are under "As volume grows".
- **Competitors:**
  - CoreVest: 5+ properties, $500K to $50M+, cross-collateral, 75% LTV
  - LendingOne: 3 to 20 properties, up to $3M
  - Lima One: 2+ properties
  - Express and SLA: 2 to 10 properties
  - RCN: $2M to $75M+

  All C.
- **Build:**
  - a property schedule on a loan: each address, value, rent, taxes and insurance
  - DSCR and LTV for the whole portfolio, with each property's share
  - a release price per property
  - partial releases that re-test leverage (Spec 8.9)
  - photos, flood and insurance per property

  This is the largest item on this list. GT sets the program's pricing at `/admin/pricing`.

### 1.5 Short-term rental (Airbnb) DSCR

**Built 2026-11-07** (`qualifyingRent` in `lib/engine.ts`): a DSCR rental let by the night is sized on 80% of 12 months of payouts or 75% of a projection (less on a cash-out), with 5% less leverage and 0.25% more (PLACEHOLDER, on the pricing page); every form asks how it's rented, the documents ask for the payouts or projection, and four Florida short-term rental conditions are added. AirDNA projections still wait for a vendor.

- **Today:** DSCR loans size on a lease or market rent only.
- **Competitors:**
  - Easy Street counts 75% of AirDNA's projection. C, easystreetcap.com/dscr-loans-florida.
  - Lima One: 75% on a purchase, 70% on a cash-out. C.
  - CoreVest puts 5+ short-term rentals on one loan. C.
  - Ridge Street advertises Airbnb/VRBO DSCR at 6.0% to 7.99%. C.
  - LendingOne allows short-term rentals "commonly". C.

  Florida is the biggest short-term rental market these lenders name.
- **Build:**
  - a "short-term rental" income method that uses the last 12 months from the Airbnb or VRBO payout statements at a haircut
  - a pricing adjuster
  - standard conditions: the local short-term rental registration and HOA rules
  - AirDNA projections can come later, as a vendor

### 1.6 Construction budget controls

- **Today:**
  - Draws have retainage and lien-law holds.
  - There's no contingency line, no reallocation, and no change-of-scope request.
  - The contractor never signs a draw.
  - The borrower can't see how much interest reserve is left.
  - N already covers phone photos and the inspector link.
- **Competitors:**
  - Borrower change-of-scope requests with the effect on ARV and on remaining funds explained: RFG and Kiavi. C, rehabfinancial.com/how-it-works/changing-scope-of-work-mid-project.
  - Mortgage Automator: C, mortgageautomator.com/construction-draw-management.
    - an automatic contingency bucket
    - reallocation from it, with surplus routed back
    - variance flags
    - a "project health" score of work done against money paid
  - Rabbet checks the budget stays in balance (cost to complete) and alerts when the interest reserve won't last. C, rabbet.com.
  - CoreVest's draw form is signed by the borrower and the contractor, with waivers, permits and the W-9 attached. C.
  - The Mortgage Office shows the borrower their remaining prepaid interest reserve. C.
  - RFG publishes its draw clock: inspector calls in 1–2 days, report in 2–4, funds within a day. C.
- **Build:**
  - a contingency line in the scope of work
  - reallocation and change-order requests that need the team's approval and re-check the budget against the ARV
  - an in-balance test before each draw
  - the interest reserve's balance on the loan page
  - the contractor signs the draw through the photo link they already use

  Do it together with N.

### 1.7 Buying the rate down, and a public rate grid

**Built 2026-11-07** (`lib/buy-down.ts`, `lib/rate-grid.ts`): quarter-point steps of points for rate (PLACEHOLDER 0.5% a point on short loans, 0.25% on rentals), inside the matrix and Florida's usury cap, on the quote and fixed on each term sheet for the borrower to choose when accepting; `/rates` publishes leverage and starting rates by experience and credit from the live pricing. Today's placeholder points ranges are narrow (half a point on flips), so GT widening them gives borrowers more room.

- **Today:**
  - The quote shows a rate and its range.
  - `/programs` compares programs from the live pricing.
  - Points are chosen only by staff in the term sheet builder.
- **Competitors:**
  - Kiavi's DSCR "Compare Mode" shows how buying the rate down or up changes the payment and cash to close. C, kiavi.com/loans/rental.
  - SLA publishes a live rate sheet with each adjustment as a line item. C, slacapital.ai/rates.
  - RCN publishes a grid of maximum LTV, ARV and starting rate by experience and FICO. C, rcncapital.com/loan-programs.
- **Build:**
  - a points-for-rate slider on the quote and on the borrower's term sheet, kept inside the matrix's range and the usury checks
  - a public grid of leverage and starting rate by experience and credit band, from the current pricing version

### 1.8 What brokers get elsewhere

- **Today:**
  - The broker's fee is in points, tracked to paid.
  - Referral protection lasts 12 months.
  - The quote PDF names LendHous as the lender.
  - Only staff issue pre-approval letters.
- **Competitors, compensation:**
  - Yield spread premium (YSP; the rate goes up to pay the broker): Kiavi up to 2.50%, set by the broker in the portal. C, kiavi.com/broker-guide/ysp-for-brokers.
  - Visio pays up to 5% in all, a 4:1 YSP ratio. R.
  - LendingOne: 3 points plus 1 point of YSP. C.
- **Competitors, tiers:**
  - Kiavi Platinum: $6M of bridge loans in 6 months, delinquencies of 2% or less. C.
  - RCN has five tiers with quarterly bonuses. R.
- **Competitors, letters and white label:**
  - Kiavi brokers issue pre-qualification letters themselves, at any hour. C.
  - Lima One offers white-label term sheets. C.
  - Easy Street's "Signature" tier closes in the broker's name through table funding. C.
  - New Silver Partner+ gives a white-label portal on the broker's own domain to brokers with 10+ deals a year. C.
- **Competitors, protection and reconciliation:**
  - RCN reassigns a tagged borrower who comes in directly back to the broker. C.
  - Easy Street gives lifetime exclusivity and tells the broker when their client calls direct. C.
  - RCN reconciles expected against actual commission. C.
- **Build now:**
  - white-label term sheets and quote PDFs (the broker's brand on top, LendHous still named as lender)
  - broker tiers from the volume we already count in reports
  - broker-issued pre-qualification letters within limits an owner sets
  - telling the broker when their client contacts us directly
- **Attorney first:** YSP (it counts toward Florida's usury cap, and must be disclosed) and table funding in the broker's name (licensing).

### 1.9 The capital side

- **Today:**
  - Partners bid loan by loan and wire their share at closing.
  - Statements are monthly.
  - Late fees stay with LendHous as a placeholder.
  - R (the buy-box and the money forecast) is already planned.
- **Competitors:**
  - At payoff, offer to roll the money into the next loan:
    - Groundfloor auto-rolls, with an email 7 days before. C.
    - EquityMultiple lets the investor roll over everything, principal only, or nothing. C.
  - Mortgage Automator: C, mortgageautomator.com/all-features.
    - swaps a partner in or out mid-loan, with interest adjusted to the day
    - assigns investors to individual draws
  - Groundfloor reports defaults in plain statuses (Default, Default Late, Workout) and posts monthly asset-management updates. C.
  - Sharestates publishes its fee policy: default interest to investors, late and extension fees kept, recoveries net of legal costs. C.
- **Build:**
  - rollover choices at payoff
  - partner substitution with a per-diem split
  - pro-rata funding of draws by the loan's partners
  - workout statuses on the partner's portfolio
  - the fee pass-through written into Settings, so statements follow it

### 1.10 Booking a call, and Florida pages that rank

- **Today:**
  - No way to book a call.
  - No city or county pages.
  - "Recently funded" shows city, program and a rounded amount.
  - No reviews on the site, and no survey after closing.
- **Competitors:**
  - Ridge Street and New Silver let a visitor book a call. C.
  - Ridge Street has Miami and Florida pages with local market notes, and recently funded deals with rate and loan-to-cost. C, ridgestreetcap.com/hard-money-lenders-miami.
  - Easy Street lists "Recent Florida fundings" with city, rate and LTV. C.
  - Ridge Street shows Trustpilot 4.6 and Google 4.3 on the page. C.
  - No lender publishes an NPS, so a survey would be a first.
- **Build:**
  - each loan officer's booking hours in Settings, and a "Book a call" on the site and the quote's reply
  - county pages (Miami-Dade, Broward, Palm Beach, Hillsborough, Orange, Duval, Pinellas, Lee) with LendHous's own funded figures by county
  - rate and LTC on "Recently funded" for borrowers who opt in
  - a review request after funding and after payoff
  - a one-question survey on the loan page at closing and at payoff, counted in Reports

### 1.11 Smaller items

- **Accounting export:** a monthly journal of the servicing ledger for QuickBooks. The Mortgage Office, LendingWise and Ursara have it, Ursara with account mapping (C). No vendor is needed for a file export.
- **Webhooks and an API key** for Zapier and the like (Mortgage Automator, LendingWise, C).
- **A per-loan email address** that files replies and attachments to the loan (LendingWise, C).
- **Custom fields** on loans (LendingWise, C).
- **Loan modification documents** that change the rate, principal or maturity (Lightning Docs, C). We only do extensions.
- **A second look for declines:** offer declined borrowers to partner lenders for a referral fee (Lendflow, C). Reg B still applies to our own decline.

## 2. Needs a vendor (choose one, then build the adapter)

These extend the vendor list in `docs/next-features-prompt.md`.

- **Insurance quotes in the portal:**
  - Steadily (Temple View, Mortgage Automator; C)
  - Obie (Kiavi, which is paid for referrals; Visio, Trato; R)
  - OfferMarket (40+ carriers; C)

  In Florida, insurance is the hardest part of closing, and it's a referral income line. **New; high value.**
- **Bank linking and card payments:**
  - Kiavi verifies bank accounts through Plaid (C).
  - Builders Capital takes card payments online (C).
  - These sit alongside the ACH item already listed.
- **Photo authenticity:** Truepic (Lima One, CoreVest; R) stamps time and place and checks for tampering. It is stronger than N's browser location check.
- **Inspector network:**
  - Built: 300+ inspectors, about 2.5-day turnaround (C).
  - Trinity inside LendingWise (C).
- **Title ordering and lien monitoring:**
  - Built and Land Gorilla watch for new liens daily (C).
  - Land Gorilla updates title before each draw (C).
  - AFX inside Mortgage Automator (C).
- **Investor payouts by ACH:**
  - batch payout files (Mortgage Automator, Nortridge, Lend Engine; C)
  - a NACHA file for the bank's upload portal needs only the bank's specs
- **Accreditation checks**, only if LendHous raises under Rule 506(c):
  - Parallel Markets (~$59 a letter, 90-day expiry)
  - VerifyInvestor (EquityMultiple)
- **Remote online closing for foreign nationals:** Alta Loans in Miami (R). None of the software vendors offer it.
- **Already listed, now with more evidence:**
  - AVM and comps: Kiavi's estimator pulls comps from the address and rejects ineligible properties (C); Angel Oak's rental AVM holds the rent through closing (C)
  - credit (Xactus in LendingWise, Mortgage Automator and The Mortgage Office)
  - e-signature
  - ACH autopay

## 3. Needs GT or the attorney first (products and capital)

- **A line of credit or "borrowing capacity" for repeat flippers.** This is the strongest lock-in in the market.
  - CoreVest: a revolving line of $1M to $50M+, 90% of cost, 7–10 business days per new property. C.
  - RFG: a $2M line after 3 RFG projects in 18 months (9.99%, 1.5 points, no re-underwriting per deal). C.
  - Lima One shows each borrower a "borrowing capacity" (up to 10× liquid assets), and deals inside it skip the repeat paperwork. C.

  The platform part is a standing approval with a limit, where each property draws on it. Pre-approval letters and repeat-borrower history are a start.
- **Fix-to-rent incentives.**
  - LendingOne: up to 0.5% off the rate, 50% off origination, and the appraisal refunded on the refinance. C.
  - Lima One and Kiavi waive seasoning on refinancing their own bridge loan. C.

  P built the refinance; this is a pricing decision.
- **Product decisions:**
  - Programs we don't price today:
    - 5+ unit multifamily and mixed-use (Lima One, CoreVest, RCN, Express)
    - DSCR below 1.0. Ours is `minDscr: 1.0`. Kiavi goes to 0.8, LendingOne and New Silver to 0.75, and Easy Street has no minimum.
    - a no-appraisal bridge loan (Kiavi, Easy Street EasyFix in 24 hours)
  - Florida-specific ideas:
    - more leverage for local experience (Ridge Street gives about 5% more in Miami-Dade)
    - **non-warrantable condo DSCR.** Florida's SB 4-D inspections are making many condos ineligible elsewhere, and no private lender was confirmed doing it. This is open ground.
- **A pooled note fund**, with net asset value (NAV), reinvested distributions, redemptions and lockups. The Mortgage Office, Mortgage Automator, LendingWise and Groundfloor have one (C). Only if GT raises a fund, and only with securities counsel.

  The research also found IRA accounts (Baseline, Groundfloor) and an NDA-gated data room with watermarks and engagement tracking (Juniper Square). These would be a second tier after our blind teasers.
- **Loan assumption** by a buyer of the property: CoreVest allows it once, on loans over $5M (C).

## 4. Not worth chasing now

- **A native phone app.** None of the direct lenders checked has its own borrower app. Draw apps are white-labelled vendor apps (Sitewire, OneSite, Truepic), and Kiavi's claimed app has no store listing. Our installable portal is at parity.
- **Credit bureau reporting (Metro 2).** It matters mainly for consumer loans.
- **K-1s and capital calls.** Only relevant with a fund.
- **A voice AI for loan status** (Dominion "Greenlight"). Do T first.
- **Webinars, a podcast and investor surveys** (Kiavi weekly, Dominion, RCN). These are marketing, not code.

## Where LendHous is ahead

- **Wire instructions verified by a second person's call-back** before funding. Almost no private-lending software has it; LendingWise integrates FundingShield for it.
- **Florida's statutes:**
  - payoff letters under 701.04
  - Chapter 713 waivers and Notice of Commencement checks that hold draws
  - Reg B decline notices
  - usury checks on every term sheet

  Lightning Docs' licensing and usury engine is the closest (C).
- **Spanish.** No Florida lender page in Spanish was found. In Miami that's a differentiator, not catch-up, so it should move up the list.
- **Partner money goes straight to the verified title escrow.** No wallet holds investor cash; investor wallets froze at Upright (Synapse) and at PeerStreet ("Pocket") (R).
- **Terms before contact details, plus an embeddable widget.** Kiavi's embeddable estimator is the only match.

## The numbers to beat

| | The market | LendHous target |
|---|---|---|
| Terms | "seconds" (New Silver); term sheet in about 2 hours (Ridge Street) | 60 seconds; term sheet the same day |
| Fix and flip closing | 24h without an appraisal (Easy Street); 48h after approval (Dominion); 5–7 business days (Kiavi, Express) | 5 business days |
| DSCR closing | 10 days (Dominion); 15 (CoreVest); 25–35 (Kiavi) | none set |
| Draws | same day when complete (SLA); "as little as 1 day" (Lima One) | 24 hours |
| Referral bonus | $350 to $1,000 per funded loan | set in Settings (off until GT sets it) |
| Loyalty | 50–100 bps off the rate and 25–75 bps off origination | 25–100 bps off the rate (placeholder) |
| Broker pay | YSP up to 2.5% (Kiavi); up to 5% in all (Visio) | points only |

## Couldn't load or check

- **Blocked or failing sites:**
  - visiolending.com (403)
  - civicfs.com (500)
  - templeviewcapital.com (TLS failure; templeviewcap.com was used instead)
  - liquidlogics.com (refused)
  - investnext.com (403)
  - landgorilla.com (403)
  - myfci.com (403)
- **Facts from search snippets only:** for the blocked sites above, facts came from snippets and are marked R.
- **Live chat:** widgets load by script, so a missing widget means "not detected", not "not there".
- **Sources that disagree:**
  - Kiavi's referral amounts (a flat $500, or tiers up to $1,000)
  - New Silver's Advantage tiers (the page now redirects)
