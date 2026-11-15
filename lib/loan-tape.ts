// The downloadable loan tape (docs/competitor-gaps-2026-11-09.md, rank 6): one row per loan with a fixed, documented set
// of columns (docs/loan-tape.md), as CSV for a spreadsheet or JSON for a buyer's system. Two of the largest buyers of
// these loans changed or are changing owners in 2026, so a lender that sells loans needs a tape any buyer can read.
// The blind version names no borrower, guarantor, street or city, like the on-screen sale tape; the full version adds
// them and goes only to someone under the NDA, or to the buyer who owns the loan. Pure, so the server and a demo
// browser build the same file.
import { evaluate, fundedBalances } from "./engine";
import { policiesOf } from "./insurance";
import { pricePaid, SERVICING_STRIP_PCT, yieldAtPrice } from "./loan-sale";
import type { Deal, LoanSale } from "./mockData";
import { addMonths, balanceOf, extendedMonths, firstDueDate, ledgerOf, maturityOf, noteRateOn, openDefault, signedModifications } from "./servicing";
import { statusWords } from "./status-words";

export type TapeVersion = "blind" | "full";
export type TapeRow = Record<string, string | number>;
type Column = { key: string; label: string; about: string; full?: true };

/** Every column, in order. full marks those only the full tape has: they name the people or the place. */
export const TAPE_COLUMNS: Column[] = [
  { key: "tape_id", label: "Tape ID", about: "N- and the loan number's last four digits. The same on both versions." },
  { key: "loan_number", label: "Loan number", about: "LendHous's loan number.", full: true },
  { key: "borrower_entity", label: "Borrowing entity", about: "The company that signed the note.", full: true },
  { key: "borrower_name", label: "Borrower", about: "The person who applied for the entity.", full: true },
  { key: "guarantors", label: "Guarantors", about: "Each guarantor and the share of the entity they own.", full: true },
  { key: "street_address", label: "Street address", about: "The property, or the first property on a portfolio loan.", full: true },
  { key: "city", label: "City", about: "", full: true },
  { key: "zip", label: "ZIP", about: "", full: true },
  { key: "zip3", label: "ZIP prefix", about: "The ZIP's first three digits." },
  { key: "county", label: "County", about: "" },
  { key: "state", label: "State", about: "" },
  { key: "product", label: "Loan type", about: "fix_flip, bridge, ground_up or dscr (a 30-year rental loan)." },
  { key: "purpose", label: "Purpose", about: "purchase, refi_rt (rate and term) or refi_co (cash out)." },
  { key: "property_type", label: "Property type", about: "sfr, 2_4 (two to four units), condo or townhome." },
  { key: "property_count", label: "Properties", about: "1, or the number on a portfolio loan." },
  { key: "occupancy", label: "Occupancy at closing", about: "vacant, tenant or owner_occupied." },
  { key: "status", label: "Status", about: "Where the loan stands as of the tape's date." },
  { key: "lien_position", label: "Lien position", about: "LendHous funds first mortgages only." },
  { key: "purchase_price", label: "Purchase price", about: "On a purchase. On a refinance, what the borrower paid, if known." },
  { key: "as_is_value", label: "As-is value", about: "The appraised value as it stood at closing, if there was one." },
  { key: "arv", label: "After-repair value", about: "The value once the work is done. On a rental loan, the value." },
  { key: "rehab_budget", label: "Rehab or construction budget", about: "Hard and soft costs on new construction." },
  { key: "loan_amount", label: "Loan amount", about: "The note amount at closing, including the holdback and any financed interest reserve." },
  { key: "initial_advance", label: "Advanced at closing", about: "What went out at closing." },
  { key: "holdback_total", label: "Holdback", about: "Held back at closing for the work, paid out in draws." },
  { key: "holdback_funded", label: "Holdback drawn", about: "Draws paid out so far." },
  { key: "holdback_left", label: "Holdback left", about: "Still to fund. Whoever owns the loan funds these draws." },
  { key: "current_balance", label: "Unpaid balance", about: "Principal owed, as of the tape's date." },
  { key: "ltc_pct", label: "LTC %", about: "Loan to cost: the loan over the price and budget." },
  { key: "ltv_pct", label: "LTV %", about: "Loan to value: the loan over the as-is value." },
  { key: "ltarv_pct", label: "LTARV %", about: "Loan to after-repair value." },
  { key: "dscr", label: "DSCR", about: "Rent over the monthly payment with taxes, insurance and dues, on a rental loan." },
  { key: "note_rate", label: "Note rate %", about: "As of the tape's date, after any signed modification." },
  { key: "net_rate", label: "Rate to the owner %", about: `The note rate less LendHous's ${SERVICING_STRIP_PCT}% servicing fee.` },
  { key: "amortization", label: "Payments", about: "amortizing (a rental loan's 30-year fixed payment) or interest_only." },
  { key: "interest_on", label: "Interest charged on", about: "full_loan, or drawn (only the money advanced so far)." },
  { key: "interest_reserve", label: "Interest reserve", about: "financed (paid from the loan) or none." },
  { key: "monthly_payment", label: "Monthly payment", about: "The next payment due." },
  { key: "term_months", label: "Term (months)", about: "Including extensions and modifications that added months." },
  { key: "months_left", label: "Months left", about: "Payments left to maturity." },
  { key: "closing_date", label: "Closing date", about: "" },
  { key: "first_payment_due", label: "First payment due", about: "" },
  { key: "maturity_date", label: "Maturity", about: "Including extensions." },
  { key: "next_payment_due", label: "Next payment due", about: "Blank once every payment is in." },
  { key: "paid_through", label: "Paid through", about: "The due date of the last payment made." },
  { key: "payments_made", label: "Payments made", about: "" },
  { key: "payments_late", label: "Payments late now", about: "Past their grace days and still unpaid." },
  { key: "days_past_due", label: "Days past due", about: "From the oldest payment still unpaid." },
  { key: "pay_string_12m", label: "12-month pay history", about: "One letter per month-end, oldest first: C current, 1 30 to 59 days past due, 2 60 to 89, 3 90 or more, F in foreclosure, R bank-owned, P paid off, N nothing due yet." },
  { key: "extensions", label: "Extensions", about: "How many were signed." },
  { key: "extension_months", label: "Months added by extensions", about: "" },
  { key: "last_extension_on", label: "Last extension signed", about: "" },
  { key: "modifications", label: "Modifications", about: "How many were signed." },
  { key: "last_modification_on", label: "Last modification signed", about: "" },
  { key: "in_default", label: "In default", about: "yes when a declared default is still open." },
  { key: "credit_band", label: "Credit score band", about: "The borrower's score in a 20-point band." },
  { key: "fico", label: "Credit score", about: "The score the loan was priced on.", full: true },
  { key: "completed_projects", label: "Completed projects", about: "Deals the credit officer verified, or the borrower's count before that." },
  { key: "guarantor_count", label: "Guarantors (count)", about: "" },
  { key: "grade", label: "Grade", about: "LendHous's A to E risk grade at pricing." },
  { key: "tier", label: "Experience tier", about: "1 to 3, from the borrower's track record." },
  { key: "flood_zone", label: "FEMA flood zone", about: "From FEMA's map at the property, or as entered." },
  { key: "special_flood_hazard_area", label: "In a special flood hazard area", about: "yes for zones A and V, where flood insurance is required." },
  { key: "insurance_expires", label: "Insurance expires", about: "The first of the property's policies to end." },
  { key: "exit_strategy", label: "Exit", about: "How the borrower plans to pay the loan off." },
  { key: "affiliated_contractor", label: "Affiliated contractor", about: "yes when the contractor is affiliated with LendHous's owner." },
  { key: "ask_pct", label: "Asking price %", about: "On a loan for sale: a percent of the unpaid balance (100 is par)." },
  { key: "ask_price", label: "Asking price", about: "" },
  { key: "yield_at_ask", label: "Yield at asking %", about: "If it pays as agreed to maturity, after the servicing fee." },
];

