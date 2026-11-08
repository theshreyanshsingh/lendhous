// The words every screen uses for a loan's, a document's and the capital's status, in sentence case. One map, so a
// borrower, a partner and the team read the same word for the same thing, and no screen invents its own.
import type { CapitalStatus, DocStatus, LoanStatus } from "./mockData";

export const LOAN_STATUS_WORDS: Record<LoanStatus, string> = {
  submitted: "Submitted", initial_review: "In review", underwriting: "Underwriting", term_sheet_issued: "Term sheet sent", term_sheet_accepted: "Term sheet signed",
  conditions: "Conditions", clear_to_close: "Clear to close", closing: "Closing", funded: "Funded", servicing_current: "Current", servicing_delinquent: "Payment late",
  matured: "Matured", default: "In default", paid_off: "Paid off", reo: "Bank-owned (REO)", declined: "Declined", withdrawn: "Withdrawn",
};
export const DOC_STATUS_WORDS: Record<DocStatus, string> = { requested: "Requested", uploaded: "Uploaded", in_review: "In review", accepted: "Accepted", rejected: "Sent back", waived: "Not needed" };
export const CAPITAL_STATUS_WORDS: Record<CapitalStatus, string> = { not_started: "Not started", recommended: "Recommended", teaser_out: "Teaser out", bids_in: "Bids in", reserved: "Reserved", committed: "Committed", funded: "Funded" };

const WORDS: Record<string, string> = { ...CAPITAL_STATUS_WORDS, ...DOC_STATUS_WORDS, ...LOAN_STATUS_WORDS };

/** "term_sheet_issued" → "Term sheet sent". Anything not in the maps reads as a sentence: "bids_in" → "Bids in". */
export function statusWords(code: string) {
  const known = WORDS[code];
  if (known) return known;
  const words = code.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a loan-to-value style ratio means, for people who don't use the abbreviations. */
export const PLAIN_RATIO: Record<string, string> = { ltc: "Loan to cost", ltarv: "Loan to after-repair value", ltv: "Loan to value", dscr: "Rent to payment" };

/** How interest is charged, in plain words. */
export function interestBasis(product: string, accrual?: string) {
  if (product === "dscr") return "30-year schedule";
  return accrual === "dutch" ? "on money drawn so far" : "on the full loan amount";
}
