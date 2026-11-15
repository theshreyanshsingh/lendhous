# The LendHous loan tape

One row per loan, with these columns in this order every time. Staff download it from **Loan sales** (the loans listed for sale, or every funded loan including paid-off ones); a buyer downloads the blind tape of loans for sale from its market page and the full tape of the loans it owns from **My loans & offers**. Each comes as CSV, for a spreadsheet, or JSON, which repeats this list under `columns`.

- **Blind** leaves out every column marked *full only*: no borrower, guarantor, street, city, full ZIP or exact credit score. It isn't anonymous, though: a price, a closing date and a county can be matched to the deed in the public records, so even the blind tape goes only to buyers who have agreed to keep it confidential.
- **Full** adds them. Send it only to a buyer that has signed the NDA, or that owns the loan.

Money is in dollars, rates and the LTC, LTV and LTARV in percent, and dates as YYYY-MM-DD. Figures are as of the tape's date (`asOf` in the JSON, and in the file name). A blank cell means the figure doesn't apply or isn't on file.

| Column | Name | What it means | Version |
|---|---|---|---|
| `tape_id` | Tape ID | N- and the loan number's last four digits. The same on both versions. | both |
| `loan_number` | Loan number | LendHous's loan number. | full only |
| `borrower_entity` | Borrowing entity | The company that signed the note. | full only |
| `borrower_name` | Borrower | The person who applied for the entity. | full only |
| `guarantors` | Guarantors | Each guarantor and the share of the entity they own. | full only |
| `street_address` | Street address | The property, or the first property on a portfolio loan. | full only |
| `city` | City | — | full only |
| `zip` | ZIP | — | full only |
| `zip3` | ZIP prefix | The ZIP's first three digits. | both |
| `county` | County | — | both |
| `state` | State | — | both |
| `product` | Loan type | fix_flip, bridge, ground_up or dscr (a 30-year rental loan). | both |
| `purpose` | Purpose | purchase, refi_rt (rate and term) or refi_co (cash out). | both |
| `property_type` | Property type | sfr, 2_4 (two to four units), condo or townhome. | both |
| `property_count` | Properties | 1, or the number on a portfolio loan. | both |
| `occupancy` | Occupancy at closing | vacant, tenant or owner_occupied. | both |
| `status` | Status | Where the loan stands as of the tape's date. | both |
| `lien_position` | Lien position | LendHous funds first mortgages only. | both |
| `purchase_price` | Purchase price | On a purchase. On a refinance, what the borrower paid, if known. | both |
| `as_is_value` | As-is value | The appraised value as it stood at closing, if there was one. | both |
| `arv` | After-repair value | The value once the work is done. On a rental loan, the value. | both |
| `rehab_budget` | Rehab or construction budget | Hard and soft costs on new construction. | both |
| `loan_amount` | Loan amount | The note amount at closing, including the holdback and any financed interest reserve. | both |
| `initial_advance` | Advanced at closing | What went out at closing. | both |
| `holdback_total` | Holdback | Held back at closing for the work, paid out in draws. | both |
| `holdback_funded` | Holdback drawn | Draws paid out so far. | both |
| `holdback_left` | Holdback left | Still to fund. Whoever owns the loan funds these draws. | both |
| `current_balance` | Unpaid balance | Principal owed, as of the tape's date. | both |
| `ltc_pct` | LTC % | Loan to cost: the loan over the price and budget. | both |
| `ltv_pct` | LTV % | Loan to value: the loan over the as-is value. | both |
| `ltarv_pct` | LTARV % | Loan to after-repair value. | both |
| `dscr` | DSCR | Rent over the monthly payment with taxes, insurance and dues, on a rental loan. | both |
| `note_rate` | Note rate % | As of the tape's date, after any signed modification. | both |
| `net_rate` | Rate to the owner % | The note rate less LendHous's 1% servicing fee. | both |
| `amortization` | Payments | amortizing (a rental loan's 30-year fixed payment) or interest_only. | both |
| `interest_on` | Interest charged on | full_loan, or drawn (only the money advanced so far). | both |
| `interest_reserve` | Interest reserve | financed (paid from the loan) or none. | both |
| `monthly_payment` | Monthly payment | The next payment due. | both |
| `term_months` | Term (months) | Including extensions and modifications that added months. | both |
| `months_left` | Months left | Payments left to maturity. | both |
| `closing_date` | Closing date | — | both |
| `first_payment_due` | First payment due | — | both |
| `maturity_date` | Maturity | Including extensions. | both |
| `next_payment_due` | Next payment due | Blank once every payment is in. | both |
| `paid_through` | Paid through | The due date of the last payment made. | both |
| `payments_made` | Payments made | — | both |
| `payments_late` | Payments late now | Past their grace days and still unpaid. | both |
| `days_past_due` | Days past due | From the oldest payment still unpaid. | both |
| `pay_string_12m` | 12-month pay history | One letter per month-end, oldest first: C current, 1 30 to 59 days past due, 2 60 to 89, 3 90 or more, F in foreclosure, R bank-owned, P paid off, N nothing due yet. | both |
| `extensions` | Extensions | How many were signed. | both |
| `extension_months` | Months added by extensions | — | both |
| `last_extension_on` | Last extension signed | — | both |
| `modifications` | Modifications | How many were signed. | both |
| `last_modification_on` | Last modification signed | — | both |
| `in_default` | In default | yes when a declared default is still open. | both |
| `credit_band` | Credit score band | The borrower's score in a 20-point band. | both |
| `fico` | Credit score | The score the loan was priced on. | full only |
| `completed_projects` | Completed projects | Deals the credit officer verified, or the borrower's count before that. | both |
| `guarantor_count` | Guarantors (count) | — | both |
| `grade` | Grade | LendHous's A to E risk grade at pricing. | both |
| `tier` | Experience tier | 1 to 3, from the borrower's track record. | both |
| `flood_zone` | FEMA flood zone | From FEMA's map at the property, or as entered. | both |
| `special_flood_hazard_area` | In a special flood hazard area | yes for zones A and V, where flood insurance is required. | both |
| `insurance_expires` | Insurance expires | The first of the property's policies to end. | both |
| `exit_strategy` | Exit | How the borrower plans to pay the loan off. | both |
| `affiliated_contractor` | Affiliated contractor | yes when the contractor is affiliated with LendHous's owner. | both |
| `ask_pct` | Asking price % | On a loan for sale: a percent of the unpaid balance (100 is par). | both |
| `ask_price` | Asking price | — | both |
| `yield_at_ask` | Yield at asking % | If it pays as agreed to maturity, after the servicing fee. | both |

The column list lives in `lib/loan-tape.ts` (`TAPE_COLUMNS`); a test fails if this page and that list disagree.