export const columnsFor = (version: TapeVersion) => TAPE_COLUMNS.filter((column) => version === "full" || !column.full);

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (fraction: number | undefined) => (fraction === undefined || !Number.isFinite(fraction) ? "" : round2(fraction * 100));
const yes = (value: boolean) => (value ? "yes" : "no");
const monthEnd = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/**
 * One letter per month-end for the last months, oldest first, ending with the tape's own day: how far past due the loan
 * was then. Each month is worked out from the ledger as it stood that day, so a payment that came in late shows late.
 * Letters only: a cell starting with "-" would be read as a formula, and the CSV would have to escape it.
 */
export function payString(deal: Deal, asOf: string, months = 12) {
  const firstDue = firstDueDate(deal.closingDate);
  let out = "";
  for (let back = months - 1; back >= 0; back--) {
    const end = back === 0 ? asOf : monthEnd(addMonths(`${asOf.slice(0, 7)}-01`, -back));
    if (end < deal.closingDate) out += "N";
    else if (deal.paidOff && deal.paidOff.receivedOn <= end) out += "P";
    else if (deal.reo && deal.reo.since <= end) out += "R";
    else if (deal.foreclosure && deal.foreclosure.referredOn <= end) out += "F";
    else if (firstDue > end) out += "N";
    else {
      const days = ledgerOf(deal, end).daysPastDue;
      out += days < 30 ? "C" : days < 60 ? "1" : days < 90 ? "2" : "3";
    }
  }
  return out;
}

const ratio = (e: ReturnType<typeof evaluate>, key: string) => e.ratios.find((item) => item.key === key)?.actual;

/** The loan's row on the tape as of a day. A sale adds its asking price and yield. */
export function tapeRow(deal: Deal, version: TapeVersion, asOf: string, sale?: LoanSale): TapeRow {
  const e = evaluate(deal.app);
  const funded = fundedBalances(e, deal.app, deal.disbursedDraws);
  const ledger = ledgerOf(deal, asOf);
  const balance = balanceOf(deal);
  const rate = noteRateOn(deal, asOf);
  const extensions = (deal.extensions ?? []).filter((item) => item.status === "executed" && item.executed);
  const modifications = signedModifications(deal);
  const guarantors = deal.sponsor?.guarantors ?? [];
  const band = Math.floor(deal.app.fico / 20) * 20;
  const expiries = policiesOf(deal).map((policy) => policy.expiresOn).filter(Boolean).sort();
  const flood = deal.floodMap?.mapped ? deal.floodMap : deal.insurance?.flood;
  const rentalOnly = deal.app.product === "dscr";
  const months = e.termMonths + extendedMonths(deal);
  const row: TapeRow = {
    tape_id: "N-" + deal.loanNumber.slice(-4),
    loan_number: deal.loanNumber,
    borrower_entity: deal.entityName,
    borrower_name: deal.borrowerName,
    guarantors: guarantors.map((item) => `${item.name} (${item.ownershipPct}%)`).join("; "),
    street_address: deal.address,
    city: deal.city,
    zip: deal.zip,
    zip3: deal.zip.slice(0, 3),
    county: deal.app.county,
    state: deal.app.state,
    product: deal.app.product,
    purpose: deal.app.purpose,
    property_type: deal.app.propertyType,
    property_count: deal.properties?.length || 1,
    occupancy: deal.app.occupancy,
    status: statusWords(deal.status),
    lien_position: "1st",
    purchase_price: deal.app.purpose === "purchase" ? deal.app.purchasePrice : deal.app.originalPurchasePrice ?? "",
    as_is_value: deal.app.appraisedAsIs ?? "",
    arv: deal.app.arv,
    rehab_budget: deal.app.product === "ground_up" ? (deal.app.hardCosts ?? 0) + (deal.app.softCosts ?? 0) : deal.app.rehab,
    loan_amount: e.noteAmount,
    initial_advance: e.initialAdvance,
    holdback_total: e.holdback,
    holdback_funded: deal.disbursedDraws ?? 0,
    holdback_left: funded.holdbackRemaining,
    current_balance: balance,
    ltc_pct: pct(ratio(e, "ltc")),
    ltv_pct: pct(ratio(e, "ltv")),
    ltarv_pct: pct(ratio(e, "ltarv")),
    dscr: ratio(e, "dscr") === undefined ? "" : round2(ratio(e, "dscr")!),
    note_rate: rate,
    net_rate: round2(rate - SERVICING_STRIP_PCT),
    amortization: rentalOnly ? "amortizing" : "interest_only",
    interest_on: rentalOnly ? "full_loan" : deal.app.accrual === "dutch" ? "drawn" : "full_loan",
    interest_reserve: deal.app.interestReserve,
    monthly_payment: ledger.rows.find((item) => item.due > asOf)?.amount ?? funded.nextPayment,
    term_months: months,
    months_left: ledger.rows.filter((item) => item.due > asOf).length,
    closing_date: deal.closingDate,
    first_payment_due: firstDueDate(deal.closingDate),
    maturity_date: maturityOf(deal),
    next_payment_due: ledger.nextDue ?? "",
    paid_through: ledger.paymentsMade ? ledger.paidThrough : "",
    payments_made: ledger.paymentsMade,
    payments_late: ledger.paymentsLate,
    days_past_due: ledger.daysPastDue,
    pay_string_12m: payString(deal, asOf),
    extensions: extensions.length,
    extension_months: extensions.reduce((sum, item) => sum + item.months, 0),
    last_extension_on: extensions.map((item) => item.executed!.on).sort().at(-1) ?? "",
    modifications: modifications.length,
    last_modification_on: modifications.map((item) => item.executed.on).sort().at(-1) ?? "",
    in_default: yes(Boolean(openDefault(deal))),
    credit_band: `${band}-${band + 19}`,
    fico: deal.app.fico,
    completed_projects: deal.creditReview?.verifiedDeals ?? deal.app.verifiedDeals,
    guarantor_count: guarantors.length,
    grade: e.score.grade,
    tier: e.tier,
    flood_zone: flood?.zone ?? "",
    special_flood_hazard_area: flood ? yes(flood.sfha) : "",
    insurance_expires: expiries[0] ?? "",
    exit_strategy: deal.exitStrategy,
    affiliated_contractor: yes(Boolean(deal.contractorIsGtAffiliate)),
    ask_pct: sale?.status === "listed" ? sale.askPct : "",
    ask_price: sale?.status === "listed" ? pricePaid(balance, sale.askPct) : "",
    yield_at_ask: sale?.status === "listed" ? yieldAtPrice({ balance, ratePct: rate, months: Math.max(1, ledger.rows.filter((item) => item.due > asOf).length), monthlyPayment: rentalOnly ? funded.nextPayment : undefined }, sale.askPct) : "",
  };
  // Only the version's own columns, in the documented order.
  return Object.fromEntries(columnsFor(version).map((column) => [column.key, row[column.key] ?? ""]));
}

/** The JSON file: what it is, the columns with what each means, and the loans. */
export const tapeJson = (rows: TapeRow[], version: TapeVersion, asOf: string) => JSON.stringify({
  tape: "LendHous loan tape", version, asOf,
  columns: columnsFor(version).map(({ key, label, about }) => ({ key, label, about })),
  loans: rows,
}, null, 2);

export const tapeFileName = (version: TapeVersion, asOf: string, ext: "csv" | "json", what = "loans") => `lendhous-${what}-tape-${version}-${asOf}.${ext}`;

/** A loan a tape can carry: funded and still on the books, or ended with a history a buyer may want. */
export const TAPE_STATUSES = ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "reo", "paid_off"];
